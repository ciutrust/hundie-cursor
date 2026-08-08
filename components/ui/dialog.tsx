"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      {/* The shell is capped at the viewport and never scrolls itself, so the X stays pinned while
          the inner pane scrolls. Without the cap a tall body (e.g. a long suggestion list on a
          phone) grew past the screen and the footer buttons were unreachable. */}
      <DialogPrimitive.Content
        className={cn(
          "fixed left-[50%] top-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden border border-border bg-card shadow-lg duration-200 sm:rounded-lg",
          className,
        )}
        {...props}
      >
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-6">
          {children}
        </div>
        <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-sm bg-card opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * Sticky action row. Stays parked at the bottom of the scroll pane so Save/Cancel are one thumb
 * away no matter how long the body gets. The negative margins cancel the scroll pane's `p-6`
 * above, and the bottom padding clears the iOS home indicator.
 */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // bottom-[-1.5rem] cancels the scroll pane's own p-6 bottom padding, which the sticky
        // constraint rect is inset by — without it the footer floats 24px up and body content
        // scrolls visibly underneath it.
        "sticky bottom-[-1.5rem] -mx-6 -mb-6 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
