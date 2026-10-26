# Install snippets: Mercury402 MCP

Treasury/FRED financial data over x402. Two ways to connect, same two tools (`list_endpoints`,
`get_endpoint_data`):

- **Hosted remote**: `https://mcp.mercury402.com/mcp` (Streamable HTTP, no auth). Discovery-only: lists all 78
  endpoints and returns the live 402 quote. Never pays, never returns paid data.
- **Local stdio**: `npx -y mercury402-mcp` (npm, MIT, Node 20.10+). Free by default. Paid mode only if the user
  adds `MERCURY402_PAYER_PRIVATE_KEY` themselves (see `mcp-server/README.md`, "Paid mode (optional)").

None of these snippets contain a key, and none should. Sources: Cursor https://cursor.com/docs/mcp/install-links,
Windsurf https://docs.windsurf.com/windsurf/cascade/mcp, Cline
https://docs.cline.bot/mcp/connecting-to-a-remote-server, Claude: `mcp-server/README.md` and `claude mcp add --help`.

## Cursor

One-click install links (format `cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG`).
Both configs were base64-encoded and decoded back in code (2026-10-25). Both button images returned 200 the same
evening.

Remote, config `{"url":"https://mcp.mercury402.com/mcp"}`:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=mercury402&config=eyJ1cmwiOiJodHRwczovL21jcC5tZXJjdXJ5NDAyLmNvbS9tY3AifQ==
```

Local stdio, config `{"command":"npx","args":["-y","mercury402-mcp"]}`:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=mercury402&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1lcmN1cnk0MDItbWNwIl19
```

The remote link's base64 ends in `==` and is written raw. Padding encoding (= vs %3D) UNVERIFIED against Cursor's deeplink doc; both decode identically.

README button (Markdown, remote):

```markdown
[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=mercury402&config=eyJ1cmwiOiJodHRwczovL21jcC5tZXJjdXJ5NDAyLmNvbS9tY3AifQ==)
```

Manual: `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "mercury402": { "url": "https://mcp.mercury402.com/mcp" }
  }
}
```

## Windsurf (Cascade)

No marketplace or one-click install for Cascade. Paste into `mcp_config.json` (editor:
`~/.codeium/windsurf/mcp_config.json`). Remote servers take `serverUrl` (or `url`):

```json
{
  "mcpServers": {
    "mercury402": { "serverUrl": "https://mcp.mercury402.com/mcp" }
  }
}
```

Local stdio:

```json
{
  "mcpServers": {
    "mercury402": { "command": "npx", "args": ["-y", "mercury402-mcp"] }
  }
}
```

## Cline

`cline_mcp_settings.json`. For remote, set `"type": "streamableHttp"` explicitly, because Cline defaults to the
legacy `sse` transport when `type` is omitted:

```json
{
  "mcpServers": {
    "mercury402": { "type": "streamableHttp", "url": "https://mcp.mercury402.com/mcp" }
  }
}
```

Local stdio:

```json
{
  "mcpServers": {
    "mercury402": { "command": "npx", "args": ["-y", "mercury402-mcp"] }
  }
}
```

Agent-readable install guide: `docs/listings/cline/llms-install.md`.

## Claude Code

```bash
# hosted remote
claude mcp add --transport http mercury402 https://mcp.mercury402.com/mcp
# local stdio
claude mcp add mercury402 -- npx -y mercury402-mcp
```

## Claude Desktop

Local stdio, in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "mercury402": { "command": "npx", "args": ["-y", "mercury402-mcp"] }
  }
}
```

Hosted remote: add `https://mcp.mercury402.com/mcp` as a custom connector in Claude's Connectors settings (no
auth). The menu path wasn't re-checked in this pass.

## Generic (any MCP client)

```json
{ "mcpServers": { "mercury402": { "type": "http", "url": "https://mcp.mercury402.com/mcp" } } }
```
