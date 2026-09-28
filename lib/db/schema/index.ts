/**
 * The schema, in the order the Object Model reads.
 *
 * Two sides, and they meet in exactly two one-directional ways: the Office's
 * objects supply data to a Job's documents, and a Customer owns Jobs. Nothing
 * on a Job ever edits an Office object.
 */

export * from "./auth";
export * from "./enums";

// The Office — changed rarely, deliberately, from the Office.
export * from "./office";

// The job — changed constantly, from the work.
export * from "./jobs";
// What somebody has to do — on a job, or for the shop.
export * from "./tasks";
// Who is where, when — visits booked against jobs, and time off.
export * from "./schedule";

// The documents — one `documents` row plus a per-type side table, so everything
// that points *at* a document (share links, sends, signatures, payments,
// evidence, a draw) carries a real foreign key.
export * from "./document-spine";
// How a job's money is planned to come in, stage by stage.
export * from "./draws";
export * from "./compliance";
export * from "./field";
export * from "./sharing";
export * from "./info-requests";

// Stripe read-model — us charging the contractor.
export * from "./billing";

// The outside world — what this product may read and write elsewhere, and the
// queue that carries it there.
export * from "./connections";

// The contractor's own Stripe account — them charging a homeowner, which is a
// different integration from us charging them for the subscription above.
export * from "./connect";

// The append-only record of every dollar that actually moved.
export * from "./ledger";

// Where each person is in each product tour — per person, not per shop.
export * from "./tours";

// What reaches a person about their business, and whether it got there.
export * from "./notifications";
export * from "./change-requests";
export * from "./tags";
// What a contractor sends us — problems, ideas, and asks for a person.
export * from "./support";
// The admin dashboard's log, its admins, and who's online.
export * from "./admin";
