"use client";

import { SignBlock } from "@/components/signing/sign-block";

/**
 * The customer accepts the quote by signing it, from the link.
 *
 * The same signing block she would otherwise meet on the contract, pointed at
 * the quote's own link — so there is still only one way to sign in the
 * product. Signing accepts the quote and completes its contract in one go, and
 * the answer names where to go next: the deposit, or the signed contract.
 */
export function QuoteSignature({
  token,
  hash,
  customerName,
  businessName,
  actionLabel,
}: {
  token: string;
  hash: string;
  customerName: string | null;
  businessName: string | null;
  actionLabel: string;
}) {
  return (
    <SignBlock
      endpoint={`/api/share/${token}/sign`}
      party="customer"
      reviewHash={hash}
      heading="Sign to accept"
      description="Draw your signature or type your name — both count. It goes on the line above."
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
