"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { passwordResetSchema, type PasswordResetInput } from "@/lib/schemas";

/** Why a reset link sent the contractor back here, in words they can act on. */
const LINK_FAILED = {
  expired:
    "That reset link expired or was already used. Send yourself a new one.",
  "other-browser":
    "That reset link was opened in a different browser from the one that asked for it, or it expired. Send a new one from this browser.",
} as const;

/**
 * Forgot password — and, for a contractor who has only ever used Google, how a
 * first password gets set.
 *
 * **The confirmation reads the same whether or not the address has an
 * account.** "No account with that email" would let anyone check who is a
 * customer, so the copy covers both cases instead.
 *
 * A failed link lands back here with its reason rather than on a generic error
 * page, because the next step is always the same: send another.
 */
export function ForgotPasswordForm({
  reason,
}: {
  reason?: keyof typeof LINK_FAILED;
}) {
  const [pending, startTransition] = useTransition();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<PasswordResetInput>({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await fetch("/api/v1/auth/password-reset", {
        method: "POST",
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
            "Couldn't reach the server. Check your connection and try again.",
        });
        return;
      }

      setSentTo(values.email);
    });
  });

  const rootError = form.formState.errors.root?.message;

  if (sentTo) {
    return (
      <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If <span className="text-foreground font-medium">{sentTo}</span>{" "}
            has an account, a link to set a new password is on its way. It can
            take a minute — check spam if it doesn&apos;t show up.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setSentTo(null)}
          >
            Use a different email
          </Button>
        </CardContent>

        <CardFooter>
          <p className="text-muted-foreground w-full text-center text-sm">
            <Link href="/login" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          We&apos;ll email you a link to set a new one.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {reason ? (
            <Alert variant="destructive">
              <AlertDescription>{LINK_FAILED[reason]}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!form.formState.errors.email}
              {...form.register("email")}
            />
            <FieldError errors={[form.formState.errors.email]} />
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
                Sending...
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter>
        <p className="text-muted-foreground w-full text-center text-sm">
          Remembered it?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
