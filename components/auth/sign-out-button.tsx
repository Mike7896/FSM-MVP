"use client";

import { Loader2Icon, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSignOut } from "@/hooks/use-sign-out";

export function SignOutButton() {
  const { signOut, pending } = useSignOut();

  return (
    <Button type="button" variant="outline" onClick={signOut} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" /> : <LogOut />}
      Sign out
    </Button>
  );
}
