// Runnable end-to-end example. Build the library, then run this file:
//
//   npm run example
//
// It shows the whole lifecycle: grant access, allow a call, deny an
// out-of-scope call, then revoke and watch the same call fail — all while
// every decision lands in a user-visible audit trail.

import {
  withConsent,
  authorize,
  ConsentError,
  InMemoryGrantStore,
  InMemoryAuditSink,
} from "../dist/index.js";

const store = new InMemoryGrantStore();
const audit = new InMemoryAuditSink();
const deps = { store, audit };

// 1. A user (candy) grants "Claude Desktop" two scopes, reachable by a token.
//    Note: she grants journals:read but NOT journals:read:raw.
store.add(
  {
    id: "grant_1",
    userId: "candy",
    clientName: "Claude Desktop",
    scopes: ["playlists:write", "journals:read"],
    purpose: "weekly reflection",
    grantedAt: new Date(),
    revokedAt: null,
  },
  "tok_secret_123",
);

// 2. An in-scope tool call: generate a playlist. This is allowed.
const generatePlaylist = withConsent(
  deps,
  { required: "playlists:write", action: "tool.call", target: "generate_playlist" },
  async (input, principal) => {
    return `playlist for ${principal.userId} (mood: ${input.mood})`;
  },
);

console.log("1) in-scope call:");
console.log("  ", await generatePlaylist({ mood: "calm" }, { token: "tok_secret_123" }));

// 3. An elevated call she did NOT consent to: reading RAW journal text.
//    journals:read does NOT imply journals:read:raw — this is denied (403).
console.log("\n2) elevated call she didn't grant (raw journal text):");
try {
  await authorize(deps, {
    token: "tok_secret_123",
    required: "journals:read:raw",
    action: "resource.read",
    target: "app://journals/abc",
    severity: "elevated",
  });
} catch (e) {
  if (e instanceof ConsentError) console.log(`   denied ${e.status}: ${e.reason}`);
}

// 4. Candy revokes the grant. The previously-allowed call now fails (403).
await store.revoke("grant_1");
console.log("\n3) same playlist call AFTER revocation:");
try {
  await generatePlaylist({ mood: "calm" }, { token: "tok_secret_123" });
} catch (e) {
  if (e instanceof ConsentError) console.log(`   denied ${e.status}: ${e.reason}`);
}

// 5. The audit trail Candy would see in an "Apps with access" screen.
console.log("\n4) audit trail (newest first):");
for (const row of await audit.listForUser("candy")) {
  console.log(`   ${row.decision.padEnd(5)} ${row.action} ${row.target} ${row.reason ?? ""}`);
}
