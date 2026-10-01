/**
 * BILLING — how a job's money is planned, and what it adds up to.
 *
 * The documents module owns the bills themselves; this owns the plan behind
 * them and the arithmetic over them:
 *
 * - `schedule` — the stages a job's terms imply, and writing them onto the job.
 * - `settlement` — agreed, billed, collected, left: both sides of the system in
 *   one read, and what the final invoice is built from.
 * - `status` — moving the job along its own lifecycle as its money moves.
 */
export * from "./schedule";
export * from "./settlement";
export { refreshJobStatus } from "./status";
