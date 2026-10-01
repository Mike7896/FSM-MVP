/**
 * Where the product is in public.
 *
 * **One list, every surface.** The footer, the landing page and anything later
 * — an email signature, a share page, a printed quote — read this, so an
 * account that changes changes once. A handle pasted into three files is a
 * handle that is wrong in two of them a year from now.
 *
 * **Only accounts that exist.** A row here is a link somebody will click, so
 * nothing goes in until it points at a real profile with something on it. The
 * pull to list six platforms with four of them dead is the same pull as a
 * pricing page advertising packs that aren't built.
 */
export type SocialAccount = {
  /** What it is called out loud, and what the link says. */
  name: string;
  href: string;
  /** For the accessible name, where the link is an icon or a short label. */
  label: string;
};

export const SOCIAL_ACCOUNTS: SocialAccount[] = [
  {
    name: "Facebook",
    href: "https://www.facebook.com/profile.php?id=61594383074511",
    label: "ServiceClerk on Facebook",
  },
  {
    name: "Instagram",
    href: "https://www.instagram.com/getserviceclerk/",
    label: "ServiceClerk on Instagram",
  },
];
