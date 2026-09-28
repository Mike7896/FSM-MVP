"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { SaveBar } from "@/components/save-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from "@/lib/schemas";

/**
 * Changing the password from Account.
 *
 * **The current password is asked for**, because Supabase would change it on
 * the strength of the session alone and this is the account a contractor's
 * money runs through. One field is a cheap price for an unlocked laptop not
 * being a taken account.
 *
 * The success message says the session survives. "Password changed" on its own
 * leaves a contractor wondering whether they are about to be thrown out of a
 * half-built quote, which is the fear this product spends the rest of its
 * surface area removing.
 */
export function PasswordForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await fetch("/api/v1/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }).catch(() => null);

      if (!response?.ok) {
        const body = (await response?.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        form.setError("root", {
          message:
            body?.error?.message ??
            "Couldn't reach the server, so your password hasn't changed. Try again.",
        });
        return;
      }

      toast.success("Password changed. You're still signed in here.");
      form.reset({ currentPassword: "", password: "", confirmPassword: "" });
      setDone(true);
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          {...form.register("currentPassword")}
        />
        <FieldNote error={form.formState.errors.currentPassword?.message}>
          Asked for so a borrowed screen can&apos;t change it.
        </FieldNote>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...form.register("password")}
          />
          <FieldNote error={form.formState.errors.password?.message}>
            At least 8 characters.
          </FieldNote>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="confirmPassword">New password again</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...form.register("confirmPassword")}
          />
          <FieldNote error={form.formState.errors.confirmPassword?.message}>
            A typo here locks you out of your own jobs.
          </FieldNote>
        </div>
      </div>

      <SaveBar
        dirty={form.formState.isDirty}
        pending={pending}
        error={form.formState.errors.root?.message}
        label="Change password"
        note={
          done && !form.formState.isDirty
            ? "Changed. You're still signed in here."
            : "You stay signed in on this device."
        }
      />
    </form>
  );
}

function FieldNote({
  error,
  children,
}: {
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        error ? "text-destructive text-xs" : "text-muted-foreground text-xs"
      }
    >
      {error ?? children}
    </p>
  );
}
