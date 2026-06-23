import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorize,
  withConsent,
  ConsentError,
  InMemoryGrantStore,
  InMemoryAuditSink,
  type Grant,
} from "./index.js";

function setup() {
  const store = new InMemoryGrantStore();
  const audit = new InMemoryAuditSink();
  const grant: Grant = {
    id: "g1",
    userId: "u1",
    clientName: "Claude Desktop",
    scopes: ["emotions:read", "playlists:write"],
    purpose: "weekly reflection",
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    revokedAt: null,
  };
  store.add(grant, "tok_good");
  return { store, audit };
}

const fixedNow = () => new Date("2026-06-14T12:00:00Z");

test("allows a call with sufficient scope and records an allow", async () => {
  const { store, audit } = setup();
  const principal = await authorize(
    { store, audit, now: fixedNow },
    {
      token: "tok_good",
      required: "emotions:read",
      action: "resource.read",
      target: "nocturne://emotions/timeline",
    },
  );
  assert.equal(principal.userId, "u1");
  assert.equal(principal.clientName, "Claude Desktop");
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0].decision, "allow");
  assert.equal(audit.entries[0].scopeUsed, "emotions:read");
});

test("denies and audits a missing token (401)", async () => {
  const { store, audit } = setup();
  await assert.rejects(
    authorize(
      { store, audit },
      {
        token: null,
        required: "emotions:read",
        action: "resource.read",
        target: "x",
      },
    ),
    (e: unknown) =>
      e instanceof ConsentError &&
      e.reason === "missing_token" &&
      e.status === 401,
  );
  assert.equal(audit.entries.at(-1)?.decision, "deny");
  assert.equal(audit.entries.at(-1)?.reason, "missing_token");
});

test("denies an unknown token", async () => {
  const { store, audit } = setup();
  await assert.rejects(
    authorize(
      { store, audit },
      {
        token: "nope",
        required: "emotions:read",
        action: "resource.read",
        target: "x",
      },
    ),
    (e: unknown) => e instanceof ConsentError && e.reason === "invalid_token",
  );
});

test("denies a missing scope — raw journals are elevated (403)", async () => {
  const { store, audit } = setup();
  await assert.rejects(
    authorize(
      { store, audit },
      {
        token: "tok_good",
        required: "journals:read:raw",
        action: "resource.read",
        target: "nocturne://journals/abc",
        severity: "elevated",
      },
    ),
    (e: unknown) =>
      e instanceof ConsentError &&
      e.reason === "missing_scope" &&
      e.status === 403,
  );
  const last = audit.entries.at(-1);
  assert.equal(last?.decision, "deny");
  assert.equal(last?.severity, "elevated");
});

test("revocation stops access; second revoke is a no-op", async () => {
  const { store, audit } = setup();
  assert.equal(await store.revoke("g1"), true);
  await assert.rejects(
    authorize(
      { store, audit },
      {
        token: "tok_good",
        required: "emotions:read",
        action: "resource.read",
        target: "x",
      },
    ),
    (e: unknown) => e instanceof ConsentError && e.reason === "revoked_grant",
  );
  assert.equal(await store.revoke("g1"), false);
});

test("withConsent wraps a handler and threads the principal", async () => {
  const { store, audit } = setup();
  const generatePlaylist = withConsent(
    { store, audit },
    {
      required: "playlists:write",
      action: "tool.call",
      target: "generate_playlist",
    },
    async (input: { mood: string }, principal) =>
      `${principal.clientName} made a ${input.mood} playlist`,
  );
  const out = await generatePlaylist({ mood: "calm" }, { token: "tok_good" });
  assert.equal(out, "Claude Desktop made a calm playlist");
  assert.equal(audit.entries.at(-1)?.decision, "allow");
});

test("withConsent denies before the handler runs", async () => {
  const { store, audit } = setup();
  let ran = false;
  const readJournal = withConsent(
    { store, audit },
    {
      required: "journals:read:raw",
      action: "resource.read",
      severity: "elevated",
      target: (input: { id: string }) => `nocturne://journals/${input.id}`,
    },
    async (input: { id: string }) => {
      ran = true;
      return input.id;
    },
  );
  await assert.rejects(
    readJournal({ id: "abc" }, { token: "tok_good" }),
    (e: unknown) => e instanceof ConsentError && e.reason === "missing_scope",
  );
  assert.equal(ran, false, "handler must not run when consent is denied");
});

test("the audit trail is user-queryable, newest first", async () => {
  const { store, audit } = setup();
  await authorize(
    { store, audit },
    {
      token: "tok_good",
      required: "emotions:read",
      action: "resource.read",
      target: "a",
    },
  );
  await authorize(
    { store, audit },
    {
      token: "tok_good",
      required: "playlists:write",
      action: "tool.call",
      target: "generate_playlist",
    },
  );
  const rows = await audit.listForUser("u1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].target, "generate_playlist"); // newest first
  assert.equal(rows[0].userId, "u1");
});
