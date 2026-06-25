#!/usr/bin/env node
/**
 * Example MCP server: a private journal, gated by mcp-consent-audit.
 *
 * The whole point of the demo: an MCP client (Claude Desktop) connects with a
 * grant that allows DERIVED mood data and entry summaries, but NOT raw diary
 * text. So Claude can reason about how you felt, and is *blocked* from reading
 * what you actually wrote. Every decision, allow or deny, lands in the log.
 *
 * This is an EXAMPLE: in-memory stores + sample data + one hardcoded demo grant.
 * A real server (see ../../README.md) swaps in the Postgres / GitHub-backed
 * stores and a real per-user OAuth token instead of the single grant below.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  authorize,
  ConsentError,
  InMemoryGrantStore,
  InMemoryAuditSink,
} from "mcp-consent-audit";
import { entries, moodTimeline } from "./sample-data.mjs";

const USER_ID = "you";
const CLIENT = "Claude Desktop";
const TOKEN = process.env.DEMO_GRANT_TOKEN ?? "demo-token";

// --- the consent layer ----------------------------------------------------
const store = new InMemoryGrantStore();
const audit = new InMemoryAuditSink();
const deps = { store, audit };

// The grant Claude was given: mood summaries YES, raw diary text NO.
// Flip DEMO_GRANT_RAW=1 to also grant journals:read:raw and watch read_entry
// switch from denied to allowed.
const scopes = ["emotions:read", "journals:read"];
if (process.env.DEMO_GRANT_RAW === "1") scopes.push("journals:read:raw");

store.add(
  {
    id: "grant_demo",
    userId: USER_ID,
    clientName: CLIENT,
    scopes,
    purpose: "weekly reflection",
    grantedAt: new Date(),
    revokedAt: null,
  },
  TOKEN,
);

const ok = (text) => ({ content: [{ type: "text", text }] });
const denied = (e) => ({
  content: [
    {
      type: "text",
      text: `🚫 ${e.status} ${e.reason}: ${e.message}\nThis attempt was recorded in the access log. Reading raw journal text needs a separate, explicit consent grant (journals:read:raw).`,
    },
  ],
  isError: true,
});

// --- the MCP server -------------------------------------------------------
const server = new McpServer({ name: "journal-consent-demo", version: "0.1.0" });

server.registerTool(
  "get_mood_timeline",
  {
    title: "Get mood timeline",
    description:
      "Returns the user's derived mood timeline (valence/arousal per day). Derived data only, never raw journal text. Use when asked how the user has been feeling lately.",
    inputSchema: {},
  },
  async () => {
    try {
      await authorize(deps, {
        token: TOKEN,
        required: "emotions:read",
        action: "resource.read",
        target: "journal://emotions/timeline",
      });
      return ok(JSON.stringify(moodTimeline, null, 2));
    } catch (e) {
      if (e instanceof ConsentError) return denied(e);
      throw e;
    }
  },
);

server.registerTool(
  "search_entries",
  {
    title: "Search journal entries",
    description:
      "Returns matching journal entries as id + date + one-line SUMMARY (never the full text). Use when asked what the user journaled about.",
    inputSchema: { query: z.string().describe("Free-text search over entry summaries.") },
  },
  async ({ query }) => {
    try {
      await authorize(deps, {
        token: TOKEN,
        required: "journals:read",
        action: "tool.call",
        target: "search_entries",
      });
      const q = (query ?? "").toLowerCase();
      const hits = entries
        .filter((e) => !q || e.summary.toLowerCase().includes(q) || e.mood.includes(q))
        .map((e) => ({ id: e.id, date: e.date, mood: e.mood, summary: e.summary }));
      return ok(JSON.stringify(hits, null, 2));
    } catch (e) {
      if (e instanceof ConsentError) return denied(e);
      throw e;
    }
  },
);

server.registerTool(
  "read_entry",
  {
    title: "Read a raw journal entry",
    description:
      "Returns the FULL RAW TEXT of one journal entry by id. Elevated, sensitive access. Use only when the user explicitly asks to read a specific entry verbatim.",
    inputSchema: { id: z.string().describe("Entry id, e.g. 2026-06-21.") },
  },
  async ({ id }) => {
    try {
      await authorize(deps, {
        token: TOKEN,
        required: "journals:read:raw",
        action: "resource.read",
        severity: "elevated",
        target: `journal://entries/${id}`,
      });
      const entry = entries.find((e) => e.id === id);
      return ok(entry ? entry.body : `No entry with id ${id}.`);
    } catch (e) {
      if (e instanceof ConsentError) return denied(e);
      throw e;
    }
  },
);

server.registerTool(
  "show_access_log",
  {
    title: "Show the access log",
    description:
      "Returns the audit trail of what this app has accessed or attempted on the user's data, newest first. Every allow and every denial is recorded.",
    inputSchema: {},
  },
  async () => {
    const rows = await audit.listForUser(USER_ID);
    const lines = rows.map(
      (r) =>
        `${r.decision.toUpperCase().padEnd(5)} ${r.action.padEnd(13)} ${r.target}${r.reason ? `  (${r.reason})` : ""}`,
    );
    return ok(lines.length ? lines.join("\n") : "No access recorded yet.");
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// Log to stderr so it never corrupts the stdio JSON-RPC stream on stdout.
console.error("journal-consent-demo MCP server running on stdio.");
