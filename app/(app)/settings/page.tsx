import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { NotificationTable } from "@/components/settings/notification-table";
import { ThemePicker } from "@/components/settings/theme-picker";
import { requireSession } from "@/lib/dal";
import { emailConfigured } from "@/lib/email/send";
import { getSettings, listPreferences } from "@/lib/notifications";
import { smsConfigured } from "@/lib/sms/send";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings — the app, for this person. Wireframe 94 · 56b.
 *
 * **One screen, and its shortness is the finding.** Six controls and nothing
 * else. Everything that used to make Settings feel like a wing turned out to
 * belong to the business, and once it moved to the Office what remained is
 * genuinely small — a short screen here is evidence the split is right, not a
 * screen that needs filling.
 *
 * Both sections name their counterpart in the Office, because the line between
 * them is the one thing a contractor could reasonably get wrong twice:
 * *Appearance* is your screen and *document branding* is your customer's;
 * *notifications* is what reaches you and *automations* is what goes out under
 * your business's name.
 */
export default async function SettingsPage() {
  const session = await requireSession();
  // Read here rather than fetched by the table, so every box is right on the
  // first paint instead of flipping once a request lands.
  const [preferences, settings] = await Promise.all([
    listPreferences(session.userId),
    getSettings(session.userId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Settings"
        description="How the tool behaves and looks for you. Nothing here reaches a customer."
      />

      <section id="appearance" className="flex flex-col gap-4 scroll-mt-20">
        <div>
          <h2 className="font-label text-[11px] uppercase">
            Appearance
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            How <strong className="text-foreground font-medium">your</strong>{" "}
            screens look. It saves as you pick — there&apos;s nothing to confirm.
          </p>
        </div>

        <ThemePicker />

        <p className="text-muted-foreground text-sm">
          How your <strong className="text-foreground font-medium">quotes</strong>{" "}
          look is{" "}
          <Link
            href="/office/branding"
            className="text-primary-ink underline underline-offset-4"
          >
            document branding
          </Link>
          , in the Office — that&apos;s your customer&apos;s screen, not yours.
        </p>
      </section>

      <section id="notifications" className="flex flex-col gap-4 scroll-mt-20">
        <div>
          <h2 className="font-label text-[11px] uppercase">
            Notifications
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            What reaches you, where, and when. Everything saves as you change
            it.
          </p>
        </div>

        <NotificationTable
          initial={preferences}
          settings={settings}
          emailAvailable={emailConfigured()}
          textsAvailable={smsConfigured()}
        />

        <p className="text-muted-foreground text-sm">
          This is what reaches{" "}
          <strong className="text-foreground font-medium">you</strong>. What goes
          out to{" "}
          <strong className="text-foreground font-medium">your customers</strong>
          , and when, is{" "}
          <Link
            href="/office/automations"
            className="text-primary-ink underline underline-offset-4"
          >
            automations
          </Link>{" "}
          — in the Office, because it goes out under your business&apos;s name.
        </p>
      </section>
    </div>
  );
}
