"use client";

import { useState, type ComponentProps } from "react";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { CustomerFormDialog } from "./customer-form";

type FormProps = ComponentProps<typeof CustomerFormDialog>;

/** The directory's "Add a customer" — the form, empty. */
export function AddCustomerButton({
  leadSources,
  variant = "default",
}: {
  leadSources: string[];
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus />
        Add a customer
      </Button>
      {open ? (
        <CustomerFormDialog
          leadSources={leadSources}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** A customer page's "Edit" — the form, filled in. */
export function EditCustomerButton({
  customer,
  leadSources,
}: {
  customer: NonNullable<FormProps["customer"]>;
  leadSources: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil />
        Edit
      </Button>
      {open ? (
        <CustomerFormDialog
          customer={customer}
          leadSources={leadSources}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
