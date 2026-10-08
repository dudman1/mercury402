# Releasing mercury402-mcp

Releases are published to npm by GitHub Actions
([`.github/workflows/publish-mcp.yml`](../.github/workflows/publish-mcp.yml)) when a `vX.Y.Z` tag is pushed.
Authentication is npm **trusted publishing** (OIDC): there is no npm token in the repo or its secrets, and every
release gets a signed provenance statement linking it to the commit and workflow run that built it.

## One-time setup

1. **First publish (manual).** npm only lets you configure a trusted publisher on a package that already exists.
   From a fresh checkout of `master`:

   ```bash
   npm ci && cd mcp-server && npm ci && npm whoami && npm publish --access public
   ```

   Add `--otp=<code>` if your account requires 2FA for publishing. Don't push a `v0.1.0` tag afterwards: the
   workflow would try to publish 0.1.0 again and fail, because npm versions can't be reused.

2. **Add the trusted publisher.** On npmjs.com: package **mercury402-mcp** → **Settings** → **Trusted Publisher**
   → **GitHub Actions**, and enter:

   | Field | Value |
   |---|---|
   | Organization or user | `dudman1` |
   | Repository | `mercury402` |
   | Workflow filename | `publish-mcp.yml` |
   | Environment name | *(leave empty)* |

   Save. The workflow filename is just the file name, not the `.github/workflows/` path.

3. **Optional hardening.** On the same Settings page, under **Publishing access**, choose
   *Require two-factor authentication and disallow tokens*. Trusted publishing keeps working; leaked or
   legacy tokens can no longer publish.

## Releasing a new version

From an up-to-date `master` with a clean working tree. Replace `0.1.1` with the new version:

```bash
cd mcp-server
npm version 0.1.1 --no-git-tag-version
sed -i.bak "s/SERVER_VERSION = '.*'/SERVER_VERSION = '0.1.1'/" src/server.ts && rm src/server.ts.bak
npm test
git add package.json package-lock.json src/server.ts
git commit -m "release: mercury402-mcp v0.1.1"
git push origin master
git tag v0.1.1
git push origin v0.1.1
```

`SERVER_VERSION` in `src/server.ts` is the version reported to MCP clients; `test/package.test.ts` fails if it
differs from `package.json`, which blocks the publish. The `sed -i.bak` form works on both macOS and Linux.

Pushing the tag starts **Publish mercury402-mcp** in the Actions tab. The workflow:

1. checks the tag (`v0.1.1`) matches `mcp-server/package.json` `version` (`0.1.1`) and fails if not;
2. installs the API and MCP server dependencies (`npm ci`) and runs `npm test`;
3. checks `src/catalog.json` is in sync with `../src/pricing.js` and the route metadata;
4. runs `npm publish --provenance --access public`, whose `prepublishOnly` regenerates the catalog, rebuilds
   `dist/` and reruns the tests.

Check the result at https://www.npmjs.com/package/mercury402-mcp. The version page shows a provenance badge.

### If the workflow fails

- **Tag/version mismatch:** delete the tag (`git push origin :refs/tags/v0.1.1 && git tag -d v0.1.1`), fix
  `package.json`, then tag again.
- **`ENEEDAUTH` / `E404` on publish:** the trusted publisher fields don't match exactly (user, repo, workflow file
  name), or the package hasn't been published once yet (see step 1).
- **Tests or catalog check fail:** fix on `master`, then move the tag to the new commit or release a new version.
  npm never accepts the same version twice.
