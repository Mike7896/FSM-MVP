"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
} from "@/components/responsive-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { partsForForm } from "@/lib/customers/name";
import type { CustomerDetail } from "@/lib/queries/customers";
import { customerFormSchema, type CustomerFormValues } from "@/lib/schemas/customer";
import { cn } from "@/lib/utils";

const CONTACT_OPTIONS: { value: CustomerFormValues["preferredContact"]; label: string }[] = [
  { value: "", label: "No preference" },
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
];

/**
 * Adding a customer, or correcting one. The same form either way — it is the
 * same object.
 *
 * Only a name is needed. Everything else is what a contractor learns over the
 * first few calls, so it is all here to fill in later rather than all asked
 * for up front.
 */
export function CustomerFormDialog({
  customer,
  leadSources,
  onClose,
}: {
  /** Absent when adding someone new. */
  customer?: Pick<
    CustomerDetail,
    | "id"
    | "name"
    | "firstName"
    | "lastName"
    | "companyName"
    | "email"
    | "altEmail"
    | "phone"
    | "altPhone"
    | "preferredContact"
    | "address"
    | "billingAddress"
    | "accessNotes"
    | "leadSource"
    | "jobCount"
  >;
  /** Answers this shop has given before, offered back as suggestions. */
  leadSources: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const [removing, startRemoving] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [separateBilling, setSeparateBilling] = useState(
    Boolean(customer?.billingAddress)
  );
  const [firstNote, setFirstNote] = useState("");

  const parts = customer ? partsForForm(customer) : null;

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      firstName: parts?.firstName ?? "",
      lastName: parts?.lastName ?? "",
      companyName: parts?.companyName ?? "",
      email: customer?.email ?? "",
      altEmail: customer?.altEmail ?? "",
      phone: customer?.phone ?? "",
      altPhone: customer?.altPhone ?? "",
      preferredContact: customer?.preferredContact ?? "",
      address: customer?.address ?? "",
      billingAddress: customer?.billingAddress ?? "",
      accessNotes: customer?.accessNotes ?? "",
      leadSource: customer?.leadSource ?? "",
    },
  });

  const errors = form.formState.errors;
  const field = (name: string) => `${ids}-${name}`;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const body = {
        ...values,
        billingAddress: separateBilling ? values.billingAddress : "",
        ...(customer ? {} : { notes: firstNote }),
      };

      const response = await fetch(
        customer ? `/api/v1/customers/${customer.id}` : "/api/v1/customers",
        {
          method: customer ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      ).catch(() => null);

      const result = (await response?.json().catch(() => null)) as {
        data?: { id: string };
        error?: { message?: string; details?: { message: string }[] };
      } | null;

      if (!response?.ok) {
        form.setError("root", {
          message:
            result?.error?.details?.[0]?.message ??
            result?.error?.message ??
            "Couldn't save this customer.",
        });
        return;
      }

      if (customer) {
        toast.success("Customer updated.");
        onClose();
        router.refresh();
      } else {
        toast.success("Customer added.");
        router.push(`/customers/${result!.data!.id}`);
      }
    });
  });

  function remove() {
    if (!customer) return;
    startRemoving(async () => {
      const response = await fetch(`/api/v1/customers/${customer.id}`, {
        method: "DELETE",
      }).catch(() => null);

      if (!response?.ok) {
        const result = (await response?.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setConfirmingDelete(false);
        form.setError("root", {
          message: result?.error?.message ?? "Couldn't delete this customer.",
        });
        return;
      }

      toast.success("Customer deleted.");
      router.push("/customers");
    });
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent desktopClassName="sm:max-w-2xl">
        <ResponsiveDialogHeader
          title={customer ? `Edit ${customer.name}` : "Add a customer"}
          description={
            customer
              ? undefined
              : "Only a name is needed. Fill in the rest as you learn it."
          }
        />

        <form onSubmit={onSubmit} noValidate>
          <ResponsiveDialogBody className="flex flex-col gap-8">
            <Section title="Name">
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="First name" htmlFor={field("first")} error={errors.firstName?.message}>
                  <Input
                    id={field("first")}
                    autoComplete="off"
                    autoFocus={!customer}
                    {...form.register("firstName")}
                  />
                </Row>
                <Row label="Last name" htmlFor={field("last")} error={errors.lastName?.message}>
                  <Input id={field("last")} autoComplete="off" {...form.register("lastName")} />
                </Row>
              </div>
              <Row
                label="Company"
                htmlFor={field("company")}
                hint="For a business, a landlord or a property manager. With no first or last name, the company is the name you'll see."
                error={errors.companyName?.message}
              >
                <Input id={field("company")} autoComplete="off" {...form.register("companyName")} />
              </Row>
            </Section>

            <Section title="Contact">
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Phone" htmlFor={field("phone")} error={errors.phone?.message}>
                  <Input
                    id={field("phone")}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    {...form.register("phone")}
                  />
                </Row>
                <Row label="Other phone" htmlFor={field("alt-phone")} error={errors.altPhone?.message}>
                  <Input
                    id={field("alt-phone")}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    {...form.register("altPhone")}
                  />
                </Row>
                <Row label="Email" htmlFor={field("email")} error={errors.email?.message}>
                  <Input
                    id={field("email")}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    {...form.register("email")}
                  />
                </Row>
                <Row label="Other email" htmlFor={field("alt-email")} error={errors.altEmail?.message}>
                  <Input
                    id={field("alt-email")}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    {...form.register("altEmail")}
                  />
                </Row>
              </div>
              <p className="text-muted-foreground -mt-2 text-xs">
                Quotes and invoices are emailed to the first address.
              </p>

              <div className="grid gap-2">
                <Label id={field("preferred-label")}>Best way to reach them</Label>
                <Controller
                  control={form.control}
                  name="preferredContact"
                  render={({ field: control }) => (
                    <RadioGroup
                      aria-labelledby={field("preferred-label")}
                      value={control.value}
                      onValueChange={control.onChange}
                      className="flex flex-wrap gap-2"
                    >
                      {CONTACT_OPTIONS.map((option) => (
                        <Label
                          key={option.value || "none"}
                          htmlFor={field(`preferred-${option.value || "none"}`)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-normal transition-colors",
                            control.value === option.value
                              ? "border-primary/60 bg-primary/5"
                              : "hover:bg-muted/50"
                          )}
                        >
                          <RadioGroupItem
                            id={field(`preferred-${option.value || "none"}`)}
                            value={option.value}
                          />
                          {option.label}
                        </Label>
                      ))}
                    </RadioGroup>
                  )}
                />
              </div>
            </Section>

            <Section title="Address">
              <Row
                label="Service address"
                htmlFor={field("address")}
                hint="Where the work usually is. New quotes for them start here."
                error={errors.address?.message}
              >
                <Input id={field("address")} autoComplete="off" {...form.register("address")} />
              </Row>

              <div className="grid gap-3">
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={!separateBilling}
                    onCheckedChange={(checked) => setSeparateBilling(checked !== true)}
                  />
                  Bills go to the service address
                </Label>
                {separateBilling ? (
                  <Row label="Billing address" htmlFor={field("billing")} error={errors.billingAddress?.message}>
                    <Input id={field("billing")} autoComplete="off" {...form.register("billingAddress")} />
                  </Row>
                ) : null}
              </div>

              <Row
                label="Property access"
                htmlFor={field("access")}
                hint="Gate code, pets, parking, where the panel or shutoff is — whatever whoever shows up needs to know."
                error={errors.accessNotes?.message}
              >
                <Textarea id={field("access")} rows={2} {...form.register("accessNotes")} />
              </Row>
            </Section>

            <Section title="Background">
              <Row
                label="How they found you"
                htmlFor={field("source")}
                hint={
                  leadSources.length
                    ? "Pick one you've used before, or type a new one."
                    : "A referral, a search, a sign — however they came to you."
                }
                error={errors.leadSource?.message}
              >
                <Input
                  id={field("source")}
                  list={leadSources.length ? field("sources") : undefined}
                  autoComplete="off"
                  {...form.register("leadSource")}
                />
                {leadSources.length ? (
                  <datalist id={field("sources")}>
                    {leadSources.map((source) => (
                      <option key={source} value={source} />
                    ))}
                  </datalist>
                ) : null}
              </Row>

              {customer ? null : (
                <Row
                  label="Note"
                  htmlFor={field("note")}
                  hint="Starts their notes log. Only your team sees it."
                >
                  <Textarea
                    id={field("note")}
                    rows={3}
                    maxLength={2000}
                    value={firstNote}
                    onChange={(event) => setFirstNote(event.target.value)}
                  />
                </Row>
              )}
            </Section>

            {errors.root ? (
              <Alert variant="destructive">
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            ) : null}
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="flex items-center justify-between gap-3">
            {customer && customer.jobCount === 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
                disabled={removing}
              >
                Delete customer
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {customer ? "Save" : "Add customer"}
              </Button>
            </div>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>

      {customer ? (
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Their details and notes go with them. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removing}>Keep them</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={removing}
                onClick={(event) => {
                  event.preventDefault();
                  remove();
                }}
              >
                {removing ? <Loader2 className="animate-spin" /> : null}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </ResponsiveDialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-muted-foreground mb-3 font-label text-[11px] uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Row({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
