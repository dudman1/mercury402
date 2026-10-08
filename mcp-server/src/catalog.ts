import catalogJson from './catalog.json' with { type: 'json' };

export interface EndpointParam {
  name: string;
  in: 'path' | 'query' | 'body';
  required: boolean;
  type: string;
  description: string;
}

export interface Endpoint {
  path: string;
  method: 'GET' | 'POST';
  category: string;
  description: string;
  price_usd: number;
  price_usdc_atomic: string;
  params: EndpointParam[];
  fred_series_id?: string;
  price_note?: string;
}

export interface Catalog {
  generated_from: string[];
  payment: {
    protocol: string;
    scheme: string;
    network: string;
    asset: string;
    asset_address: string;
  };
  count: number;
  endpoints: Endpoint[];
}

export const CATALOG = catalogJson as Catalog;

export interface ResolvedEndpoint {
  endpoint: Endpoint;
  /** Concrete request path with path params substituted. */
  path: string;
  query: Record<string, string>;
  body?: Record<string, unknown>;
}

export type ParamValue = string | number | boolean | string[];

// Path-param values are interpolated into a URL; keep them to FRED-style ids.
const PATH_PARAM_RE = /^[A-Za-z0-9_]{1,40}$/;

function templateToRegex(template: string): RegExp {
  const escaped = template
    .split(/(\{[^}]+\})/)
    .map((part) => (part.startsWith('{') ? '([^/]+)' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${escaped}$`);
}

function templateParamNames(template: string): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

/**
 * Finds the catalog entry for `path`. Accepts exact paths ("/v1/fred/cpi"),
 * concrete paths matching a template ("/v1/fred/UNRATE"), or the template itself
 * ("/v1/fred/{series_id}"). Exact matches win over templates.
 */
export function findEndpoint(
  path: string,
  catalog: Catalog = CATALOG,
): { endpoint: Endpoint; pathParams: Record<string, string> } | undefined {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  const exact = catalog.endpoints.find((e) => e.path === clean);
  if (exact) return { endpoint: exact, pathParams: {} };
  for (const e of catalog.endpoints) {
    if (!e.path.includes('{')) continue;
    const m = templateToRegex(e.path).exec(clean);
    if (!m) continue;
    const names = templateParamNames(e.path);
    const pathParams: Record<string, string> = {};
    names.forEach((n, i) => {
      const v = decodeURIComponent(m[i + 1]);
      // A literal "{series_id}" segment means "fill from params".
      if (v !== `{${n}}`) pathParams[n] = v;
    });
    return { endpoint: e, pathParams };
  }
  return undefined;
}

/** Builds the concrete request from a path + caller-supplied params. Throws on invalid input. */
export function resolveRequest(
  path: string,
  params: Record<string, ParamValue> = {},
  catalog: Catalog = CATALOG,
): ResolvedEndpoint {
  const found = findEndpoint(path, catalog);
  if (!found) {
    throw new Error(`Unknown endpoint "${path}". Call list_endpoints to see the ${catalog.count} available paths.`);
  }
  const { endpoint } = found;
  const remaining: Record<string, ParamValue> = { ...params };

  let concrete = endpoint.path;
  for (const name of templateParamNames(endpoint.path)) {
    const raw = found.pathParams[name] ?? remaining[name];
    delete remaining[name];
    if (raw === undefined || raw === '') {
      throw new Error(`Missing required path parameter "${name}" for ${endpoint.path}`);
    }
    const value = String(raw);
    if (!PATH_PARAM_RE.test(value)) {
      throw new Error(`Invalid value for path parameter "${name}": must match ${PATH_PARAM_RE}`);
    }
    concrete = concrete.replace(`{${name}}`, encodeURIComponent(value));
  }

  for (const p of endpoint.params) {
    if (p.in !== 'path' && p.required && remaining[p.name] === undefined) {
      throw new Error(`Missing required parameter "${p.name}" for ${endpoint.method} ${endpoint.path}`);
    }
  }

  if (endpoint.method === 'POST') {
    return { endpoint, path: concrete, query: {}, body: remaining };
  }
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(remaining)) {
    query[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return { endpoint, path: concrete, query };
}
