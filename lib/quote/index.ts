/**
 * The quote domain — one module the editor, the API, the share projection and
 * the server all import from.
 *
 * Nothing in here touches the database, React or the network. That is what lets
 * the same totals run in the contractor's browser, in the homeowner's share
 * page and on the server when an accepted Quote becomes a Contract, with no
 * chance of the three disagreeing about what a job costs.
 */

export * from "./types";
export * from "./tree";
export * from "./money";
export * from "./sections";
export * from "./totals";
export * from "./draft";
export * from "./seed";
export * from "./units";
export * from "./disclosure";
