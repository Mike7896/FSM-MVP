"use client";

import { SignBlock } from "@/components/signing/sign-block";

/**
 * The customer's signature on the contract, from the link.
 *
 * The shared signing block, pointed at the share-token route. When the
 * signature completes the contract and issues a deposit, the answer names the
 * deposit's link and the customer goes straight to it — sign, then pay, in one
 * flow.
 */
export function ContractSignature({
  token,
  customerName,
  businessName,
  actionLabel,
  description,
}: {
  token: string;
  customerName: string | null;
  businessName: string | null;
  actionLabel: string;
  /** What's being signed, in a line — the panel's only explanation. */
  description?: string;
}) {
  return (
    <SignBlock
      endpoint={`/api/share/${token}/sign`}
      party="customer"
      heading="Sign your contract"
      description={description}
      defaultName={customerName}
      businessName={businessName}
      actionLabel={actionLabel}
      bare
      onSigned={(result) => {
        const next = (result as { next?: string | null } | null)?.next;
        if (next) window.location.assign(next);
      }}
    />
  );
}
