"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";

import { GoogleButton } from "@/components/auth/google-button";
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
import {
  Field,
  FieldError,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { safeNextPath } from "@/lib/safe-next";
import { signInSchema, type SignInInput } from "@/lib/schemas";

/**
 * Job O1 — *one tap with the account he already uses*.
 *
 * OAuth leads and email is the fallback, which is the order the activation
 * journey calls for: the contractor signed up skeptical, between jobs, and
 * every field between him and a first quote is a chance to abandon.
 *
 * **React Hook Form validates against the same schema the sign-in route
 * re-checks.** The client parse is a courtesy to the contractor — inline
 * errors, no round trip; the server parse is the one that counts.
 *
 * The Google form is a sibling of this one rather than nested inside it —
 * nested forms are invalid HTML and the inner one silently never submits.
 */
export function LoginForm({ next }: { next?: string }) {
  const [pending, startTransition] = useTransition();

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await fetch("/api/v1/auth/sign-in", {
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

      // A full load rather than a client navigation, so nothing rendered for
      // the signed-out visitor survives into the session.
      window.location.assign(safeNextPath(next));
      // Stay pending until the next page replaces this one.
      await new Promise(() => {});
    });
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Pick up where you left off.</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <GoogleButton next={next} />

        <FieldSeparator>or</FieldSeparator>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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

          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-muted-foreground text-xs underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
            <FieldError errors={[form.formState.errors.password]} />
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
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter>
        <p className="text-muted-foreground w-full text-center text-sm">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
