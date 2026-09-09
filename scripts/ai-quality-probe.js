// AI quality probe — boots isolated instance of the REAL ai-routes handlers
// with payment middleware bypassed. Read-only FRED calls. Never touches prod.
require("dotenv").config();
const express = require("express");
const { PRICING } = require("../src/pricing");
const { FRED_SERIES } = require("../src/new-routes");
const { registerAiRoutes } = require("../src/ai-routes");

async function fetchFredData(code, opts = {}) {
  const u = new URL("https://api.stlouisfed.org/fred/series/observations");
  u.searchParams.set("series_id", code);
  u.searchParams.set("api_key", process.env.FRED_API_KEY);
  u.searchParams.set("file_type", "json");
  if (opts.sort_order) u.searchParams.set("sort_order", opts.sort_order);
  if (opts.limit) u.searchParams.set("limit", String(opts.limit));
  const r = await fetch(u);
  const j = await r.json();
  return { observations: j.observations || [], units: "" };
}

const app = express();
app.use(express.json());
registerAiRoutes(app, {
  require402Payment: () => (req, res, next) => next(),   // bypass paywall for probe
  getPrice: (p) => (PRICING && PRICING[p]) || 0,
  fetchFredData,
  generateProvenance: (data, id) => ({ source: "quality-probe", fn: id }),
  getCacheKey: (p) => p,
  getCached: () => null,
  setCache: () => {},
  CACHE_TTL: { FRED: 3600 },
  FRED_SERIES,
});

app.listen(4022, () => console.log("PROBE READY on 4022"));
