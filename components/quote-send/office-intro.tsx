"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_STATES } from "@/lib/us-states";

/**
 * Screen 6 · the Office introduction + Header fill · job O2.
 *
 * **The gate sits behind the preview, not in front of it.** He meets the gap
 * in his own letterhead first, and this opens from tapping the gap or from
 * trying to send — never before he has seen the document it belongs on.
 *
 * **It names the room once and tours nothing.** What the Office is, what it
 * keeps, the two fields a quote cannot go out without, and one line saying the
 * rest is there when he wants it. A walkthrough of the whole Office here is the
 * settings wall arriving late.
 *
 * Business name and license number are the only hard gates. Contact comes from
 * the sign-in and the logo waits until after the send. What he types is written
 * to the Office behind him — and the first time, that creates it.
 */

export type IntroReason = "gap" | "send";

export type HeaderSlice = {
  businessName: string;
  license: string;
};

export function OfficeIntro({
  open,
  onOpenChange,
  reason,
  customerName,
  businessName,
  license,
  contact,
  phone,
  hasOrganization,
  demo = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: IntroReason;
  customerName: string;
  businessName: string | null;
  license: string | null;
  /** What the sign-in already knows, said back — never asked for. */
  contact: string | null;
  /** Carried onto a newly created Office, so its documents have a number on them. */
  phone: string | null;
  hasOrganization: boolean;
  /**
   * A demo goes to him, so the send wording names no customer. The fields and
   * what they save are the same — his name and license are real either way.
   */
  demo?: boolean;
  onSaved: (slice: HeaderSlice) => void | Promise<void>;
}) {
  const firstName = customerName.trim().split(/\s+/)[0] || "your customer";

  const [name, setName] = useState(businessName ?? "");
  const [number, setNumber] = useState(license ?? "");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A license already on file doesn't need its state asked for again.
  const newLicense = number.trim() !== "" && number.trim() !== (license ?? "");
  const ready =
    name.trim() !== "" && number.trim() !== "" && (!newLicense || state !== "");

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        if (!hasOrganization || name.trim() !== (businessName ?? "")) {
          await saveBusinessName(name.trim(), hasOrganization, phone);
        }
        if (newLicense) {
          const jurisdiction =
            US_STATES.find((entry) => entry.code === state)?.name ?? state;
          await saveLicense(number.trim(), jurisdiction);
        }
        await onSaved({ businessName: name.trim(), license: number.trim() });
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Couldn't save that. Try again."
        );
      }
    });
  }

  const sending = reason === "send";

  const title = !sending
    ? "This is your Office."
    : demo
      ? "Before this goes out."
      : `Before this goes to ${firstName}.`;

  const description = !sending
    ? "It holds the business side — your name, your license, how your documents look. Fill these two in once and every quote after this one comes out with them on it."
    : demo
      ? "A customer checks who it's from and that you're licensed. Two fields, then it goes to you — and they're yours from here on."
      : `${capitalize(firstName)} needs to know who it's from and that you're licensed. Two fields, then it sends — and they're yours from here on.`;

  const action = !sending
    ? "Save & continue"
    : demo
      ? "Save & send it to me"
      : `Save & send to ${firstName}`;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-md">
        <ResponsiveDialogHeader
          title={
            <span className="flex flex-col gap-1">
              <span className="text-muted-foreground font-label text-[10px] uppercase">
                The Office
              </span>{" "}
              <span>{title}</span>
            </span>
          }
          description={description}
        />

        <ResponsiveDialogBody className="flex flex-col gap-4">
          <form
            id="office-intro"
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !pending) save();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="intro-name">Business name</Label>
              <Input
                id="intro-name"
                autoFocus
                autoComplete="organization"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <div className="grid gap-2">
                <Label htmlFor="intro-license">License #</Label>
                <Input
                  id="intro-license"
                  autoComplete="off"
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="intro-state">State</Label>
                <Select value={state} onValueChange={setState} disabled={!newLicense}>
                  <SelectTrigger id="intro-state" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((entry) => (
                      <SelectItem key={entry.code} value={entry.code}>
                        {entry.code} · {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </form>

          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            {contact ? <p>Contact · {contact}, from your sign-in</p> : null}
            <p>Logo · optional — you can add one after it sends</p>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <p className="text-muted-foreground border-t pt-3 text-xs">
            Branding, defaults, licenses and automations live in the Office
            too. They&apos;re there when you want them.
          </p>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            {sending ? "Back to the quote" : "Not now"}
          </Button>
          <Button
            type="submit"
            form="office-intro"
            className="flex-1"
            disabled={!ready || pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            {action}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * Creates the Office the first time, and renames it after that.
 *
 * A 409 on create means one already exists — a double tap, or another tab got
 * there first — and the answer to that is to name the one that exists.
 */
async function saveBusinessName(
  name: string,
  hasOrganization: boolean,
  phone: string | null
) {
  if (!hasOrganization) {
    const response = await fetch("/api/v1/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...(phone ? { phone } : {}) }),
    }).catch(() => null);

    if (response?.ok) return;
    if (response?.status !== 409) {
      throw new Error(
        await messageFrom(response, "Couldn't set up your Office. Try again.")
      );
    }
  }

  // The identity patch is whole by design, so the fields this sheet doesn't
  // show are read first and sent back as they are.
  const current = await fetch("/api/v1/office").catch(() => null);
  const office = ((await current?.json().catch(() => null)) as {
    data?: {
      phone: string | null;
      email: string | null;
      address: string | null;
      website: string | null;
      logoUrl: string | null;
    };
  } | null)?.data;

  if (!current?.ok || !office) {
    throw new Error("Couldn't reach your Office. Try again.");
  }

  const response = await fetch("/api/v1/office", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      phone: office.phone ?? "",
      email: office.email ?? "",
      address: office.address ?? "",
      website: office.website ?? "",
      logoUrl: office.logoUrl ?? "",
    }),
  }).catch(() => null);

  if (!response?.ok) {
    throw new Error(
      await messageFrom(response, "Couldn't save your business name. Try again.")
    );
  }
}

async function saveLicense(number: string, jurisdiction: string) {
  const response = await fetch("/api/v1/licenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jurisdiction, number, class: null, holder: null }),
  }).catch(() => null);

  // Already on file is as good as saved.
  if (response?.ok || response?.status === 409) return;
  throw new Error(
    await messageFrom(response, "Couldn't save your license number. Try again.")
  );
}

async function messageFrom(response: Response | null, fallback: string) {
  const body = (await response?.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? fallback;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
