import { ConsentError, type ConsentDenialReason } from "./errors.js";
import { hasScope } from "./scopes.js";
import type {
  ActionType,
  AuditSink,
  GrantStore,
  Principal,
  Scope,
  Severity,
} from "./types.js";

export interface AuthorizeDeps {
  store: GrantStore;
  audit: AuditSink;
  /** Clock injection point (override in tests). Defaults to wall-clock. */
  now?: () => Date;
}

export interface AuthorizeRequest {
  token: string | null | undefined;
  required: Scope;
  action: ActionType;
  target: string;
  severity?: Severity;
  requestId?: string | null;
}

/**
 * The single chokepoint: resolve token → enforce revocation → enforce scope,
 * recording EVERY decision (allow and deny) to the audit sink. Returns the
 * Principal on success; throws ConsentError on denial.
 */
export async function authorize(
  deps: AuthorizeDeps,
  req: AuthorizeRequest,
): Promise<Principal> {
  const now = deps.now ?? (() => new Date());
  const severity: Severity = req.severity ?? "normal";

  const deny = async (
    reason: ConsentDenialReason,
    userId: string | null,
    clientName: string | null,
  ): Promise<void> => {
    await deps.audit.record({
      userId,
      clientName,
      action: req.action,
      target: req.target,
      scopeUsed: req.required,
      severity,
      decision: "deny",
      reason,
      requestId: req.requestId ?? null,
      at: now(),
    });
  };

  if (!req.token) {
    await deny("missing_token", null, null);
    throw new ConsentError("missing_token", "No access token supplied.");
  }

  const grant = await deps.store.resolveToken(req.token);
  if (!grant) {
    await deny("invalid_token", null, null);
    throw new ConsentError(
      "invalid_token",
      "Access token does not resolve to a grant.",
    );
  }

  if (grant.revokedAt) {
    await deny("revoked_grant", grant.userId, grant.clientName);
    throw new ConsentError("revoked_grant", "This grant has been revoked.");
  }

  if (!hasScope(grant.scopes, req.required)) {
    await deny("missing_scope", grant.userId, grant.clientName);
    throw new ConsentError(
      "missing_scope",
      `Grant is missing required scope: ${req.required}`,
    );
  }

  await deps.audit.record({
    userId: grant.userId,
    clientName: grant.clientName,
    action: req.action,
    target: req.target,
    scopeUsed: req.required,
    severity,
    decision: "allow",
    reason: null,
    requestId: req.requestId ?? null,
    at: now(),
  });

  return {
    grantId: grant.id,
    userId: grant.userId,
    clientName: grant.clientName,
    scopes: grant.scopes,
  };
}

export interface ConsentSpec<I> {
  required: Scope;
  action: ActionType;
  severity?: Severity;
  /** A static target string, or a function deriving it from the handler input. */
  target: string | ((input: I) => string);
}

export interface CallContext {
  token?: string | null;
  requestId?: string | null;
}

/**
 * Wrap a handler so it only runs after authorize() passes. The Principal is
 * threaded into the handler; the caller supplies token + requestId per call.
 */
export function withConsent<I, O>(
  deps: AuthorizeDeps,
  spec: ConsentSpec<I>,
  handler: (input: I, principal: Principal) => Promise<O>,
): (input: I, ctx: CallContext) => Promise<O> {
  return async (input: I, ctx: CallContext): Promise<O> => {
    const target =
      typeof spec.target === "function" ? spec.target(input) : spec.target;
    const principal = await authorize(deps, {
      token: ctx.token,
      required: spec.required,
      action: spec.action,
      target,
      severity: spec.severity,
      requestId: ctx.requestId,
    });
    return handler(input, principal);
  };
}
