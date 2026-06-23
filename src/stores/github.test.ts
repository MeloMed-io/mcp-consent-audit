import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  GitHubAuditSink,
  GitHubApiError,
  TeeAuditSink,
} from "./github.js";
import { InMemoryAuditSink } from "./memory.js";
import type { AccessLogEntry } from "../types.js";

/**
 * A tiny in-memory stand-in for the GitHub Contents API: one file store keyed
 * by path, with sha bookkeeping so we can exercise create, update, and the
 * concurrent-write (409) path without a network.
 */
function fakeGitHub(opts?: { failPutsBeforeSuccess?: number }) {
  const files = new Map<string, { text: string; sha: string }>();
  let pendingFailures = opts?.failPutsBeforeSuccess ?? 0;
  const calls: { method: string; path: string }[] = [];

  const sha = (text: string) =>
    createHash("sha1").update(text).digest("hex");

  const fetchImpl: typeof fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    // /repos/{owner}/{repo}/contents/{path}
    const path = decodeURIComponent(
      u.pathname.split("/contents/")[1] ?? "",
    );
    calls.push({ method, path });

    if (method === "GET") {
      const f = files.get(path);
      if (!f) return new Response("not found", { status: 404 });
      return new Response(
        JSON.stringify({
          content: Buffer.from(f.text, "utf8").toString("base64"),
          sha: f.sha,
        }),
        { status: 200 },
      );
    }

    if (method === "PUT") {
      const body = JSON.parse(init!.body as string) as {
        content: string;
        sha?: string;
      };
      const current = files.get(path);
      // sha mismatch = someone else wrote first.
      if ((current?.sha ?? undefined) !== body.sha) {
        return new Response("conflict", { status: 409 });
      }
      if (pendingFailures > 0) {
        pendingFailures--;
        return new Response("conflict", { status: 409 });
      }
      const text = Buffer.from(body.content, "base64").toString("utf8");
      files.set(path, { text, sha: sha(text) });
      return new Response(JSON.stringify({ content: { path } }), {
        status: 200,
      });
    }

    return new Response("method not allowed", { status: 405 });
  }) as typeof fetch;

  return { fetchImpl, files, calls };
}

function entry(over: Partial<AccessLogEntry> = {}): AccessLogEntry {
  return {
    userId: "u1",
    clientName: "Claude Desktop",
    action: "resource.read",
    target: "nocturne://emotions/timeline",
    scopeUsed: "emotions:read",
    severity: "normal",
    decision: "allow",
    reason: null,
    requestId: null,
    at: new Date("2026-06-14T12:00:00Z"),
    ...over,
  };
}

function sink(fetchImpl: typeof fetch, extra?: Record<string, unknown>) {
  return new GitHubAuditSink({
    owner: "MeloMed-io",
    repo: "consent-audit-trail",
    token: "ghp_test",
    fetchImpl,
    ...extra,
  });
}

test("creates the file on the first write, then appends", async () => {
  const gh = fakeGitHub();
  const s = sink(gh.fetchImpl);

  await s.record(entry({ target: "a" }));
  await s.record(entry({ target: "b" }));

  const stored = gh.files.get("audit/u1.jsonl");
  assert.ok(stored, "file should exist");
  const lines = stored.text.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).target, "a");
  assert.equal(JSON.parse(lines[1]).target, "b");
});

test("round-trips an entry through listForUser, newest first", async () => {
  const gh = fakeGitHub();
  const s = sink(gh.fetchImpl);

  await s.record(entry({ target: "first" }));
  await s.record(entry({ target: "second", decision: "deny", reason: "missing_scope" }));

  const rows = await s.listForUser("u1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].target, "second"); // newest first
  assert.equal(rows[0].decision, "deny");
  assert.equal(rows[0].reason, "missing_scope");
  assert.ok(rows[0].at instanceof Date);
  assert.equal(rows[0].at.toISOString(), "2026-06-14T12:00:00.000Z");
});

test("listForUser honors the limit", async () => {
  const gh = fakeGitHub();
  const s = sink(gh.fetchImpl);
  await s.record(entry({ target: "a" }));
  await s.record(entry({ target: "b" }));
  await s.record(entry({ target: "c" }));

  const rows = await s.listForUser("u1", { limit: 2 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].target, "c");
  assert.equal(rows[1].target, "b");
});

test("listForUser returns [] when the file does not exist", async () => {
  const gh = fakeGitHub();
  const s = sink(gh.fetchImpl);
  assert.deepEqual(await s.listForUser("nobody"), []);
});

test("retries past a transient 409 and still commits", async () => {
  const gh = fakeGitHub({ failPutsBeforeSuccess: 2 });
  const s = sink(gh.fetchImpl, { maxRetries: 3 });
  await s.record(entry({ target: "eventually" }));
  const rows = await s.listForUser("u1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "eventually");
});

test("gives up after maxRetries 409s", async () => {
  const gh = fakeGitHub({ failPutsBeforeSuccess: 5 });
  const s = sink(gh.fetchImpl, { maxRetries: 1 });
  await assert.rejects(
    s.record(entry()),
    (e: unknown) => e instanceof GitHubApiError && e.status === 409,
  );
});

test("separates users into their own files (no cross-user leakage)", async () => {
  const gh = fakeGitHub();
  const s = sink(gh.fetchImpl);
  await s.record(entry({ userId: "u1", target: "mine" }));
  await s.record(entry({ userId: "u2", target: "yours" }));

  const u1 = await s.listForUser("u1");
  assert.equal(u1.length, 1);
  assert.equal(u1[0].target, "mine");
  assert.ok(gh.files.has("audit/u1.jsonl"));
  assert.ok(gh.files.has("audit/u2.jsonl"));
});

test("surfaces an unexpected status as GitHubApiError", async () => {
  const fetchImpl = (async () =>
    new Response("boom", { status: 500 })) as typeof fetch;
  const s = sink(fetchImpl);
  await assert.rejects(
    s.listForUser("u1"),
    (e: unknown) => e instanceof GitHubApiError && e.status === 500,
  );
});

test("TeeAuditSink writes to every sink and reads from the primary", async () => {
  const gh = fakeGitHub();
  const primary = new InMemoryAuditSink();
  const mirror = sink(gh.fetchImpl);
  const tee = new TeeAuditSink(primary, mirror);

  await tee.record(entry({ target: "mirrored" }));

  // written to both
  assert.equal(primary.entries.length, 1);
  assert.ok(gh.files.has("audit/u1.jsonl"));
  // read comes from the primary
  const rows = await tee.listForUser("u1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "mirrored");
});
