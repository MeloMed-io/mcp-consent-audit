import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeSatisfies, hasScope } from "./scopes.js";

test("exact scope match", () => {
  assert.equal(scopeSatisfies("emotions:read", "emotions:read"), true);
  assert.equal(scopeSatisfies("emotions:read", "emotions:write"), false);
});

test("global wildcard matches anything", () => {
  assert.equal(scopeSatisfies("*", "journals:read:raw"), true);
});

test("prefix wildcard matches descendants only", () => {
  assert.equal(scopeSatisfies("journals:*", "journals:read"), true);
  assert.equal(scopeSatisfies("journals:*", "journals:read:raw"), true);
  assert.equal(scopeSatisfies("journals:*", "emotions:read"), false);
});

test("read does NOT imply read:raw (data minimization)", () => {
  assert.equal(hasScope(["journals:read"], "journals:read:raw"), false);
  assert.equal(
    hasScope(["journals:read", "journals:read:raw"], "journals:read:raw"),
    true,
  );
});

test("hasScope scans the whole granted list", () => {
  assert.equal(
    hasScope(["emotions:read", "playlists:write"], "playlists:write"),
    true,
  );
  assert.equal(hasScope(["emotions:read"], "playlists:write"), false);
});
