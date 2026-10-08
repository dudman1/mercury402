// Publishing checks: the compiled package must run without the rest of the
// repo. Compiles src/ into an isolated temp dir (nothing from ../src next to
// it) and checks the endpoint catalog is baked in rather than read at runtime.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src/server.js';

const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const sourceCatalog = JSON.parse(readFileSync(join(ROOT, 'src', 'catalog.json'), 'utf8'));

describe('compiled package is self-contained', () => {
  let out: string;

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'mercury402-mcp-dist-'));
    execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tsconfig.json'), '--outDir', out]);
  }, 60_000);

  afterAll(() => {
    if (out) rmSync(out, { recursive: true, force: true });
  });

  it('bakes the full catalog into the build output', () => {
    const built = JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8'));
    expect(built).toEqual(sourceCatalog);
    expect(built.count).toBe(78);
    expect(built.endpoints).toHaveLength(78);
  });

  it('never references the repo source or reads files at runtime', () => {
    const jsFiles = readdirSync(out).filter((f) => f.endsWith('.js'));
    expect(jsFiles.sort()).toEqual(['catalog.js', 'client.js', 'config.js', 'index.js', 'payment.js', 'server.js']);
    for (const f of jsFiles) {
      const code = readFileSync(join(out, f), 'utf8');
      expect(code, f).not.toMatch(/\.\.\/(\.\.\/)?src|pricing\.js|new-routes|ai-routes|generate-catalog|readFileSync|createRequire/);
    }
  });

  it('loads the catalog from an isolated directory', async () => {
    const mod = await import(pathToFileURL(join(out, 'catalog.js')).href);
    expect(mod.CATALOG.count).toBe(78);
    expect(mod.findEndpoint('/v1/fred/UNRATE').endpoint.path).toBe('/v1/fred/{series_id}');
  });

  it('keeps the shebang on the bin entry', () => {
    expect(readFileSync(join(out, 'index.js'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});

describe('package.json', () => {
  it('publishes only the bin, built files, README and LICENSE', () => {
    expect(pkg.name).toBe('mercury402-mcp');
    expect(pkg.bin).toEqual({ 'mercury402-mcp': 'dist/index.js' });
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE']);
    expect(pkg.scripts.prepublishOnly).toMatch(/build.*test/);
  });

  it('reports the package version over MCP', () => {
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
