// Unit tests for src/bazaar-discovery.js: the bazaar block generated from an
// OpenAPI operation validates against its own schema and the vendored bazaar
// spec schema for every input shape the generator handles — including
// shapes no route uses today (query parameters, $ref, response examples).
const test = require('node:test');
const assert = require('node:assert');
const Ajv2020 = require('ajv/dist/2020').default;

const { buildBazaarFromOperation, buildBazaarIndex, loadOpenApi } = require('../src/bazaar-discovery');
const { getCatalog } = require('../src/catalog');
const SPEC_SCHEMA = require('./fixtures/x402-bazaar-spec-schema.json');

const ajv = new Ajv2020({ strict: false, allErrors: true });
const specValidate = ajv.compile(SPEC_SCHEMA);

function assertValid(bz, where) {
  const own = ajv.compile(bz.schema);
  assert.ok(own(bz.info), `${where}: own schema: ${ajv.errorsText(own.errors)}`);
  assert.ok(specValidate(bz.info), `${where}: spec schema: ${ajv.errorsText(specValidate.errors)}`);
}

const DOC = {
  components: {
    parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } } },
    schemas: { Obs: { type: 'object', properties: { date: { type: 'string', example: '2026-01-01' }, value: { type: 'number', example: 4.1 } } } },
  },
};

test('query, $ref and path parameters: scalar examples, typed schema, no pathParams', () => {
  const op = {
    parameters: [
      { name: 'series_id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'Observation date' },
      { name: 'units', in: 'query', schema: { type: 'string', enum: ['lin', 'pch'] } },
      { name: 'verbose', in: 'query', schema: { type: 'boolean' } },
      { name: 'cursor', in: 'query', example: 'abc', schema: { type: 'string' } },
      { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
      { $ref: '#/components/parameters/Limit' },
    ],
    responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Obs' } } } } },
  };
  const bz = buildBazaarFromOperation(DOC, op, 'get');
  assert.deepStrictEqual(bz.info.input, {
    type: 'http', method: 'GET',
    queryParams: { date: '2026-01-01', units: 'lin', verbose: true, cursor: 'abc', limit: 1 },
  });
  assert.strictEqual(bz.info.input.pathParams, undefined);
  const qp = bz.schema.properties.input.properties.queryParams;
  assert.strictEqual(qp.properties.limit.type, 'integer');
  assert.strictEqual(qp.properties.date.description, 'Observation date');
  assert.deepStrictEqual(qp.required, ['date']);
  assert.deepStrictEqual(bz.info.output.example, { date: '2026-01-01', value: 4.1 });
  assertValid(bz, 'query');
});

test('zero-parameter GET gets the composite-style empty schema', () => {
  const bz = buildBazaarFromOperation(DOC, { responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } } }, 'GET');
  assert.deepStrictEqual(bz.info.input, { type: 'http', method: 'GET', queryParams: {} });
  assert.deepStrictEqual(bz.schema.properties.input.properties.queryParams, { type: 'object', description: 'No query parameters required', properties: {} });
  assert.deepStrictEqual(bz.info.output, { type: 'json', example: { data: {}, provenance: {} } });
  assertValid(bz, 'zero-param');
});

test('requestBody: bodyType json, example body, schema without OpenAPI-only keywords', () => {
  const op = {
    requestBody: { content: { 'application/json': {
      schema: { type: 'object', properties: { q: { type: 'string', minLength: 3, example: 'gdp', nullable: true } }, required: ['q'] },
    } } },
    responses: { 200: { content: { 'application/json': { example: { answer: 'ok' } } } } },
  };
  const bz = buildBazaarFromOperation(DOC, op, 'POST');
  assert.deepStrictEqual(bz.info.input, { type: 'http', method: 'POST', bodyType: 'json', body: { q: 'gdp' } });
  const body = bz.schema.properties.input.properties.body;
  assert.strictEqual(body.properties.q.example, undefined);
  assert.strictEqual(body.properties.q.nullable, undefined);
  assert.deepStrictEqual(bz.info.output.example, { answer: 'ok' });
  assertValid(bz, 'body');
});

test('operation missing from the spec: empty-properties shape, still valid', () => {
  assertValid(buildBazaarFromOperation(DOC, undefined, 'GET'), 'missing GET');
  const post = buildBazaarFromOperation(DOC, undefined, 'POST');
  assert.deepStrictEqual(post.info.input.body, {});
  assertValid(post, 'missing POST');
});

test('index: explicit entries win, generated ones fill the rest, missing ops are reported', () => {
  const explicit = { '/a': { info: { input: { type: 'http', method: 'GET' } }, schema: {} } };
  const doc = { paths: { '/b': { get: {} } } };
  const { byKey, missing } = buildBazaarIndex([{ path: '/a', method: 'GET' }, { path: '/b', method: 'GET' }, { path: '/c', method: 'POST' }], explicit, doc);
  assert.strictEqual(byKey.get('GET /a'), explicit['/a']);
  assert.ok(byKey.get('GET /b'));
  assert.ok(byKey.get('POST /c').info.input.bodyType);
  assert.deepStrictEqual(missing, ['POST /c']);
});

test('docs/openapi.yaml has an operation for every priced route', () => {
  const { missing } = buildBazaarIndex(getCatalog().endpoints, {}, loadOpenApi());
  assert.deepStrictEqual(missing, []);
});
