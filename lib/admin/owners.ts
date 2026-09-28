import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * The owners — named in `ADMIN_EMAILS` on the deploy, always admins, never
 * changeable from the panel. No framework imports, so account code (and the
 * check scripts) can ask without pulling in page routing.
 */

export type Admin = { userId: string; email: string; owner: boolean };

export function ownerEmails(): string[] {
  return (serverEnv().ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(email: string | null | undefined) {
  return Boolean(email) && ownerEmails().includes(email!.toLowerCase());
}
