-- mcp-consent-audit — reference schema (PostgreSQL / Supabase)
--
-- The library is storage-agnostic; these are the tables the bundled Postgres
-- stores (createPostgresGrantStore / createPostgresAuditSink) expect.

create extension if not exists pgcrypto;

-- A grant = one app's scoped, revocable access on behalf of one user.
create table if not exists mcp_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  client_name text not null,                 -- e.g. "Claude Desktop"
  token_hash  text not null unique,          -- sha256(token); NEVER store raw tokens
  scopes      text[] not null default '{}',  -- e.g. {emotions:read, playlists:write}
  purpose     text,                          -- shown to the user ("weekly reflection")
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz                    -- null = active
);
create index if not exists mcp_grants_user_idx on mcp_grants (user_id);

-- Append-only access log. Records EVERY decision — allows and denials alike.
create table if not exists access_log (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  client_name text,
  action      text not null,                 -- tool.call | resource.read | resource.list | prompt.get
  target      text not null,                 -- e.g. nocturne://journals/abc | generate_playlist
  scope_used  text,
  severity    text not null default 'normal',-- normal | elevated (e.g. raw journal reads)
  decision    text not null,                 -- allow | deny
  reason      text,                          -- denial reason
  request_id  text,                          -- correlate with agent-side logs
  created_at  timestamptz not null default now()
);
create index if not exists access_log_user_idx on access_log (user_id, created_at desc);

-- Defense in depth: the consumer (Nocturne) should enable Row-Level Security so a
-- bug in the MCP server cannot read across users. Sketch:
--
--   alter table mcp_grants enable row level security;
--   alter table access_log  enable row level security;
--   create policy own_grants on mcp_grants
--     using (user_id = auth.uid());
--   create policy own_logs on access_log
--     for select using (user_id = auth.uid());
