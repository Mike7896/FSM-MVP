import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/**
 * One response shape for the whole API.
 *
 * Success is `{ data }`, failure is `{ error: { code, message, details? } }`.
 * A client — the native app, Postman, a future integration — should never have
 * to guess which shape it got, and `code` is what it branches on rather than
 * the prose in `message`, which is free to change.
 */

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "internal";

const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 422,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function created<T>(data: T, location?: string) {
  return NextResponse.json(
    { data },
    { status: 201, headers: location ? { Location: location } : undefined }
  );
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: unknown
) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS[code] }
  );
}

/**
 * Turns a Zod failure into a flat, machine-readable list.
 *
 * `path` is joined with dots so a mobile client can map an error straight onto
 * the field that produced it without walking a nested tree.
 */
export function invalid(error: ZodError) {
  return fail(
    "invalid_request",
    "Some fields didn't pass validation.",
    error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      message: issue.message,
      code: issue.code,
    }))
  );
}

/**
 * A thrown `ApiError` short-circuits a handler with a proper status. Used by
 * the auth and scoping helpers so they can refuse without every caller
 * remembering to check a return value.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}
