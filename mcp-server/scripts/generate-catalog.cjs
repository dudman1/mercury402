#!/usr/bin/env node
// Generates mcp-server/src/catalog.json from the Mercury402 API source of truth.
//
// The catalog itself is built by src/catalog.js (which reads src/pricing.js for
// the endpoint list and prices, and src/new-routes.js + src/ai-routes.js for
// descriptions and methods). Nothing about the API surface is re-declared here,
// so this file cannot drift from the API.
//
// Run from mcp-server/: npm run generate:catalog

const path = require('path');
const fs = require('fs');

const REPO_SRC = path.join(__dirname, '..', '..', 'src');
const OUT = path.join(__dirname, '..', 'src', 'catalog.json');

const { buildCatalog } = require(path.join(REPO_SRC, 'catalog.js'));

const catalog = buildCatalog();

fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Wrote ${catalog.count} endpoints to ${path.relative(process.cwd(), OUT)}`);
