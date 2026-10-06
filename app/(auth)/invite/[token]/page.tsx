import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { readInvite } from "@/lib/admin/invites";

export const metadata: Metadata = {
  title: "You're invited",
  robots: { index: false, follow: false },
  // The link is a way into an account; it shouldn't ride along to anywhere else.
  referrer: "no-referrer",
};

/**
 * Where an invite email lands.
 *
 * **Opening the link doesn't spend it — pressing the button does.** Mail
 * scanners open every link in an email before the person does; if a GET signed
 * in, the invite would be used up by a robot. The button is a POST, which they
 * don't make.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await readInvite(token);

  if (invite.state !== "ready") {
    const copy = {
      used: {
        title: "You've already accepted this invite",
        body: "Your account is set up. Sign in with your email and password — or with Google, if that's your address.",
      },
      expired: {
        title: "This invite has run out",
        body: "Invite links work for two weeks. Reply to the email it came in and ask for a new one.",
      },
      invalid: {
        title: "This invite link doesn't work",
        body: "A newer invite may have been sent — check for a more recent email. Otherwise, reply to the one you have and ask for a new link.",
      },
    }[invite.state];
    return (
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.body}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
          {invite.state === "used" ? (
            <Button asChild variant="ghost" className="w-full">
              <Link href="/forgot-password">I don&apos;t have a password</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{invite.firstName ? `Welcome, ${invite.firstName}` : "Welcome to ServiceClerk"}</CardTitle>
        <CardDescription>
          {invite.inviter} set up an account for <span className="text-foreground font-medium">{invite.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {invite.perks.length ? (
          <ul className="bg-muted/60 flex flex-col gap-1.5 rounded-lg p-3 text-sm">
            {invite.perks.map((perk) => (
              <li key={perk}>✓ {perk}</li>
            ))}
          </ul>
        ) : null}
        <form method="post" action={`/invite/${token}/accept`}>
          <Button type="submit" className="w-full">
            Accept invitation
          </Button>
        </form>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Next you&apos;ll choose a password, then set up your business.
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Later, you can sign in with Google using the same email address shown above.
          Use that address to keep your jobs and invite benefits on this account.
        </p>
      </CardContent>
    </Card>
  );
}
