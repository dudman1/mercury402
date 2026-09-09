// Mercury402 AI Routes — ox-alpha powered endpoints (2026-08-22)
// Zero-COGS AI: inference via OpenRouter (free stealth model).
// Mounts via registerAiRoutes(app, deps) — mirrors new-routes.js pattern.
// Returns ENDPOINT_META for the /.well-known/x402 manifest builder.

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = process.env.MERCURY_AI_MODEL || "stealth/ox-alpha";
const AI_TIMEOUT_MS = 90000;

// Series feeding /v1/ai/briefing (paths must exist in FRED_SERIES)
const BRIEFING_PATHS = [
  "/v1/fred/gdp",
  "/v1/fred/cpi",
  "/v1/fred/unemployment-rate",
  "/v1/fred/nonfarm-payrolls",
  "/v1/fred/initial-claims",
  "/v1/fred/fed-funds-rate",
];

const DEFAULT_ASK_PATHS = ["/v1/fred/cpi", "/v1/fred/unemployment-rate", "/v1/fred/fed-funds-rate", "/v1/fred/gdp"];

function aiError(message, statusCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 503;
  return e;
}

async function callOxAlpha(messages, opts = {}) {
  if (!OPENROUTER_KEY) {
    throw aiError("AI endpoints not configured: OPENROUTER_API_KEY missing from service environment", 503);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.max_tokens ?? 3000,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw aiError(`Inference upstream error (${resp.status})`, 502);
    }
    const json = await resp.json();
    const msg = json && json.choices && json.choices[0] && json.choices[0].message;
    const content = msg && msg.content;
    const finish = json && json.choices && json.choices[0] ? json.choices[0].finish_reason : "unknown";
    if (!content && finish === "length" && !opts._retried) {
      // Reasoning model burned the whole budget on hidden thinking — retry once at 2x
      return callOxAlpha(messages, { ...opts, _retried: true, max_tokens: (opts.max_tokens || 3000) * 2 });
    }
    if (!content) throw aiError(`Empty AI response (finish_reason=${finish})`, 502);
    return { content, model: (json.model) || AI_MODEL, usage: json.usage || null };
  } catch (err) {
    if (err.name === "AbortError") throw aiError("Inference timed out", 504);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function registerAiRoutes(app, deps) {
  const { require402Payment, getPrice, fetchFredData, generateProvenance, getCacheKey, getCached, setCache, CACHE_TTL, FRED_SERIES } = deps;

  function setPriceHeader(res, endpoint) {
    const price = getPrice(endpoint);
    res.setHeader("X-Mercury-Price", `$${price.toFixed(2)}`);
  }
  const ENDPOINT_META = {};

  // ── GET /v1/ai/briefing ──────────────────────────────────────
  app.get("/v1/ai/briefing", require402Payment("/v1/ai/briefing", getPrice("/v1/ai/briefing")), async (req, res) => {
    try {
      const cacheKey = getCacheKey("/v1/ai/briefing", {});
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);

      const inputs = await Promise.all(BRIEFING_PATHS.map(async (p) => {
        const meta = FRED_SERIES[p];
        const r = await fetchFredData(meta.code, { sort_order: "desc", limit: 2 });
        const obs = r.observations || [];
        return { series: p, name: meta.name, unit_hint: meta.desc, latest: obs[0] ? { date: obs[0].date, value: obs[0].value } : null, previous: obs[1] ? { date: obs[1].date, value: obs[1].value } : null };
      }));

      const result = await callOxAlpha([
        { role: "system", content: "You are a macro analyst writing for Mercury402 paying customers. Use ONLY the JSON data provided. No external knowledge. Do not speculate beyond what the data supports. If a value is null, skip it." },
        { role: "user", content: `Data:\n${JSON.stringify(inputs)}\n\nWrite a macro briefing: at most 220 words, markdown. Structure: one-line headline; exactly 3 bullets (Growth, Prices, Labor) each citing exact figures and dates; final line starting with "Risk flag:" tied to the data.` },
      ]);

      const responseData = { endpoint: "/v1/ai/briefing", generated_at: new Date().toISOString(), briefing_md: result.content, model: result.model, inputs };
      const provenance = generateProvenance(responseData, "ai/briefing", {});
      const response = { data: responseData, provenance };

      setCache(cacheKey, response, CACHE_TTL.FRED);
      setPriceHeader(res, "/v1/ai/briefing");
      res.json(response);
    } catch (error) {
      const code = error.statusCode || 500;
      res.status(code).json({ error: { code: code === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR", message: error.message } });
    }
  });

  // ── POST /v1/ai/ask ─────────────────────────────────────────
  app.post("/v1/ai/ask", require402Payment("/v1/ai/ask", getPrice("/v1/ai/ask"), "POST"), async (req, res) => {
    try {
      let body = req.body || {};
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const question = typeof body.question === "string" ? body.question.trim() : "";
      if (question.length < 8 || question.length > 500) {
        return res.status(400).json({ error: { code: "BAD_REQUEST", message: "question must be 8-500 characters" } });
      }
      let paths = Array.isArray(body.series) ? body.series.filter((p) => FRED_SERIES[p]) : DEFAULT_ASK_PATHS;
      paths = [...new Set(paths)].slice(0, 6);

      const datasets = await Promise.all(paths.map(async (p) => {
        const meta = FRED_SERIES[p];
        const r = await fetchFredData(meta.code, { sort_order: "desc", limit: 12 });
        const obs = (r.observations || []).map((o) => ({ date: o.date, value: o.value }));
        return { series: p, name: meta.name, observations: obs };
      }));

      const result = await callOxAlpha([
        { role: "system", content: "You answer questions for Mercury402 customers using ONLY the provided dataset observations. Answer in 150 words or fewer. Cite specific dates and values for every claim. If the data cannot answer the question, respond with exactly 'INSUFFICIENT_DATA: <what is missing>' and nothing else." },
        { role: "user", content: `Dataset:\n${JSON.stringify(datasets)}\n\nQuestion: ${question}` },
      ], { max_tokens: 2400 });

      const insufficient = result.content.startsWith("INSUFFICIENT_DATA");
      const responseData = {
        endpoint: "/v1/ai/ask",
        question,
        answer_md: result.content,
        insufficient_data: insufficient,
        series_used: datasets.map((d) => ({ series: d.series, points: d.observations.length })),
        model: result.model,
        generated_at: new Date().toISOString(),
      };
      const provenance = generateProvenance(responseData, "ai/ask", { q_len: question.length });

      setPriceHeader(res, "/v1/ai/ask");
      res.json({ data: responseData, provenance });
    } catch (error) {
      const code = error.statusCode || 500;
      res.status(code).json({ error: { code: code === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR", message: error.message } });
    }
  });

  ENDPOINT_META["/v1/ai/briefing"] = {
    price: 0.10,
    desc: "AI Macro Briefing: analyst narrative written strictly from live FRED data (growth, prices, labor, Fed funds)",
    method: "GET",
    type: "ai",
  };
  ENDPOINT_META["/v1/ai/ask"] = {
    price: 0.15,
    desc: "Ask the Data: natural-language question answered ONLY from chosen Mercury402 FRED series (grounded, cited)",
    method: "POST",
    type: "ai",
  };
  return ENDPOINT_META;
}

module.exports = { registerAiRoutes, callOxAlpha };
