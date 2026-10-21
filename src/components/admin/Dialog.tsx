"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FormEvent, ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";

/*
 * Modal dialog and side drawer on Radix Dialog: focus is trapped inside, Escape and the close button dismiss it, focus
 * returns to the trigger, and the title/description are wired as the accessible name/description.
 */

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons row at the bottom. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Prevents closing by Escape or outside click (e.g. while saving). */
  dismissible?: boolean;
};

const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" };

function CloseButton() {
  const t = useTranslations("admin.ui");
  return (
    <RadixDialog.Close
      aria-label={t("close")}
      className="touch-target inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-600 hover:bg-neutral-100 hover:text-ink-900"
    >
      <X aria-hidden className="size-5" strokeWidth={1.75} />
    </RadixDialog.Close>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: DialogProps) {
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (dismissible || next ? onOpenChange(next) : undefined)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink-900/40" />
        <RadixDialog.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          className={clsx(
            "fixed inset-0 z-50 m-auto flex h-fit max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-lg bg-surface shadow-card",
            widths[size],
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="flex flex-col gap-1">
              <RadixDialog.Title className="text-lg/7 font-bold text-ink-900">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="text-sm text-ink-600">{description}</RadixDialog.Description>
              )}
            </div>
            {dismissible && <CloseButton />}
          </div>
          {children && <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  tone?: "primary" | "danger";
  pending?: boolean;
  /** "lg" makes room for a preview inside the confirmation. */
  size?: "md" | "lg";
  /** Called on confirm (the form submits, so Enter in a reason field confirms too). */
  onConfirm: () => void;
  /** Extra fields (e.g. a required reason) and error notices. */
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  pending = false,
  size = "md",
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const t = useTranslations("admin.ui");
  const variant: ButtonVariant = tone === "danger" ? "danger" : "primary";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) onConfirm();
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (!pending || next ? onOpenChange(next) : undefined)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink-900/40" />
        <RadixDialog.Content
          role="alertdialog"
          className={clsx(
            "fixed inset-0 z-50 m-auto flex h-fit max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-y-auto rounded-lg bg-surface shadow-card",
            size === "lg" ? "max-w-2xl" : "max-w-md",
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <form onSubmit={submit} className="flex flex-col gap-4 p-5" noValidate>
            <div className="flex flex-col gap-1.5">
              <RadixDialog.Title className="text-lg/7 font-bold text-ink-900">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="text-sm/6 text-ink-600">{description}</RadixDialog.Description>
              )}
            </div>
            {children}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <RadixDialog.Close asChild>
                <Button variant="outline" disabled={pending}>
                  {cancelLabel ?? t("cancel")}
                </Button>
              </RadixDialog.Close>
              <Button type="submit" variant={variant} loading={pending}>
                {confirmLabel}
              </Button>
            </div>
          </form>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** "end" for detail panels; "start" for the small-screen navigation. */
  side?: "start" | "end";
  /** Width of an end-side panel: "md" for record details, "lg" for editors with previews (A11 zones, policies). */
  size?: "md" | "lg";
  className?: string;
};

/** Side panel for record details (A03 booking drawer pattern) and the small-screen navigation. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "end",
  size = "md",
  className,
}: DrawerProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink-900/40" />
        <RadixDialog.Content
          className={clsx(
            "fixed inset-y-0 z-50 flex w-full flex-col bg-surface shadow-sheet",
            side === "start" ? "start-0 max-w-[300px]" : size === "lg" ? "end-0 max-w-[760px]" : "end-0 max-w-[520px]",
            className,
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="flex min-w-0 flex-col gap-1">
              <RadixDialog.Title className="truncate text-lg/7 font-bold text-ink-900">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="text-sm text-ink-600">{description}</RadixDialog.Description>
              )}
            </div>
            <CloseButton />
          </div>
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
