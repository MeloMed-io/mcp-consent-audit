export type ConsentDenialReason =
  | "missing_token"
  | "invalid_token"
  | "revoked_grant"
  | "missing_scope";

/** Thrown by authorize() when access is denied. Carries an HTTP-ish status. */
export class ConsentError extends Error {
  readonly reason: ConsentDenialReason;
  /** 401 for authentication failures, 403 for authorization (scope/revocation). */
  readonly status: number;

  constructor(reason: ConsentDenialReason, message: string) {
    super(message);
    this.name = "ConsentError";
    this.reason = reason;
    this.status =
      reason === "missing_token" || reason === "invalid_token" ? 401 : 403;
  }
}
