"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { disclosure } from "@/lib/signing/disclosure";
import { cn } from "@/lib/utils";

/**
 * The electronic-records consent — ESIGN §101(c).
 *
 * **Not a formality, and not buried.** A signature is only enforceable against
 * a consumer if she consented to electronic records *after* being told she can
 * have paper instead, how to withdraw, and what she needs to read and keep
 * them. So the checkbox is unticked by default, the disclosure is one tap away
 * on the same screen rather than behind a link to another page, and the label
 * beside the box says what she is agreeing to in a sentence.
 *
 * Defaulting this to checked would be the single easiest way to make every
 * signature in the product arguable, which is why it is stated here rather than
 * left to whoever next edits this file.
 */
export function ConsentNotice({
  checked,
  onCheckedChange,
  businessName,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  businessName?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const notice = disclosure(businessName);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-start gap-2.5">
        <Checkbox
          id="esign-consent"
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          disabled={disabled}
          className="mt-0.5"
        />
        <Label
          htmlFor="esign-consent"
          className="text-muted-foreground text-sm leading-relaxed font-normal"
        >
          {notice.consentLabel}
        </Label>
      </div>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground ml-7 flex items-center gap-1.5 text-xs">
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
          />
          {notice.title}
        </CollapsibleTrigger>

        <CollapsibleContent className="ml-7 mt-2 flex flex-col gap-3 border-l pl-3">
          {notice.sections.map((section) => (
            <div key={section.heading}>
              <p className="text-xs font-medium">{section.heading}</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {section.body}
              </p>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
