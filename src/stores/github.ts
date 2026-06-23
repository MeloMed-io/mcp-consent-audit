import type { AccessLogEntry, AuditSink } from "../types.js";

/**
 * A GitHub-backed AuditSink: an append-only, externally-hosted mirror of the
 * access log, one commit per entry.
 *
 * The trail lives as one JSON-lines file per user at
 * `<pathPrefix>/<userId>.jsonl` in a private repo. Because every `record()` is
 * a commit, the git history *is* the tamper-evidence: an entry cannot be
 * silently rewritten or dropped without leaving a trace you do not control.
 *
 * Pair it with a fast primary store (e.g. Postgres) via {@link TeeAuditSink} so
 * reads stay local while the durable evidence lives off-box.
 */

/** Thrown when the GitHub Contents API returns an unexpected status. */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.body = body;
  }
}

export interface GitHubAuditSinkConfig {
  /** Repo owner (user or org), e.g. "MeloMed-io". */
  owner: string;
  /** Repo name, e.g. "consent-audit-trail". */
  repo: string;
  /** Fine-grained PAT with Contents: read/write on this repo only. */
  token: string;
  /** Branch to commit to. Default "main". */
  branch?: string;
  /** Directory the per-user files live under. Default "audit". */
  pathPrefix?: string;
  /** Committer label shown in the git history. Default the client name on each entry. */
  committer?: { name: string; email: string };
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Retries on a concurrent-write (409) conflict. Default 3. */
  maxRetries?: number;
}

interface ContentsResponse {
  content: string; // base64, may contain newlines
  sha: string;
}

function serializeEntry(e: AccessLogEntry): string {
  return JSON.stringify({ ...e, at: e.at.toISOString() });
}

function parseEntry(line: string): AccessLogEntry {
  const o = JSON.parse(line) as AccessLogEntry & { at: string };
  return { ...o, at: new Date(o.at) };
}

export class GitHubAuditSink implements AuditSink {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly branch: string;
  private readonly pathPrefix: string;
  private readonly committer?: { name: string; email: string };
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(config: GitHubAuditSinkConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.token = config.token;
    this.branch = config.branch ?? "main";
    this.pathPrefix = config.pathPrefix ?? "audit";
    this.committer = config.committer;
    this.maxRetries = config.maxRetries ?? 3;
    const f = config.fetchImpl ?? globalThis.fetch;
    if (!f) {
      throw new Error(
        "GitHubAuditSink needs a fetch implementation (Node 18+, or pass fetchImpl).",
      );
    }
    this.fetchImpl = f;
  }

  private pathFor(userId: string): string {
    return `${this.pathPrefix}/${encodeURIComponent(userId)}.jsonl`;
  }

  private async api(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return this.fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Read the current file, or null if it does not exist yet. */
  private async readFile(
    userId: string,
  ): Promise<{ text: string; sha: string } | null> {
    const p = this.pathFor(userId);
    const res = await this.api(
      "GET",
      `/repos/${this.owner}/${this.repo}/contents/${p}?ref=${encodeURIComponent(this.branch)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new GitHubApiError(
        res.status,
        await res.text(),
        `Failed to read audit file ${p} (${res.status}).`,
      );
    }
    const json = (await res.json()) as ContentsResponse;
    const text = Buffer.from(json.content, "base64").toString("utf8");
    return { text, sha: json.sha };
  }

  async record(entry: AccessLogEntry): Promise<void> {
    const p = this.pathFor(entry.userId ?? "_unattributed");
    const line = serializeEntry(entry);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const existing = await this.readFile(entry.userId ?? "_unattributed");
      const nextText = existing ? `${existing.text}${line}\n` : `${line}\n`;

      const res = await this.api(
        "PUT",
        `/repos/${this.owner}/${this.repo}/contents/${p}`,
        {
          message: `audit: ${entry.decision} ${entry.action} ${entry.target}`,
          content: Buffer.from(nextText, "utf8").toString("base64"),
          branch: this.branch,
          sha: existing?.sha,
          committer: this.committer,
        },
      );

      if (res.ok) return;
      // 409: the file moved under us (concurrent append). Re-read and retry.
      if (res.status === 409 && attempt < this.maxRetries) continue;
      throw new GitHubApiError(
        res.status,
        await res.text(),
        `Failed to append audit entry to ${p} (${res.status}).`,
      );
    }
  }

  async listForUser(
    userId: string,
    opts?: { limit?: number },
  ): Promise<AccessLogEntry[]> {
    const file = await this.readFile(userId);
    if (!file) return [];
    const rows = file.text
      .split("\n")
      .filter((l) => l.length > 0)
      .map(parseEntry)
      .reverse(); // file is append order (oldest first); callers want newest first
    return opts?.limit ? rows.slice(0, opts.limit) : rows;
  }
}

/**
 * Fans `record()` out to several sinks and reads from the first.
 *
 * Typical use: a fast primary (Postgres) plus a {@link GitHubAuditSink} mirror.
 * Reads come from the primary; the mirror is write-only durable evidence.
 */
export class TeeAuditSink implements AuditSink {
  private readonly primary: AuditSink;
  private readonly mirrors: AuditSink[];

  constructor(primary: AuditSink, ...mirrors: AuditSink[]) {
    this.primary = primary;
    this.mirrors = mirrors;
  }

  async record(entry: AccessLogEntry): Promise<void> {
    await Promise.all(
      [this.primary, ...this.mirrors].map((s) => s.record(entry)),
    );
  }

  async listForUser(
    userId: string,
    opts?: { limit?: number },
  ): Promise<AccessLogEntry[]> {
    return this.primary.listForUser(userId, opts);
  }
}
