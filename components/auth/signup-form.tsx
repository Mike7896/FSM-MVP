"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
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
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signUpSchema, type SignUpInput } from "@/lib/schemas";

/**
 * Sign-up is the same two paths as sign-in, deliberately: Google does not
 * distinguish between them, so a contractor who "signs up" with an account that
 * already exists simply lands in it rather than hitting an error.
 *
 * Both paths carry `next` — `/welcome`, with the trade on it when a trade door
 * sent one — so a new account lands in Journey 0 rather than on a dashboard
 * with nothing behind it.
 */
export function SignupForm({ next = "/welcome" }: { next?: string }) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setNotice(null);
    startTransition(async () => {
      const response = await fetch("/api/v1/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, next }),
      }).catch(() => null);

      const body = (await response?.json().catch(() => null)) as {
        data?: { session: unknown };
        error?: { message?: string };
      } | null;

      if (!response?.ok) {
        form.setError("root", {
          message:
            body?.error?.message ??
            "Couldn't reach the server. Check your connection and try again.",
        });
        return;
      }

      if (!body?.data?.session) {
        // Email confirmation is on, so there is no session yet and nothing to
        // navigate to — say what happens next instead.
        setNotice(
          "Check your email for a confirmation link to finish signing up."
        );
        return;
      }

      // Journey 0: a new account lands on its first quote, never on an empty
      // dashboard. A full load, so the signed-out render doesn't linger.
      window.location.assign(next);
      await new Promise(() => {});
    });
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Card className="w-full max-w-sm [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Create professional quotes and keep your job details together. No credit card required.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <GoogleButton label="Sign up with Google" next={next} />

        <FieldSeparator>or</FieldSeparator>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor="fullName">Full name</FieldLabel>
            <Input
              id="fullName"
              autoComplete="name"
              aria-invalid={!!form.formState.errors.fullName}
              {...form.register("fullName")}
            />
            <FieldError errors={[form.formState.errors.fullName]} />
          </Field>

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
            <FieldLabel htmlFor="password">Password</FieldLabel>
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

          {rootError ? (
            <Alert variant="destructive">
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          ) : null}

          {notice ? (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2Icon className="animate-spin" />
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter>
        <p className="text-muted-foreground w-full text-center text-sm">
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
