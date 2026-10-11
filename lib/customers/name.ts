/**
 * A customer's name, in parts and as one line.
 *
 * `customers.name` is what every list, picker, search and document prints, and
 * it stays the one line they read. First, last and company are the parts a
 * contractor fills in on the customer's own page. These helpers keep the two in
 * step, so nothing that prints a name has to know the parts exist.
 */

/**
 * What a customer is called before anyone has said who it is — a quote saved
 * before the name was typed. Never split into parts: nobody is named "New".
 */
export const UNNAMED_CUSTOMER = "New customer";

export type NameParts = {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
};

/** Blank is absent — a form clears a field by sending "". */
function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The one line: the person when there is one, the company when there isn't.
 * Null when every part is blank, which a form must refuse.
 */
export function displayName(parts: Partial<NameParts>): string | null {
  const person = [clean(parts.firstName), clean(parts.lastName)]
    .filter(Boolean)
    .join(" ");
  return person || clean(parts.companyName);
}

/**
 * A whole name typed in one box — on a quote, in a picker, in an import —
 * split at the first space. "Ana de la Cruz" is first "Ana", last "de la Cruz".
 * One word is a first name. The contractor can correct the split on the
 * customer's page; guessing smarter than this gets more names wrong, not fewer.
 */
export function splitName(name: string): Pick<NameParts, "firstName" | "lastName"> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed === UNNAMED_CUSTOMER) {
    return { firstName: null, lastName: null };
  }
  const space = trimmed.indexOf(" ");
  if (space === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1),
  };
}

/**
 * The columns to write when only a whole name is known.
 *
 * A customer on file as a company alone ("Harbor Point HOA", no person) stays
 * a company when the name is corrected — splitting it into a first and last
 * name would turn the HOA into a person called Harbor.
 */
export function columnsForName(
  name: string,
  current?: NameParts & { name: string }
): NameParts & { name: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const companyOnly =
    current &&
    !current.firstName &&
    !current.lastName &&
    current.companyName &&
    current.companyName === current.name;

  if (companyOnly) {
    return { name: trimmed, firstName: null, lastName: null, companyName: trimmed };
  }
  return {
    name: trimmed,
    ...splitName(trimmed),
    companyName: current?.companyName ?? null,
  };
}

/**
 * The parts the edit form opens with. A customer made before the parts existed
 * has only a whole name, so it is split here for him to check — and the split
 * is only saved if he saves.
 */
export function partsForForm(customer: NameParts & { name: string }): NameParts {
  if (customer.firstName || customer.lastName || customer.companyName) {
    return {
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName,
    };
  }
  return { ...splitName(customer.name), companyName: null };
}
