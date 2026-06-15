import type { Scope } from "./types.js";

/**
 * Does a single granted scope satisfy a required scope?
 *
 *  - exact match:            "emotions:read"  satisfies "emotions:read"
 *  - global wildcard:        "*"              satisfies anything
 *  - prefix wildcard:        "journals:*"     satisfies "journals:read" and "journals:read:raw"
 *
 * Crucially, there is NO implicit hierarchy: "journals:read" does NOT satisfy
 * "journals:read:raw". Reading raw journal text is a deliberate, separately
 * granted step up (data minimization).
 */
export function scopeSatisfies(granted: Scope, required: Scope): boolean {
  if (granted === required) return true;
  if (granted === "*") return true;
  if (granted.endsWith(":*")) {
    const prefix = granted.slice(0, -1); // "journals:*" -> "journals:"
    return required.startsWith(prefix);
  }
  return false;
}

/** Does any scope in the granted list satisfy the required scope? */
export function hasScope(granted: Scope[], required: Scope): boolean {
  return granted.some((g) => scopeSatisfies(g, required));
}
