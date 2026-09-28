/**
 * A rule a module refused to break — the one error the domain modules throw.
 *
 * **Modules don't speak HTTP.** `lib/documents`, `lib/notifications` and the
 * rest are called from route handlers today and from webhooks, the cron drain
 * and scripts as well, so they say what went wrong in their own terms and the
 * API layer decides what status that is. `kind` is the whole vocabulary: the
 * handler maps it in one place, and no route has to translate.
 *
 * The message is written for the person on the other end, the same as an
 * `ApiError`'s — it is what the contractor reads when a save is refused.
 */

export type DomainErrorKind =
  /** The thing named doesn't exist, or isn't this shop's. */
  | "not_found"
  /** The request itself is wrong — a missing field, a bad combination. */
  | "invalid"
  /** Allowed in general, refused in this state — a frozen document, a gate. */
  | "conflict"
  /** Not this caller's to do. */
  | "forbidden"
  /** Something outside us didn't work — an email provider, a card network. */
  | "failed";

export class DomainError extends Error {
  constructor(
    message: string,
    readonly kind: DomainErrorKind = "conflict",
    readonly details?: unknown
  ) {
    super(message);
    this.name = "DomainError";
  }
}
