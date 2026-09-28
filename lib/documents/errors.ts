import { DomainError, type DomainErrorKind } from "@/lib/errors";

/**
 * A document rule, refused.
 *
 * The same `DomainError` every module throws, named for where it came from so a
 * log line says which half of the system said no. A frozen document, a missing
 * letterhead, a quote from another shop — each carries the sentence the
 * contractor should read, and the API layer turns its kind into a status.
 */
export class DocumentError extends DomainError {
  constructor(
    message: string,
    kind: DomainErrorKind = "conflict",
    details?: unknown
  ) {
    super(message, kind, details);
    this.name = "DocumentError";
  }
}
