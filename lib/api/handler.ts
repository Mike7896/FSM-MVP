import "server-only";

import type { NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";

import { DomainError, type DomainErrorKind } from "@/lib/errors";

import { ApiError, fail, invalid, type ApiErrorCode } from "./response";

/**
 * Wraps a route handler so every endpoint fails the same way.
 *
 * Without this each handler grows its own try/catch and its own idea of what a
 * 500 looks like, and the API stops being predictable — which is the whole
 * point of having one. A thrown `ApiError` becomes its status; a `DomainError`
 * from a module becomes the status its kind names; a Zod failure becomes a
 * field list; anything else is logged and becomes a flat 500 that leaks
 * nothing.
 */
export function handler(
  fn: (request: NextRequest) => Promise<Response>
): (request: NextRequest) => Promise<Response> {
  return async (request) => {
    try {
      return await fn(request);
    } catch (error) {
      return failure(request, error);
    }
  };
}

/**
 * Same wrapper for routes with dynamic params. Next 16 hands `params` in as a
 * promise, so it is awaited here once rather than in every handler.
 */
export function handlerWithParams<P extends Record<string, string>>(
  fn: (request: NextRequest, params: P) => Promise<Response>
): (request: NextRequest, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    try {
      return await fn(request, await context.params);
    } catch (error) {
      return failure(request, error);
    }
  };
}

/**
 * What a module's refusal is, in HTTP.
 *
 * `failed` is a 500 with the module's own words rather than the generic line:
 * "the email didn't go out" is something the contractor can act on, where
 * "something went wrong" is not.
 */
const DOMAIN_CODES: Record<DomainErrorKind, ApiErrorCode> = {
  not_found: "not_found",
  invalid: "invalid_request",
  conflict: "conflict",
  forbidden: "forbidden",
  failed: "internal",
};

function failure(request: NextRequest, error: unknown): Response {
  if (error instanceof ApiError) {
    return fail(error.code, error.message, error.details);
  }
  if (error instanceof DomainError) {
    return fail(DOMAIN_CODES[error.kind], error.message, error.details);
  }
  if (error instanceof ZodError) {
    return invalid(error);
  }
  // Never surface a driver message to a client — it names tables.
  //
  // Content Design §7.4: "something went wrong" is not an error message. If
  // the product cannot say what happened, it says what it will do about it,
  // and the thing a contractor actually needs to know is whether their work
  // survived.
  console.error(
    `[api] ${request.method} ${new URL(request.url).pathname} failed:`,
    error
  );
  return fail(
    "internal",
    "That didn't save — the problem is on our end, and it's logged. Nothing you'd entered was lost. Try again in a moment."
  );
}

/** Parses a JSON body against a schema, or throws a 422 with the field list. */
export async function readJson<T>(
  request: NextRequest,
  schema: ZodType<T>
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("invalid_request", "Send a JSON body.");
  }
  return schema.parse(body);
}

/** Reads and validates query parameters the same way. */
export function readQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  return schema.parse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
}
