# mcp-consent-audit

[![CI](https://github.com/MeloMed-io/mcp-consent-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/MeloMed-io/mcp-consent-audit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcp-consent-audit.svg)](https://www.npmjs.com/package/mcp-consent-audit)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A small, dependency-free consent + audit layer for [Model Context
Protocol](https://modelcontextprotocol.io) servers.

MCP gives agents a clean way to reach into your app's data and actions. What the
spec leaves to you is the part that matters most when that data is sensitive:
**who is allowed to do what, and a trail of who actually did it.** This library
is that part.

- **Scoped** — every tool/resource call requires a capability scope; calls
  without it are rejected before your handler runs.
- **No implicit hierarchy** — `journals:read` does **not** grant
  `journals:read:raw`. Elevated access is always a deliberate, separate grant.
- **Revocable** — revoke a grant and the next call fails. (You implement the
  store; revocation is enforced in the library.)
- **Audited** — every decision, allow *and* deny, is recorded — and meant to be
  shown back to the user ("which apps accessed my data, when, and why").
- **Storage-agnostic** — ships with in-memory stores (tests/dev), a Postgres
  adapter that depends on no specific driver, and a tamper-evident GitHub-backed
  audit mirror.

## Install

```sh
npm install mcp-consent-audit
```

## Quick start

```ts
import {
  withConsent,
  InMemoryGrantStore,
  InMemoryAuditSink,
} from "mcp-consent-audit";

const store = new InMemoryGrantStore();
const audit = new InMemoryAuditSink();

// In production, swap in createPostgresGrantStore / createPostgresAuditSink.

const generatePlaylist = withConsent(
  { store, audit },
  { required: "playlists:write", action: "tool.call", target: "generate_playlist" },
  async (input: { mood: string }, principal) => {
    // principal.userId is the authenticated owner; principal.clientName is the app.
    return makePlaylist(input.mood, principal.userId);
  },
);

// Per call, pass the caller's token (+ optional requestId):
await generatePlaylist({ mood: "calm" }, { token: oauthAccessToken });
```

Or enforce inline:

```ts
import { authorize, ConsentError } from "mcp-consent-audit";

try {
  const principal = await authorize(
    { store, audit },
    { token, required: "journals:read:raw", action: "resource.read",
      target: `app://journals/${id}`, severity: "elevated" },
  );
  // ... serve raw text, scoped to principal.userId ...
} catch (e) {
  if (e instanceof ConsentError) reply(e.status, e.reason); // 401 / 403
}
```

## Postgres

Apply [`schema.sql`](./schema.sql), then:

```ts
import { createPostgresGrantStore, createPostgresAuditSink } from "mcp-consent-audit";

const query = (text, params) => pool.query(text, params); // node-postgres
const store = createPostgresGrantStore(query);
const audit = createPostgresAuditSink(query);
```

Tokens are stored as `sha256` hashes (`hashToken`), never in the clear. Enable
Row-Level Security so a server bug can't read across users — see `schema.sql`.

## GitHub-backed audit trail (tamper-evident mirror)

An audit log is only as trustworthy as the box it lives on. `GitHubAuditSink`
mirrors the trail into a private repo as one append-only `*.jsonl` file per user,
one commit per entry, so the git history itself becomes the tamper-evidence: an
entry can't be silently rewritten or dropped without leaving a trace you don't
control.

```ts
import { GitHubAuditSink, TeeAuditSink, createPostgresAuditSink } from "mcp-consent-audit";

const mirror = new GitHubAuditSink({
  owner: "MeloMed-io",
  repo: "consent-audit-trail",   // a private repo
  token: process.env.GITHUB_TOKEN!, // fine-grained PAT, Contents: read/write, this repo only
});

// Write to Postgres (fast reads) AND GitHub (durable evidence); read from the primary.
const audit = new TeeAuditSink(createPostgresAuditSink(query), mirror);
```

It talks to two GitHub REST endpoints (`GET`/`PUT /repos/{owner}/{repo}/contents/…`),
adds no runtime dependencies, and uses the global `fetch` (Node 18+; injectable
for tests). Concurrent appends are resolved by re-reading and retrying on `409`.

## Scope rules

| Granted        | Satisfies required                          |
| -------------- | ------------------------------------------- |
| `emotions:read`| `emotions:read` (exact only)                |
| `journals:*`   | `journals:read`, `journals:read:raw`, …     |
| `*`            | anything                                    |

`a:b` never implies `a:b:c`. That's the point — elevated access is explicit.

## Develop

```sh
npm test      # tsc + node --test
npm run example  # runnable end-to-end demo (examples/quickstart.mjs)
```

## License

MIT
