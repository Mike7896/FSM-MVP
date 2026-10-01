/**
 * What search searches, and what each group is called.
 *
 * Free of server imports on purpose: the modal in the header and the query on
 * the server read the same list, so a group cannot exist on one side and not
 * the other.
 */

export const SEARCH_KINDS = [
  "customers",
  "jobs",
  "quotes",
  "contracts",
  "change-orders",
  "invoices",
  "tasks",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_LABELS: Record<SearchKind, string> = {
  customers: "Customers",
  jobs: "Jobs",
  quotes: "Quotes",
  contracts: "Contracts",
  "change-orders": "Change orders",
  invoices: "Invoices",
  tasks: "Tasks",
};

export type SearchHit = {
  id: string;
  kind: SearchKind;
  /** The line somebody reads first — a name, or a number and a customer. */
  title: string;
  /** Underneath it: the address, the work, whatever tells two apart. */
  detail: string | null;
  /** Right-hand side: an amount, or where the thing has got to. */
  meta: string | null;
  href: string;
  /** Practice work is findable, and says so. */
  demo: boolean;
};

export type SearchPage = {
  kind: SearchKind;
  hits: SearchHit[];
  /** True when another page exists — what the infinite list watches. */
  hasMore: boolean;
  offset: number;
};
