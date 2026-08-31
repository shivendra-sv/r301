/** Canonical code → HTTP status table: docs/api-contract.md §Error envelope. */
export const ERROR_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  slug_taken: 409,
  idempotency_conflict: 409,
  slug_reserved: 422,
  destination_invalid: 422,
  destination_blocked: 422,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS;

/**
 * Statuses an error may carry: those the table yields, plus 415 — the one
 * status the table cannot derive, since `invalid_request` normally means 400
 * (api-contract notes 415 as carrying that same code).
 */
export type ErrorStatus = (typeof ERROR_STATUS)[ErrorCode] | 415;

/** Wire shape clients see for every error (api-contract §Error envelope). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    /** Present only when one field is at fault. */
    field?: string;
    request_id: string;
  };
}

/** Thrown by routes and middleware; rendered as the envelope by the error handler. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly field: string | undefined;

  readonly status: ErrorStatus;

  constructor(code: ErrorCode, message: string, field?: string, status?: ErrorStatus) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.field = field;
    this.status = status ?? ERROR_STATUS[code];
  }
}

export function envelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  field?: string,
): ErrorEnvelope {
  const error: ErrorEnvelope["error"] = { code, message, request_id: requestId };

  // `field` is present only when one field is at fault (api-contract).
  if (field !== undefined) {
    error.field = field;
  }

  return { error };
}
