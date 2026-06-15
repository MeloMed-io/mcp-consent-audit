import type {
  AccessLogEntry,
  AuditSink,
  Grant,
  GrantStore,
} from "../types.js";

/** In-memory GrantStore for tests and local dev. Not for production. */
export class InMemoryGrantStore implements GrantStore {
  private readonly grants = new Map<string, Grant>(); // grantId -> grant
  private readonly tokens = new Map<string, string>(); // token   -> grantId

  /** Seed a grant reachable by the given token. */
  add(grant: Grant, token: string): void {
    this.grants.set(grant.id, grant);
    this.tokens.set(token, grant.id);
  }

  async resolveToken(token: string): Promise<Grant | null> {
    const id = this.tokens.get(token);
    if (!id) return null;
    return this.grants.get(id) ?? null;
  }

  async revoke(grantId: string): Promise<boolean> {
    const g = this.grants.get(grantId);
    if (!g || g.revokedAt) return false;
    g.revokedAt = new Date();
    return true;
  }

  async listForUser(
    userId: string,
    opts?: { includeRevoked?: boolean },
  ): Promise<Grant[]> {
    return [...this.grants.values()].filter(
      (g) => g.userId === userId && (opts?.includeRevoked || !g.revokedAt),
    );
  }
}

/** In-memory AuditSink for tests and local dev. Not for production. */
export class InMemoryAuditSink implements AuditSink {
  readonly entries: AccessLogEntry[] = [];

  async record(entry: AccessLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async listForUser(
    userId: string,
    opts?: { limit?: number },
  ): Promise<AccessLogEntry[]> {
    const rows = this.entries
      .filter((e) => e.userId === userId)
      .slice()
      .reverse();
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }
}
