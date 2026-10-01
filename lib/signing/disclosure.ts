/**
 * ELECTRONIC RECORDS CONSENT — ESIGN §101(c).
 *
 * **The requirement most in-house signing implementations skip.** Under the
 * federal ESIGN Act, an electronic record is only enforceable against a
 * *consumer* if that consumer affirmatively consented to receive it
 * electronically, after being told certain specific things. A signature taken
 * without that consent is a signature the other side gets to argue about, which
 * is the whole thing we are trying to avoid.
 *
 * The statute names what the disclosure has to cover, and the text below is
 * organized around those points rather than around what reads nicely:
 *
 * 1. Any right to receive the record on paper, and how to request one.
 * 2. Whether consent applies to one transaction or to all of them.
 * 3. How to withdraw consent, what it costs, and what happens when they do.
 * 4. The hardware and software needed to access and keep the records.
 * 5. How to update their contact details.
 *
 * > **This is drafted, not reviewed.** It is a good-faith implementation of the
 * > statutory checklist, and it is not legal advice. Have a lawyer read it
 * > before the first real contract is signed on it — the cost of that review is
 * > trivial next to one unenforceable contract.
 */

export const DISCLOSURE_VERSION = "2026-09-1";

export type Disclosure = {
  version: string;
  title: string;
  /** The affirmative statement beside the checkbox. */
  consentLabel: string;
  sections: { heading: string; body: string }[];
};

export function disclosure(businessName?: string | null): Disclosure {
  const business = businessName?.trim() || "the contractor";

  return {
    version: DISCLOSURE_VERSION,
    title: "Signing this electronically",
    consentLabel:
      "I agree to sign electronically, and to receive this agreement and " +
      "related records in electronic form.",
    sections: [
      {
        heading: "You can ask for paper instead",
        body:
          `You are not required to sign electronically. You can ask ${business} ` +
          `for a paper copy of this document at any time, at no charge, and ` +
          `sign it by hand instead.`,
      },
      {
        heading: "What this consent covers",
        body:
          "Your consent applies to this document and to the records that go " +
          "with this job — change orders, invoices and receipts. It does not " +
          "commit you to signing anything else electronically.",
      },
      {
        heading: "You can change your mind",
        body:
          `You can withdraw your consent at any time by telling ${business}. ` +
          `There is no fee. Withdrawing does not undo anything already signed, ` +
          `and after that point you will receive records on paper.`,
      },
      {
        heading: "What you need to read and keep these",
        body:
          "A current web browser on a phone, tablet or computer, and an " +
          "internet connection. To keep a copy, use the download link on this " +
          "page or print it from your browser. If you can read this page, your " +
          "device can do both.",
      },
      {
        heading: "Keeping your details current",
        body:
          `Tell ${business} if your email address or phone number changes, so ` +
          `the records reach you.`,
      },
    ],
  };
}
