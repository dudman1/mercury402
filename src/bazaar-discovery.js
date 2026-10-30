// Generates the x402 bazaar discovery extension (extensions.bazaar) for a
// priced route from its docs/openapi.yaml operation, so every priced route's
// 402 carries one without a hand-written entry. Shape per the x402 v2 bazaar
// spec (coinbase/x402 specs/extensions/bazaar.md), same as the hand-written
// BAZAAR_SCHEMAS entries in server.js:
// - GET:  info.input { type: 'http', method, queryParams: { name: example } }
// - POST: info.input { type: 'http', method, bodyType: 'json', body: example }
// - info.output { type: 'json', example }
// - schema: JSON Schema (draft 2020-12) that `info` validates against.
// Path parameters are never declared: the spec only permits concrete
// pathParams paired with a top-level routeTemplate, and resource.url already
// carries the concrete path (same as the /v1/fred/{series_id} entry).

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const OPENAPI_PATH = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
// Used when the spec gives no response example: the paid response envelope
// every Mercury402 data route returns.
const MINIMAL_OUTPUT_EXAMPLE = { data: {}, provenance: {} };

function loadOpenApi(file = OPENAPI_PATH) {
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

// Resolves a same-document "#/components/..." $ref; anything else is returned as-is.
function deref(doc, node) {
  let cur = node;
  for (let i = 0; cur && typeof cur.$ref === 'string' && cur.$ref.startsWith('#/') && i < 10; i++) {
    cur = cur.$ref.slice(2).split('/').reduce((o, k) => (o ? o[k] : undefined), doc);
  }
  return cur;
}

// JSON Schema for one value, minus OpenAPI-only keywords.
function toJsonSchema(doc, schema) {
  const s = deref(doc, schema);
  if (!s || typeof s !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'example' || k === 'examples' || k === 'nullable' || k === 'xml' || k === 'externalDocs' || k.startsWith('x-')) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toJsonSchema(doc, pv)]));
    } else if ((k === 'items' || k === 'additionalProperties') && v && typeof v === 'object') {
      out[k] = toJsonSchema(doc, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function defaultForType(schema) {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'integer':
    case 'number':
      return schema.minimum !== undefined ? schema.minimum : 1;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return schema.format === 'date' ? '2026-01-01' : 'string';
  }
}

// Example value for a schema: its own example, else one built from its
// properties' examples, else a type default.
function exampleFromSchema(doc, schema) {
  const s = deref(doc, schema);
  if (!s || typeof s !== 'object') return undefined;
  if (s.example !== undefined) return s.example;
  if (s.type === 'object' || s.properties) {
    if (!s.properties) return {};
    return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, exampleFromSchema(doc, v)]));
  }
  if (s.type === 'array') {
    const item = exampleFromSchema(doc, s.items);
    return item === undefined ? [] : [item];
  }
  return defaultForType(s);
}

function jsonTypeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : typeof v === 'string' ? 'string' : 'object';
}

function isNonEmptyObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
}

function jsonMedia(doc, container) {
  const c = deref(doc, container);
  return c && c.content && (c.content['application/json'] || Object.values(c.content)[0]);
}

function outputFor(doc, op) {
  const responses = (op && op.responses) || {};
  const media = jsonMedia(doc, responses['200'] || responses['201'] || responses.default);
  let example;
  let properties = {};
  if (media) {
    if (media.example !== undefined) example = media.example;
    else if (media.examples && typeof media.examples === 'object') {
      const first = deref(doc, Object.values(media.examples)[0]);
      if (first && first.value !== undefined) example = first.value;
    }
    const schema = toJsonSchema(doc, media.schema);
    if (schema.properties) properties = schema.properties;
    if (example === undefined) {
      const built = exampleFromSchema(doc, media.schema);
      if (isNonEmptyObject(built)) example = built;
    }
  }
  if (!isNonEmptyObject(example)) example = MINIMAL_OUTPUT_EXAMPLE;
  if (!Object.keys(properties).length) {
    properties = Object.fromEntries(Object.entries(example).map(([k, v]) => [k, { type: jsonTypeOf(v) }]));
  }
  return {
    info: { type: 'json', example },
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        example: { type: 'object', properties }
      },
      required: ['type']
    }
  };
}

function queryInputFor(doc, op, method) {
  const queryParams = {};
  const properties = {};
  const required = [];
  for (const raw of (op && op.parameters) || []) {
    const p = deref(doc, raw);
    if (!p || p.in !== 'query') continue; // path params: see header comment
    const schema = toJsonSchema(doc, p.schema || { type: 'string' });
    if (p.description && !schema.description) schema.description = p.description;
    const ex = p.example !== undefined ? p.example : exampleFromSchema(doc, p.schema || { type: 'string' });
    queryParams[p.name] = ex !== null && typeof ex === 'object' ? JSON.stringify(ex) : ex;
    properties[p.name] = schema;
    if (p.required) required.push(p.name);
  }
  const queryParamsSchema = Object.keys(properties).length
    ? { type: 'object', properties, ...(required.length ? { required } : {}) }
    : { type: 'object', description: 'No query parameters required', properties: {} };
  return {
    info: { type: 'http', method, queryParams },
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'http' },
        method: { type: 'string', const: method },
        queryParams: queryParamsSchema
      },
      required: ['type', 'method'],
      additionalProperties: false
    }
  };
}

function bodyInputFor(doc, op, method) {
  const media = jsonMedia(doc, op && op.requestBody);
  const bodySchema = media && media.schema ? toJsonSchema(doc, media.schema) : { type: 'object', properties: {} };
  let body = media && media.example !== undefined ? media.example : undefined;
  if (body === undefined && media && media.examples) {
    const first = deref(doc, Object.values(media.examples)[0]);
    if (first) body = first.value;
  }
  if (body === undefined) body = media && media.schema ? exampleFromSchema(doc, media.schema) : {};
  if (!body || typeof body !== 'object') body = {};
  return {
    info: { type: 'http', method, bodyType: 'json', body },
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'http' },
        method: { type: 'string', const: method },
        bodyType: { type: 'string', const: 'json' },
        body: bodySchema
      },
      required: ['type', 'method', 'bodyType', 'body'],
      additionalProperties: false
    }
  };
}

// The bazaar {info, schema} for one operation. `op` may be undefined (route
// missing from the spec): the result is then the empty-properties shape.
function buildBazaarFromOperation(doc, op, method) {
  const m = String(method || 'GET').toUpperCase();
  const input = BODY_METHODS.has(m) ? bodyInputFor(doc, op, m) : queryInputFor(doc, op, m);
  const output = outputFor(doc, op);
  return {
    info: { input: input.info, output: output.info },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { input: input.schema, output: output.schema },
      required: ['input', 'output']
    }
  };
}

function operationFor(doc, endpointPath, method) {
  const item = doc && doc.paths && doc.paths[endpointPath];
  return item ? item[String(method).toLowerCase()] : undefined;
}

// Builds the bazaar block for every priced route: an explicit entry wins,
// otherwise it is generated from the route's OpenAPI operation.
// endpoints: [{ path, method }]. Returns { byKey: Map('METHOD path' -> bazaar), missing: ['METHOD path'] }.
function buildBazaarIndex(endpoints, explicit, doc) {
  const byKey = new Map();
  const missing = [];
  for (const { path: p, method } of endpoints) {
    const m = String(method || 'GET').toUpperCase();
    if (explicit[p]) {
      byKey.set(`${m} ${p}`, explicit[p]);
      continue;
    }
    const op = operationFor(doc, p, m);
    if (!op) missing.push(`${m} ${p}`);
    byKey.set(`${m} ${p}`, buildBazaarFromOperation(doc, op, m));
  }
  return { byKey, missing };
}

module.exports = { loadOpenApi, buildBazaarFromOperation, buildBazaarIndex, operationFor, exampleFromSchema, MINIMAL_OUTPUT_EXAMPLE };
