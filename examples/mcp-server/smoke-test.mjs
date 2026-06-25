// Smoke test: spawn the server over stdio, exercise every tool, and confirm
// the consent layer allows mood data but blocks raw entries. Run: npm run smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

const rawGranted = process.env.DEMO_GRANT_RAW === "1";

// Forward env to the spawned server (StdioClientTransport otherwise sanitizes it,
// so DEMO_GRANT_RAW would never reach the child).
const transport = new StdioClientTransport({
  command: "node",
  args: ["server.mjs"],
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const text = (r) => r.content.map((c) => c.text).join("\n");
const call = (name, args = {}) => client.callTool({ name, arguments: args });

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "), "\n");

const mood = await call("get_mood_timeline");
console.log("get_mood_timeline ->", mood.isError ? "DENIED" : "allowed");
assert.ok(!mood.isError, "mood timeline should be allowed");

const search = await call("search_entries", { query: "" });
console.log("search_entries    ->", search.isError ? "DENIED" : "allowed");
assert.ok(!search.isError, "search should be allowed");

const raw = await call("read_entry", { id: "2026-06-21" });
console.log("read_entry        ->", raw.isError ? "DENIED" : "allowed");
if (rawGranted) {
  assert.ok(!raw.isError, "raw entry should be allowed once journals:read:raw is granted");
} else {
  assert.ok(raw.isError, "raw entry MUST be denied without journals:read:raw");
}
console.log("   " + text(raw).split("\n")[0]);

const log = await call("show_access_log");
console.log("\naccess log:\n" + text(log).split("\n").map((l) => "   " + l).join("\n"));

await client.close();
console.log(
  rawGranted
    ? "\nOK: raw scope granted, so read_entry is now ALLOWED. Every decision logged."
    : "\nOK: mood + summaries allowed, raw entry blocked, every decision logged.",
);
