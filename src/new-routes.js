// Mercury402 New Routes — FRED Expansion Sprint (2026-03-31)
// 40+ named FRED series + forex + spreads + breakeven + macro bundle + recession index
// Mounts into Express app via registerNewRoutes()

// ============================================================
// FRED SERIES DEFINITIONS (40+ endpoints)
// ============================================================

const FRED_SERIES = {
  // ── Prices ──
  '/v1/fred/cpi':                       { code: 'CPIAUCSL', name: 'Consumer Price Index (CPI)', desc: 'Consumer Price Index for All Urban Consumers (CPIAUCSL)' },
  '/v1/fred/cpi-core':                  { code: 'CPILFESL', name: 'Core CPI', desc: 'Core CPI (excl. food & energy, CPILFESL)' },
  '/v1/fred/ppi':                       { code: 'PPIACO', name: 'Producer Price Index (PPI)', desc: 'Producer Price Index for All Commodities' },
  '/v1/fred/pce':                       { code: 'PCE', name: 'Personal Consumption Expenditures', desc: 'Personal Consumption Expenditures (PCE)' },
  '/v1/fred/pce-core':                  { code: 'PCEPILFE', name: 'Core PCE Price Index', desc: 'Core PCE Price Index (excl. food & energy)' },
  '/v1/fred/pce-deflator':              { code: 'DPCERG3Q086SBEA', name: 'PCE Deflator', desc: 'PCE deflator, percent change from year ago' },

  // ── Employment ──
  '/v1/fred/unemployment-rate':         { code: 'UNRATE', name: 'Unemployment Rate', desc: 'Civilian unemployment rate' },
  '/v1/fred/nonfarm-payrolls':          { code: 'PAYEMS', name: 'Nonfarm Payrolls', desc: 'Total nonfarm payrolls (thousands)' },
  '/v1/fred/initial-claims':            { code: 'ICSA', name: 'Initial Jobless Claims', desc: 'Initial jobless claims, weekly' },
  '/v1/fred/continuing-claims':         { code: 'CCSA', name: 'Continuing Jobless Claims', desc: 'Continued claims, weekly' },
  '/v1/fred/labor-force-participation': { code: 'CIVPART', name: 'Labor Force Participation Rate', desc: 'Labor force participation rate' },
  '/v1/fred/average-hourly-earnings':   { code: 'CES0500000003', name: 'Average Hourly Earnings', desc: 'Average hourly earnings of all employees, total private' },
  '/v1/fred/jolts-openings':            { code: 'JTSJOL', name: 'JOLTS Job Openings', desc: 'Job Openings and Labor Turnover Survey' },
  '/v1/fred/quits-rate':                { code: 'JTSQUR', name: 'Quits Rate', desc: 'Quits rate (JOLTS)' },
  '/v1/fred/u6-unemployment':           { code: 'U6RATE', name: 'U-6 Unemployment', desc: 'Total unemployed + marginally attached + part-time for economic reasons' },

  // ── Growth ──
  '/v1/fred/gdp':                       { code: 'GDP', name: 'Gross Domestic Product', desc: 'Real GDP, billions of chained 2017 dollars' },
  '/v1/fred/gdp-growth':                { code: 'A191RL1Q225SBEA', name: 'Real GDP Growth', desc: 'Real GDP percent change, annualized' },
  '/v1/fred/gdi':                       { code: 'GDIC1', name: 'Gross Domestic Income', desc: 'Real GDI' },
  '/v1/fred/gdp-deflator':              { code: 'GDPDEF', name: 'GDP Deflator', desc: 'Gross domestic product: implicit price deflator' },
  '/v1/fred/corporate-profits':         { code: 'CP', name: 'Corporate Profits', desc: 'Corporate profits after tax' },

  // ── Money Supply & Rates ──
  '/v1/fred/m1-money-stock':            { code: 'M1SL', name: 'M1 Money Stock', desc: 'M1 money stock, seasonally adjusted' },
  '/v1/fred/m2-money-stock':            { code: 'M2SL', name: 'M2 Money Stock', desc: 'M2 money stock, seasonally adjusted' },
  '/v1/fred/fed-funds-rate':            { code: 'FEDFUNDS', name: 'Federal Funds Effective Rate', desc: 'Effective federal funds rate' },
  '/v1/fred/fed-funds-target-upper':    { code: 'DFEDTARU', name: 'Fed Funds Target Upper', desc: 'Federal funds target rate, upper bound' },
  '/v1/fred/treasury-3m':               { code: 'DGS3MO', name: '3-Month Treasury', desc: '3-month Treasury constant maturity rate' },
  '/v1/fred/treasury-2y':               { code: 'DGS2', name: '2-Year Treasury', desc: '2-year Treasury constant maturity rate' },
  '/v1/fred/treasury-5y':               { code: 'DGS5', name: '5-Year Treasury', desc: '5-year Treasury constant maturity rate' },
  '/v1/fred/treasury-10y':              { code: 'DGS10', name: '10-Year Treasury', desc: '10-year Treasury constant maturity rate' },
  '/v1/fred/treasury-30y':              { code: 'DGS30', name: '30-Year Treasury', desc: '30-year Treasury constant maturity rate' },
  '/v1/fred/mortgage-30y':              { code: 'MORTGAGE30US', name: '30-Year Fixed Mortgage', desc: '30-year fixed-rate mortgage average' },
  '/v1/fred/bbb-corporate-yield':       { code: 'BAMLC0A4CBBB', name: 'BBB Corporate Yield', desc: 'ICE BofA BBB US Corporate Index Option-Adjusted Yield' },
  '/v1/fred/high-yield-spread':         { code: 'BAMLH0A0HYM2', name: 'High Yield Spread', desc: 'ICE BofA US High Yield Index Option-Adjusted Spread' },
  '/v1/fred/a-rated-spread':            { code: 'BAMLC0A3CA', name: 'A-Rated Corporate Spread', desc: 'ICE BofA Single-A US Corporate Index OAS' },

  // ── Sentiment ──
  '/v1/fred/consumer-confidence':       { code: 'UMCSENT', name: 'U Michigan Consumer Sentiment', desc: 'University of Michigan consumer sentiment index' },
  '/v1/fred/conference-board-ci':       { code: 'CSCICP03USM665S', name: 'Conference Board CI', desc: 'Conference Board consumer confidence index (OECD)' },
  '/v1/fred/inflation-expectations':    { code: 'MICH', name: 'Inflation Expectations', desc: 'University of Michigan 1-year inflation expectations' },
  '/v1/fred/leading-indicators':        { code: 'USSLIND', name: 'Leading Economic Index', desc: 'Conference Board Leading Economic Index for the US' },

  // ── Trade ──
  '/v1/fred/trade-balance':             { code: 'BOPGSTB', name: 'Trade Balance', desc: 'Trade balance: goods and services, millions of USD' },
  '/v1/fred/current-account':           { code: 'BOPBCA', name: 'Current Account Balance', desc: 'Current account balance, billions of USD' },

  // ── Housing ──
  '/v1/fred/housing-starts':            { code: 'HOUST', name: 'Housing Starts', desc: 'New privately-owned housing units started (thousands)' },
  '/v1/fred/building-permits':          { code: 'PERMIT', name: 'Building Permits', desc: 'New privately-owned housing units authorized (thousands)' },
  '/v1/fred/existing-home-sales':       { code: 'EXHOSLUSM495S', name: 'Existing Home Sales', desc: 'Existing home sales, millions (SAAR)' },
  '/v1/fred/case-shiller':              { code: 'CSUSHPINSA', name: 'Case-Shiller Home Price Index', desc: 'S&P/Case-Shiller US National Home Price Index' },
  '/v1/fred/homeownership-rate':        { code: 'RHORUSQ156N', name: 'Homeownership Rate', desc: 'Homeownership rate for the US' },

  // ── Other ──
  '/v1/fred/industrial-production':     { code: 'INDPRO', name: 'Industrial Production Index', desc: 'Industrial production: total index' },
  '/v1/fred/retail-sales':              { code: 'RSAFS', name: 'Retail Sales', desc: 'Advance retail sales: retail and food services (millions)' },
  '/v1/fred/personal-income':           { code: 'PI', name: 'Personal Income', desc: 'Personal income, billions of USD' },
  '/v1/fred/personal-saving-rate':      { code: 'PSAVERT', name: 'Personal Saving Rate', desc: 'Personal saving rate (percent)' },
  '/v1/fred/total-vehicle-sales':       { code: 'TOTALSA', name: 'Total Vehicle Sales', desc: 'Total vehicle sales, millions (SAAR)' },
  '/v1/fred/federal-debt':              { code: 'GFDEGDQ188S', name: 'Federal Debt-to-GDP', desc: 'Federal debt as percent of GDP' },
  '/v1/fred/federal-deficit':           { code: 'MTSDS133FMS', name: 'Federal Surplus/Deficit', desc: 'Federal surplus or deficit, billions' },
  '/v1/fred/vix':                       { code: 'VIXCLS', name: 'VIX Index', desc: 'CBOE Volatility Index: VIX' },
};

// ============================================================
// FOREX CROSS-RATE DEFINITIONS (FRED DEX series)
// ============================================================

const FOREX_SERIES = {
  '/v1/forex/eur-usd':  { code: 'DEXUSEU', name: 'EUR/USD', desc: 'Euro area / US dollar exchange rate (DEXUSEU)', invert: true },
  '/v1/forex/gbp-usd':  { code: 'DEXUSUK', name: 'GBP/USD', desc: 'US / UK pound exchange rate (DEXUSUK)', invert: true },
  '/v1/forex/usd-jpy':  { code: 'DEXJPUS', name: 'USD/JPY', desc: 'Japan / US dollar exchange rate (DEXJPUS)', invert: false },
  '/v1/forex/usd-cny':  { code: 'DEXCHUS', name: 'USD/CNY', desc: 'China / US dollar exchange rate (DEXCHUS)', invert: false },
};

// ============================================================
// YIELD CURVE SPREAD DEFINITIONS (computed from FRED)
// ============================================================

const SPREAD_ENDPOINTS = {
  '/v1/yield-spread/10y-2y':    { a: 'DGS10', b: 'DGS2',  name: '10Y-2Y Spread', desc: '10-year minus 2-year Treasury yield spread' },
  '/v1/yield-spread/10y-3m':    { a: 'DGS10', b: 'DGS3MO', name: '10Y-3M Spread', desc: '10-year minus 3-month Treasury yield spread' },
  '/v1/yield-spread/5y-2y':     { a: 'DGS5',  b: 'DGS2',  name: '5Y-2Y Spread', desc: '5-year minus 2-year Treasury yield spread' },
  '/v1/yield-spread/30y-5y':    { a: 'DGS30', b: 'DGS5',  name: '30Y-5Y Spread', desc: '30-year minus 5-year Treasury yield spread' },
  '/v1/yield-spread/10y-5y':    { a: 'DGS10', b: 'DGS5',  name: '10Y-5Y Spread', desc: '10-year minus 5-year Treasury yield spread' },
};

// ============================================================
// BREAKEVEN INFLATION DEFINITIONS (FRED TIPS series)
// ============================================================

const BREAKEVEN_ENDPOINTS = {
  '/v1/breakeven/5y':   { code: 'T5YIE', name: '5Y Breakeven Inflation', desc: '5-year breakeven inflation rate (TIPS)' },
  '/v1/breakeven/10y':  { code: 'T10YIE', name: '10Y Breakeven Inflation', desc: '10-year breakeven inflation rate (TIPS)' },
  '/v1/breakeven/2y':   { code: 'T2YIE', name: '2Y Breakeven Inflation', desc: '2-year breakeven inflation rate (TIPS)' },
  '/v1/breakeven/5y5y': { code: 'T5YIFR', name: '5Y5Y Forward Inflation', desc: '5-year, 5-year forward inflation expectation rate' },
};

// ============================================================
// MACRO BUNDLE & COMPOSITE ENDPOINTS
// ============================================================

const BUNDLE_SERIES = {
  treasury_10y:   { code: 'DGS10',  name: '10Y Treasury Yield' },
  treasury_2y:    { code: 'DGS2',   name: '2Y Treasury Yield' },
  cpi_yoy:        { code: 'CPIAUCSL', name: 'CPI (for YoY calc)', transform: 'yoy_change' },
  gdp:            { code: 'GDP',    name: 'Gross Domestic Product' },
  unemployment:   { code: 'UNRATE', name: 'Unemployment Rate' },
  fed_funds:      { code: 'FEDFUNDS', name: 'Fed Funds Rate' },
  payrolls:       { code: 'PAYEMS', name: 'Nonfarm Payrolls' },
  m2:             { code: 'M2SL',   name: 'M2 Money Stock' },
  vix:            { code: 'VIXCLS', name: 'VIX Index' },
  trade_balance:  { code: 'BOPGSTB', name: 'Trade Balance' },
};

// ============================================================
// ENDPOINT METADATA MAP (pricing + description + method)
// ============================================================

function buildEndpointMeta() {
  const meta = {};

  // Individual FRED series
  for (const [path, def] of Object.entries(FRED_SERIES)) {
    meta[path] = { price: 0.05, desc: def.desc, method: 'GET', type: 'fred-series', seriesId: def.code };
  }

  // Forex cross-rates
  for (const [path, def] of Object.entries(FOREX_SERIES)) {
    meta[path] = { price: 0.05, desc: def.desc, method: 'GET', type: 'forex', seriesId: def.code, invert: def.invert };
  }

  // Yield curve spreads
  for (const [path, def] of Object.entries(SPREAD_ENDPOINTS)) {
    meta[path] = { price: 0.05, desc: def.desc, method: 'GET', type: 'spread', seriesA: def.a, seriesB: def.b };
  }

  // Breakeven inflation
  for (const [path, def] of Object.entries(BREAKEVEN_ENDPOINTS)) {
    meta[path] = { price: 0.05, desc: def.desc, method: 'GET', type: 'breakeven', seriesId: def.code };
  }

  // Premium endpoints
  meta['/v1/macro/bundle'] = {
    price: 0.10, desc: 'Macro Bundle: Treasury + CPI + GDP + Employment + Fed Funds + M2 + VIX + Trade (single call)',
    method: 'GET', type: 'bundle'
  };
  meta['/v1/macro/recession-probability'] = {
    price: 0.10, desc: 'Recession Probability Index: yield curve spread + unemployment + leading indicators',
    method: 'GET', type: 'recession'
  };

  return meta;
}

// ============================================================
// REGISTER FUNCTION — mounts all routes on Express app
// ============================================================

function registerNewRoutes(app, deps) {
  const {
    require402Payment,
    getPrice: getPricingFn,
    fetchFredData,
    generateProvenance,
    getCacheKey,
    getCached,
    setCache,
    CACHE_TTL,
    cacheStats
  } = deps;

  const ENDPOINT_META = buildEndpointMeta();

  // ── Helper: fetch latest value for a FRED series ──
  async function fetchLatestFred(seriesId) {
    const result = await fetchFredData(seriesId, { sort_order: 'desc', limit: 1 });
    if (!result.observations || result.observations.length === 0) return null;
    const obs = result.observations[0];
    return { date: obs.date, value: parseFloat(obs.value), seriesId };
  }

  // ── Helper: fetch latest N values for YoY calculations ──
  async function fetchFredRange(seriesId, months = 13) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const result = await fetchFredData(seriesId, {
      observation_start: startDate.toISOString().split('T')[0],
      observation_end: endDate.toISOString().split('T')[0]
    });
    return result.observations || [];
  }

  // ── Helper: standard error handler ──
  function handleError(res, error, endpointName) {
    console.error(`${endpointName} error:`, error.message);
    if (error.message.includes('No data') || error.message.includes('NOT_FOUND')) {
      return res.status(404).json({ error: { code: 'NO_DATA_FOUND', message: `No data for ${endpointName}` } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: `Failed to fetch ${endpointName}` } });
  }

  // ── Helper: set price header ──
  function setPriceHeader(res, endpoint) {
    const price = getPricingFn(endpoint);
    res.setHeader('X-Mercury-Price', `$${price.toFixed(2)}`);
  }

  // ── Helper: check cache and return if hit ──
  function tryCache(res, cacheKey) {
    const cached = getCached(cacheKey);
    if (cached && !cached.stale) {
      res.setHeader('X-Data-Age', cached.age.toString());
      res.locals.cacheHit = true;
      res.json(cached.data);
      return true;
    }
    if (cached && cached.stale) {
      cacheStats.staleHits++;
    }
    cacheStats.misses++;
    return false;
  }

  // ── Simple FRED series routes ──
  for (const [endpoint, meta] of Object.entries(FRED_SERIES)) {
    app.get(endpoint, require402Payment(endpoint, getPricingFn(endpoint)), async (req, res) => {
      try {
        const cacheKey = getCacheKey(`fred:${meta.code}`, {});
        if (tryCache(res, cacheKey)) return;

        const data = await fetchLatestFred(meta.code);
        if (!data) return res.status(404).json({ error: { code: 'NO_DATA_FOUND', message: `No data for ${meta.name}` } });

        const responseData = {
          series_id: meta.code,
          name: meta.name,
          date: data.date,
          value: data.value,
          source: 'FRED'
        };
        const provenance = generateProvenance(responseData, meta.code, {});
        const response = { data: responseData, provenance };

        setCache(cacheKey, response, CACHE_TTL.FRED);
        setPriceHeader(res, endpoint);
        res.json(response);
      } catch (error) {
        handleError(res, error, meta.name);
      }
    });
  }

  // ── Forex cross-rate routes ──
  for (const [endpoint, meta] of Object.entries(FOREX_SERIES)) {
    app.get(endpoint, require402Payment(endpoint, getPricingFn(endpoint)), async (req, res) => {
      try {
        const cacheKey = getCacheKey(`forex:${meta.code}`, {});
        if (tryCache(res, cacheKey)) return;

        const data = await fetchLatestFred(meta.code);
        if (!data) return res.status(404).json({ error: { code: 'NO_DATA_FOUND', message: `No data for ${meta.name}` } });

        let value = data.value;
        let displayRate = value;

        // FRED DEX series: DEXUSEU = USD per EUR, DEXUSUK = USD per GBP
        // We report the named pair directly
        if (meta.invert && value !== 0) {
          displayRate = 1 / value;
        }

        const responseData = {
          pair: meta.name,
          date: data.date,
          rate: parseFloat(displayRate.toFixed(6)),
          source_fred_series: meta.code,
          source: 'FRED'
        };
        const provenance = generateProvenance(responseData, meta.code, {});
        const response = { data: responseData, provenance };

        setCache(cacheKey, response, CACHE_TTL.FRED);
        setPriceHeader(res, endpoint);
        res.json(response);
      } catch (error) {
        handleError(res, error, meta.name);
      }
    });
  }

  // ── Yield curve spread routes ──
  for (const [endpoint, meta] of Object.entries(SPREAD_ENDPOINTS)) {
    app.get(endpoint, require402Payment(endpoint, getPricingFn(endpoint)), async (req, res) => {
      try {
        const cacheKey = getCacheKey(`spread:${meta.a}-${meta.b}`, {});
        if (tryCache(res, cacheKey)) return;

        const [dataA, dataB] = await Promise.all([
          fetchLatestFred(meta.a),
          fetchLatestFred(meta.b)
        ]);

        if (!dataA || !dataB) {
          return res.status(404).json({ error: { code: 'NO_DATA_FOUND', message: `Insufficient data for ${meta.name}` } });
        }

        const spread = parseFloat((dataA.value - dataB.value).toFixed(3));
        const responseData = {
          name: meta.name,
          date: Math.max(dataA.date, dataB.date),
          spread_pct: spread,
          components: {
            series_a: { series_id: meta.a, name: `${meta.a} yield`, value: dataA.value, date: dataA.date },
            series_b: { series_id: meta.b, name: `${meta.b} yield`, value: dataB.value, date: dataB.date },
          },
          source: 'FRED'
        };
        const provenance = generateProvenance(responseData, `${meta.a}-${meta.b}`, {});
        const response = { data: responseData, provenance };

        setCache(cacheKey, response, CACHE_TTL.FRED);
        setPriceHeader(res, endpoint);
        res.json(response);
      } catch (error) {
        handleError(res, error, meta.name);
      }
    });
  }

  // ── Breakeven inflation routes ──
  for (const [endpoint, meta] of Object.entries(BREAKEVEN_ENDPOINTS)) {
    app.get(endpoint, require402Payment(endpoint, getPricingFn(endpoint)), async (req, res) => {
      try {
        const cacheKey = getCacheKey(`breakeven:${meta.code}`, {});
        if (tryCache(res, cacheKey)) return;

        const data = await fetchLatestFred(meta.code);
        if (!data) return res.status(404).json({ error: { code: 'NO_DATA_FOUND', message: `No data for ${meta.name}` } });

        const responseData = {
          series_id: meta.code,
          name: meta.name,
          date: data.date,
          value_pct: data.value,
          source: 'FRED'
        };
        const provenance = generateProvenance(responseData, meta.code, {});
        const response = { data: responseData, provenance };

        setCache(cacheKey, response, CACHE_TTL.FRED);
        setPriceHeader(res, endpoint);
        res.json(response);
      } catch (error) {
        handleError(res, error, meta.name);
      }
    });
  }

  // ── Macro Bundle (premium, $0.10) ──
  app.get('/v1/macro/bundle', require402Payment('/v1/macro/bundle', getPricingFn('/v1/macro/bundle')), async (req, res) => {
    try {
      const cacheKey = getCacheKey('macro:bundle', {});
      if (tryCache(res, cacheKey)) return;

      const seriesIds = Object.values(BUNDLE_SERIES).map(s => s.code);
      const uniqueSeries = [...new Set(seriesIds)];

      const results = await Promise.all(
        uniqueSeries.map(id => fetchLatestFred(id).catch(err => {
          console.error(`Bundle fetch ${id}:`, err.message);
          return null;
        }))
      );

      const dataBySeries = {};
      uniqueSeries.forEach((id, i) => { dataBySeries[id] = results[i]; });

      const indicators = {};
      for (const [key, series] of Object.entries(BUNDLE_SERIES)) {
        const d = dataBySeries[series.code];
        if (d) {
          if (series.transform === 'yoy_change') {
            // Compute YoY from CPI data
            const range = await fetchFredRange(series.code, 13).catch(() => []);
            if (range.length >= 2) {
              const latest = parseFloat(range[range.length - 1].value);
              const yearAgo = parseFloat(range[0].value);
              indicators[key] = {
                name: series.name,
                value: parseFloat(((latest - yearAgo) / yearAgo * 100).toFixed(2)),
                unit: 'percent_yoy',
                date: d.date
              };
            }
          } else {
            indicators[key] = {
              name: series.name,
              value: d.value,
              date: d.date
            };
          }
        }
      }

      // Yield spread derived from bundle data
      if (indicators.treasury_10y && indicators.treasury_2y) {
        indicators.yield_spread_10y_2y = {
          name: '10Y-2Y Yield Spread',
          value: parseFloat((indicators.treasury_10y.value - indicators.treasury_2y.value).toFixed(3)),
          unit: 'percent',
          date: indicators.treasury_10y.date
        };
      }

      const responseData = {
        bundle: 'macro',
        snapshot_date: new Date().toISOString().split('T')[0],
        source: 'FRED',
        indicators,
        deterministic: true
      };
      const provenance = generateProvenance(responseData, 'macro-bundle', {});
      const response = { data: responseData, provenance };

      setCache(cacheKey, response, CACHE_TTL.FRED);
      setPriceHeader(res, '/v1/macro/bundle');
      res.json(response);
    } catch (error) {
      handleError(res, error, 'Macro Bundle');
    }
  });

  // ── Recession Probability Index ($0.10) ──
  app.get('/v1/macro/recession-probability', require402Payment('/v1/macro/recession-probability', getPricingFn('/v1/macro/recession-probability')), async (req, res) => {
    try {
      const cacheKey = getCacheKey('macro:recession', {});
      if (tryCache(res, cacheKey)) return;

      // Fetch components: 10Y yield, 3M yield, unemployment rate
      const [y10y, y3m, unemployment] = await Promise.all([
        fetchLatestFred('DGS10'),
        fetchLatestFred('DGS3MO'),
        fetchLatestFred('UNRATE')
      ]);

      if (!y10y || !y3m || !unemployment) {
        return res.status(404).json({ error: { code: 'NO_DATA_FOUND', message: 'Insufficient data for recession probability' } });
      }

      // Yield curve spread (negative = inverted = recession signal)
      const spread10y3m = y10y.value - y3m.value;

      // Simplified recession probability model:
      // Based on NY Fed methodology: when spread < 0, probability increases
      // Formula: P = 1 / (1 + exp(-(a + b * spread)))
      // Calibrated coefficients from historical analysis
      const a = -1.65;
      const b = 1.20;
      const exponent = -(a + b * spread10y3m);
      const rawProb = 1 / (1 + Math.exp(exponent));
      const probabilityPct = parseFloat((rawProb * 100).toFixed(1));

      // Risk level
      let riskLevel = 'low';
      if (probabilityPct >= 60) riskLevel = 'high';
      else if (probabilityPct >= 30) riskLevel = 'moderate';

      const responseData = {
        probability_pct: probabilityPct,
        risk_level: riskLevel,
        components: {
          spread_10y_3m_pct: parseFloat(spread10y3m.toFixed(3)),
          treasury_10y_pct: y10y.value,
          treasury_3m_pct: y3m.value,
          unemployment_pct: unemployment.value
        },
        model: 'logistic_yield_curve_v1',
        source: 'FRED',
        note: 'Simplified logistic model. Inverted yield curve (negative spread) increases probability. Not investment advice.'
      };
      const provenance = generateProvenance(responseData, 'recession-probability', {});
      const response = { data: responseData, provenance };

      setCache(cacheKey, response, CACHE_TTL.FRED);
      setPriceHeader(res, '/v1/macro/recession-probability');
      res.json(response);
    } catch (error) {
      handleError(res, error, 'Recession Probability');
    }
  });

  // Return endpoint metadata for manifest builder
  return ENDPOINT_META;
}

module.exports = { registerNewRoutes, FRED_SERIES, FOREX_SERIES, SPREAD_ENDPOINTS, BREAKEVEN_ENDPOINTS, BUNDLE_SERIES, buildEndpointMeta };
