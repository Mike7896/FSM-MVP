import "server-only";

import { and, eq } from "drizzle-orm";

import { ApiError } from "@/lib/api/response";
import { db } from "@/lib/db";
import { customerNotes, customers } from "@/lib/db/schema";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "@/lib/schemas/customer";

import { displayName, splitName } from "./name";

/**
 * Writing a customer — one path for the web form, the native app and anything
 * else that adds or edits one, so `name` can never fall out of step with the
 * first, last and company it is made from.
 */

/** Blank is absent: a form clears a field by sending "". */
function blankToNull(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The detail columns, each normalised, leaving out what wasn't sent. */
function detailColumns(input: UpdateCustomerInput | CreateCustomerInput) {
  const columns = {
    email: blankToNull(input.email),
    altEmail: blankToNull(input.altEmail),
    phone: blankToNull(input.phone),
    altPhone: blankToNull(input.altPhone),
    preferredContact:
      input.preferredContact === undefined
        ? undefined
        : input.preferredContact || null,
    address: blankToNull(input.address),
    billingAddress: blankToNull(input.billingAddress),
    accessNotes: blankToNull(input.accessNotes),
    leadSource: blankToNull(input.leadSource),
  };
  return Object.fromEntries(
    Object.entries(columns).filter(([, value]) => value !== undefined)
  ) as Partial<{ [K in keyof typeof columns]: Exclude<(typeof columns)[K], undefined> }>;
}

export async function createCustomer({
  organizationId,
  userId,
  input,
}: {
  organizationId: string;
  userId: string | null;
  input: CreateCustomerInput;
}) {
  // A whole name from a single-box client is split; parts, when sent, win.
  const sentParts =
    input.firstName?.trim() || input.lastName?.trim() || input.companyName?.trim();
  const parts = sentParts
    ? {
        firstName: blankToNull(input.firstName) ?? null,
        lastName: blankToNull(input.lastName) ?? null,
        companyName: blankToNull(input.companyName) ?? null,
      }
    : { ...splitName(input.name ?? ""), companyName: null };

  const name = displayName(parts) ?? input.name?.trim();
  if (!name) {
    throw new ApiError(
      "invalid_request",
      "Enter a first name, a last name or a company."
    );
  }

  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({ organizationId, name, ...parts, ...detailColumns(input) })
      .returning();

    const note = input.notes?.trim();
    if (note) {
      await tx.insert(customerNotes).values({
        organizationId,
        customerId: customer.id,
        body: note,
        createdBy: userId,
      });
    }

    return customer;
  });
}

export async function updateCustomer({
  organizationId,
  customerId,
  input,
}: {
  organizationId: string;
  customerId: string;
  input: UpdateCustomerInput;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        name: customers.name,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
      })
      .from(customers)
      .where(
        and(
          eq(customers.id, customerId),
          eq(customers.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!current) {
      throw new ApiError("not_found", "No customer with that id in this shop.");
    }

    const touchesParts =
      input.firstName !== undefined ||
      input.lastName !== undefined ||
      input.companyName !== undefined;

    let nameColumns: Partial<typeof customers.$inferInsert> = {};

    if (touchesParts) {
      const parts = {
        firstName:
          input.firstName === undefined
            ? current.firstName
            : (blankToNull(input.firstName) ?? null),
        lastName:
          input.lastName === undefined
            ? current.lastName
            : (blankToNull(input.lastName) ?? null),
        companyName:
          input.companyName === undefined
            ? current.companyName
            : (blankToNull(input.companyName) ?? null),
      };
      const name = displayName(parts);
      if (!name) {
        throw new ApiError(
          "invalid_request",
          "Enter a first name, a last name or a company."
        );
      }
      nameColumns = { ...parts, name };
    } else if (input.name?.trim()) {
      // A whole name alone, from a single-box client.
      nameColumns = {
        name: input.name.trim(),
        ...splitName(input.name),
      };
    }

    const [updated] = await tx
      .update(customers)
      .set({ ...nameColumns, ...detailColumns(input), updatedAt: new Date() })
      .where(
        and(
          eq(customers.id, customerId),
          eq(customers.organizationId, organizationId)
        )
      )
      .returning();

    return updated;
  });
}
