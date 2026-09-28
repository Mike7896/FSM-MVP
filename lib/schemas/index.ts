/**
 * Validation schemas, shared by the client forms and the API endpoints.
 *
 * **One schema per thing, imported by both sides.** A form that validates
 * differently from the endpoint behind it produces the worst class of bug in a
 * money product: the client says the input is fine, the server disagrees, and
 * the contractor is left staring at an error they cannot act on. Defining the
 * rule once removes the possibility.
 *
 * The client uses these through `zodResolver` for inline errors; the route
 * handlers parse against the same object and return the field list on a 422.
 * These files must stay free of server-only imports so a client bundle can
 * pull them in.
 */

export * from "./auth";
export * from "./organization";
export * from "./office";
export * from "./customer";
export * from "./job";
export * from "./quote";
export * from "./contract";
export * from "./import";
export * from "./search";
export * from "./capture";
export * from "./invoice";
export * from "./phase";
export * from "./permit";
export * from "./tours";
export * from "./profile";
export * from "./notification";
export * from "./signing";
export * from "./share";
export * from "./schedule";
export * from "./tasks";
export * from "./support";
export * from "./admin";
export * from "./membership";
