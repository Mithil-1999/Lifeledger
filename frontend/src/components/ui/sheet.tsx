import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Slide-in side panel built on Radix Dialog (focus trap, Esc to close, aria wiring). */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl outline-none",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="Close menu"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
