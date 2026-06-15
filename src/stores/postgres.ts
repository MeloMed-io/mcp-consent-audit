import { createHash } from "node:crypto";
import type {
  AccessLogEntry,
  AuditSink,
  Grant,
  GrantStore,
} from "../types.js";

/**
 * Minimal query interface so this package depends on no specific driver.
 * Adapt a `pg` Pool (`(text, params) => pool.query(text, params)`) or a
 * Supabase RPC. Returns rows in `node-postgres` shape.
 */
export type SqlQuery = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

/** sha256 hex of a raw token. Store only the hash; compare by hashing input. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface GrantRow {
  id: string;
  user_id: string;
  client_name: string;
  scopes: string[] | null;
  purpose: string | null;
  granted_at: string | Date;
  revoked_at: string | Date | null;
}

function rowToGrant(r: GrantRow): Grant {
  return {
    id: r.id,
    userId: r.user_id,
    clientName: r.client_name,
    scopes: r.scopes ?? [],
    purpose: r.purpose ?? undefined,
    grantedAt: new Date(r.granted_at),
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
  };
}

export function createPostgresGrantStore(query: SqlQuery): GrantStore {
  return {
    async resolveToken(token) {
      const { rows } = await query<GrantRow>(
        `select id, user_id, client_name, scopes, purpose, granted_at, revoked_at
           from mcp_grants
          where token_hash = $1
          limit 1`,
        [hashToken(token)],
      );
      return rows.length ? rowToGrant(rows[0]) : null;
    },

    async revoke(grantId) {
      const { rows } = await query<{ id: string }>(
        `update mcp_grants
            set revoked_at = now()
          where id = $1 and revoked_at is null
        returning id`,
        [grantId],
      );
      return rows.length > 0;
    },

    async listForUser(userId, opts) {
      const { rows } = await query<GrantRow>(
        `select id, user_id, client_name, scopes, purpose, granted_at, revoked_at
           from mcp_grants
          where user_id = $1
            ${opts?.includeRevoked ? "" : "and revoked_at is null"}
          order by granted_at desc`,
        [userId],
      );
      return rows.map(rowToGrant);
    },
  };
}

interface LogRow {
  user_id: string | null;
  client_name: string | null;
  action: AccessLogEntry["action"];
  target: string;
  scope_used: string | null;
  severity: AccessLogEntry["severity"];
  decision: AccessLogEntry["decision"];
  reason: string | null;
  request_id: string | null;
  created_at: string | Date;
}

export function createPostgresAuditSink(query: SqlQuery): AuditSink {
  return {
    async record(e) {
      await query(
        `insert into access_log
           (user_id, client_name, action, target, scope_used,
            severity, decision, reason, request_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          e.userId,
          e.clientName,
          e.action,
          e.target,
          e.scopeUsed,
          e.severity,
          e.decision,
          e.reason ?? null,
          e.requestId ?? null,
          e.at,
        ],
      );
    },

    async listForUser(userId, opts) {
      const limit = opts?.limit ? Number(opts.limit) : null;
      const { rows } = await query<LogRow>(
        `select user_id, client_name, action, target, scope_used,
                severity, decision, reason, request_id, created_at
           from access_log
          where user_id = $1
          order by created_at desc
          ${limit ? `limit ${limit}` : ""}`,
        [userId],
      );
      return rows.map((r) => ({
        userId: r.user_id,
        clientName: r.client_name,
        action: r.action,
        target: r.target,
        scopeUsed: r.scope_used,
        severity: r.severity,
        decision: r.decision,
        reason: r.reason,
        requestId: r.request_id,
        at: new Date(r.created_at),
      }));
    },
  };
}
