# Example: a journal MCP server with a consent layer

A tiny but real MCP server that exposes a (fake) personal journal to an AI
client, gated by [`mcp-consent-audit`](../../). It demonstrates the one idea the
MCP spec leaves to you:

> Claude can read your **mood summaries**, but is **blocked** from reading your
> **raw diary entries** unless you explicitly granted that, and every access,
> allowed or denied, is recorded.

Four tools:

| Tool | Needs scope | In this demo |
|---|---|---|
| `get_mood_timeline` | `emotions:read` | ✅ allowed |
| `search_entries` | `journals:read` | ✅ allowed (summaries only) |
| `read_entry` | `journals:read:raw` | 🚫 **denied** (not granted) |
| `show_access_log` | — | shows every allow + deny |

## Try it in 30 seconds (no Claude needed)

```sh
cd examples/mcp-server
npm install
npm run smoke
```

You'll see mood + summaries allowed, the raw entry blocked with `403
missing_scope`, and the denial sitting in the access log.

## Connect it to Claude Desktop

1. `npm install` in this folder (links the local library).
2. Add this to your `claude_desktop_config.json`
   (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`),
   using the **absolute** path to `server.mjs`:

   ```json
   {
     "mcpServers": {
       "journal-consent-demo": {
         "command": "node",
         "args": ["/ABSOLUTE/PATH/TO/mcp-consent-audit/examples/mcp-server/server.mjs"]
       }
     }
   }
   ```

   (Run `pwd` in this folder to get the path.)
3. Restart Claude Desktop. The four tools appear under the demo server.

## Prompts to try in Claude

- **"How have I been feeling this week?"** → calls `get_mood_timeline`, works. It
  can reason about your mood.
- **"What did I journal about?"** → `search_entries`, returns summaries only.
- **"Read my June 21 entry in full."** → `read_entry`, **denied**. Claude tells
  you it isn't allowed to read raw entries. *This is the screenshot.*
- **"What has this app accessed?"** → `show_access_log`, shows the allows and the
  blocked attempt.

## Flip the consent and watch it change

Grant the elevated scope and the same raw read now succeeds:

```sh
DEMO_GRANT_RAW=1 npm run smoke
```

That one env var is the whole point: raw access is a deliberate, separate grant,
never implied by `journals:read`.

## From demo to real

This example uses in-memory stores, sample data, and one hardcoded grant. A real
server swaps in:

- `createPostgresGrantStore` / `createPostgresAuditSink` (see [`../../schema.sql`](../../schema.sql)),
- a real per-user OAuth token instead of `DEMO_GRANT_TOKEN`,
- optionally the `GitHubAuditSink` tamper-evident mirror.

The consent logic, the `authorize()` calls, stays identical.
