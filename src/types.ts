/** A capability scope, e.g. "emotions:read" or "journals:read:raw". */
export type Scope = string;

/** Audit severity. Elevated marks access to especially sensitive data (e.g. raw journals). */
export type Severity = "normal" | "elevated";

/** The kind of MCP operation being authorized. */
export type ActionType =
  | "tool.call"
  | "resource.read"
  | "resource.list"
  | "prompt.get";

/** An app's scoped, revocable access on behalf of one user. */
export interface Grant {
  id: string;
  userId: string;
  clientName: string;
  scopes: Scope[];
  purpose?: string;
  grantedAt: Date;
  /** null/undefined = active. */
  revokedAt?: Date | null;
}

/** One row in the append-only access log. */
export interface AccessLogEntry {
  userId: string | null;
  clientName: string | null;
  action: ActionType;
  target: string;
  scopeUsed: Scope | null;
  severity: Severity;
  decision: "allow" | "deny";
  reason?: string | null;
  requestId?: string | null;
  at: Date;
}

/** The authenticated, authorized caller, returned on a successful authorize(). */
export interface Principal {
  grantId: string;
  userId: string;
  clientName: string;
  scopes: Scope[];
}

/**
 * Resolves opaque tokens to grants and manages revocation.
 * Token lookup only — revocation/scope POLICY lives in authorize(), not here.
 */
export interface GrantStore {
  /** Resolve a token to its grant (including revoked ones), or null if unknown. */
  resolveToken(token: string): Promise<Grant | null>;
  /** Revoke a grant. Returns true if a row went from active → revoked. */
  revoke(grantId: string): Promise<boolean>;
  /** Grants for a user — powers the "Apps with access" screen. */
  listForUser(
    userId: string,
    opts?: { includeRevoked?: boolean },
  ): Promise<Grant[]>;
}

/** Persists the audit trail and exposes it back to the user. */
export interface AuditSink {
  record(entry: AccessLogEntry): Promise<void>;
  /** The access trail for a user — powers the user-visible audit log. */
  listForUser(
    userId: string,
    opts?: { limit?: number },
  ): Promise<AccessLogEntry[]>;
}
