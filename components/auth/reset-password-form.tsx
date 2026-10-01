"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/schemas";

/**
 * Setting a new password from a reset link.
 *
 * No current-password field — the link was the proof. The account's address
 * is shown so a contractor with two inboxes knows which account this is, and
 * sits in a hidden `username` field so a password manager files the new
 * password under the right login.
 *
 * Saving signs every other device out, which is the point of a reset. This one
 * stays in and goes straight back to work.
 */
export function ResetPasswordForm({
  email,
  title = "Set a new password",
  submitLabel = "Save new password",
  successMessage = "New password saved. Any other devices were signed out; this one stays in.",
  skipHref,
}: {
  email: string;
  title?: string;
  submitLabel?: string;
  successMessage?: string;
  /** Offered when choosing a password can wait — an invite, not a reset. */
  skipHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
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
            "Couldn't reach the server, so nothing changed. Try again.",
        });
        return;
      }

      toast.success(successMessage);
      router.replace("/dashboard");
    });
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          For <span className="text-foreground font-medium">{email}</span>
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />

          <Field>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
            {form.formState.errors.password ? (
              <FieldError errors={[form.formState.errors.password]} />
            ) : (
              <FieldDescription>At least 8 characters.</FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="confirmPassword">
              New password again
            </FieldLabel>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.confirmPassword}
              {...form.register("confirmPassword")}
            />
            <FieldError errors={[form.formState.errors.confirmPassword]} />
          </Field>

          {rootError ? (
            <Alert variant="destructive">
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2Icon className="animate-spin" />
                Saving...
              </>
            ) : (
              submitLabel
            )}
          </Button>
          {skipHref ? (
            <Button asChild type="button" variant="ghost" className="w-full">
              <Link href={skipHref}>Skip — I&apos;ll sign in with Google</Link>
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
