#!/usr/bin/env node
// Mercury402 MCP Server (stdio) — lets AI agents call paid Mercury402 endpoints as tools.
// Payments: x402 v2 "exact" scheme, EIP-3009 transferWithAuthorization signed locally
// by the PAYER key (MERCURY_PAYER_KEY). Server settles as facilitator.
//
// Env:
//   MERCURY_API       base URL (default https://api.mercury402.com)
//   MERCURY_PAYER_KEY payer private key (0x...) — MUST hold USDC on Base
//   MERCURY_MAX_SPEND max micro-USDC per single call guard (default: challenge amount)
//
// NEVER logs or echoes the private key.

const readline = require("readline");
const { randomBytes } = require("crypto");
const { ethers } = require("ethers");

const MERCURY_API = process.env.MERCURY_API || "https://api.mercury402.com";
const PAYER_KEY = process.env.MERCURY_PAYER_KEY || "";

const TOOLS = [
  {
    name: "mercury_macro_briefing",
    description: "AI-written macro briefing (<=220 words): headline, Growth/Prices/Labor bullets with cited figures, risk flag. Written ONLY from live FRED data. $0.10",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    endpoint: "/v1/ai/briefing",
    method: "GET",
  },
  {
    name: "mercury_ask_data",
    description: "Ask a natural-language question answered STRICTLY from Mercury402 FRED macro series (grounded, cites dates/values; refuses if data insufficient). $0.15",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "8-500 chars" },
        series: { type: "array", items: { type: "string" }, description: "Optional paths like /v1/fred/cpi (max 6)" },
      },
      required: ["question"],
    },
    endpoint: "/v1/ai/ask",
    method: "POST",
  },
  {
    name: "mercury_economic_dashboard",
    description: "GDP + CPI + Unemployment snapshot in one call. $0.50",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    endpoint: "/v1/composite/economic-dashboard",
    method: "GET",
  },
  {
    name: "mercury_inflation_tracker",
    description: "CPI + PCE + Core CPI inflation snapshot in one call. $0.40",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    endpoint: "/v1/composite/inflation-tracker",
    method: "GET",
  },
  {
    name: "mercury_labor_market",
    description: "Unemployment + initial claims + nonfarm payrolls in one call. $0.40",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    endpoint: "/v1/composite/labor-market",
    method: "GET",
  },
  {
    name: "mercury_fred_series",
    description: "Any FRED series by id (e.g. CPIAUCSL, UNRATE, DGS10). $0.05",
    inputSchema: { type: "object", properties: { series_id: { type: "string" } }, required: ["series_id"] },
    endpoint: null,
    method: "GET",
  },
];

function usdcDomain(contract) {
  return { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: contract };
}
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

async function rawFetch(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}

async function paidFetch(endpoint, method, bodyObj) {
  if (!PAYER_KEY) throw new Error("MERCURY_PAYER_KEY not set — cannot pay");
  const url = `${MERCURY_API}${endpoint}`;
  const init = { method, headers: {} };
  if (bodyObj !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(bodyObj);
  }

  let first = await rawFetch(url, init);
  if (first.status !== 402) return first;

  const challenge = first.json && first.json.accepts && first.json.accepts[0];
  if (!challenge) throw new Error("402 without accepts[] — cannot build payment");

  const wallet = new ethers.Wallet(PAYER_KEY);
  const now = Math.floor(Date.now() / 1000);
  const cap = parseInt(process.env.MERCURY_MAX_SPEND || "100000000", 10); // $100 safety cap
  const asked = parseInt(challenge.maxAmountRequired || challenge.amount, 10);
  if (!Number.isFinite(asked)) throw new Error("challenge missing amount");
  const value = BigInt(Math.min(asked, cap));

  const auth = {
    from: wallet.address,
    to: challenge.payTo,
    value: value.toString(),
    validAfter: String(now - 60),
    validBefore: String(now + 600),
    nonce: "0x" + randomBytes(32).toString("hex"),
  };
  const signature = await wallet.signTypedData(
    usdcDomain(challenge.asset),
    EIP3009_TYPES,
    auth
  );

  const payload = {
    x402Version: 2,
    accepted: challenge,
    payload: { authorization: auth, signature },
  };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");

  const second = await rawFetch(url, {
    ...init,
    headers: { ...init.headers, "payment-signature": header },
  });
  return second;
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  let endpoint = tool.endpoint;
  if (name === "mercury_fred_series") endpoint = `/v1/fred/${encodeURIComponent(args.series_id)}`;
  const body = name === "mercury_ask_data"
    ? { question: args.question, ...(args.series ? { series: args.series } : {}) }
    : undefined;
  const res = await paidFetch(endpoint, tool.method, body);
  if (res.status === 402) throw new Error("Payment rejected/settle pending: " + JSON.stringify(res.json).slice(0, 300));
  if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.json || res.text).slice(0, 300)}`);
  return res.json;
}

function ok(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function err(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      return ok(id, {
        protocolVersion: params && params.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mercury402", version: "1.1.0" },
      });
    }
    if (method === "notifications/initialized") return;
    if (method === "tools/list") {
      return ok(id, { tools: TOOLS.map(({ name: n, description: d, inputSchema: s }) => ({ name: n, description: d, inputSchema: s })) });
    }
    if (method === "tools/call") {
      const out = await callTool(params.name, params.arguments || {});
      return ok(id, { content: [{ type: "text", text: JSON.stringify(out).slice(0, 20000) }] });
    }
    if (id !== undefined) err(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (id !== undefined) err(id, -32000, e.message);
  }
});
