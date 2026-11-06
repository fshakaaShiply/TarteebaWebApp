"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { useCallback, type ReactNode } from "react";
import { Notice, useToast, type FocusTarget } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { useServerFieldMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { isStale } from "@/lib/admin/subscriptions/actions";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { SubscriptionDetail } from "@/lib/admin/subscriptions/types";

/*
 * What the A08 dialogs share (design §9.1): they work on the subscription as it was when they opened (a snapshot: its
 * version is the If-Match, a change made meanwhile answers 409 STALE_VERSION and the dialog says so); every money or
 * capacity write carries an Idempotency-Key (one per intent, kept for a retry after a lost answer, new after any answer
 * the API stored); buttons stay disabled while a request is on its way; dry runs (previews) are asked once per body.
 */

export type SubscriptionDialogProps = {
  /** The subscription as it was when the dialog opened. */
  subscription: SubscriptionDetail;
  onClose: () => void;
  /** 409 STALE_VERSION: the dialog closed; the page reloads the subscription. */
  onStale: () => void;
  /** A newer version was loaded while the dialog was open. */
  changed?: boolean;
  returnFocusTo?: FocusTarget;
};

/** Dry runs are not retried and not refreshed on focus; their keys sit outside ["admin", "subscriptions"]. */
export const DRY_RUN = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } as const;

/**
 * After an action: show the subscription the API answered with at once, then refresh the list, the detail's tabs and
 * what the change moves elsewhere (the overview's cards and alerts, the bookings, the schedule board, capacity, trips,
 * and A09's payments, refunds, invoices and credit notes: a cancellation refunds, a renewal charges).
 */
export function useSubscriptionRefresh() {
  const queryClient = useQueryClient();
  return useCallback(
    (detail?: SubscriptionDetail | null) => {
      if (detail) queryClient.setQueryData(subscriptionKeys.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.schedule() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.capacity() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.rounds() });
    },
    [queryClient],
  );
}

type MutationOptions<I extends object, R> = {
  subscription: SubscriptionDetail;
  onClose: () => void;
  onStale: () => void;
  /** Names the intent: the Idempotency-Key is per (op, subscription, body). Omit for a write without a key. */
  op?: string;
  send: (input: I, key: string) => Promise<R>;
  /** The answer's subscription (shown at once) and the toast text. */
  done: (result: R, input: I) => { detail?: SubscriptionDetail | null; message: string; tone?: "success" | "info" | "error" };
  /** Anything beyond the shared handling (a TERMS_CHANGED's new terms, field errors). */
  onError?: (error: unknown, input: I) => void;
};

/** The write of a dialog: key per intent, refresh, toast, close; a STALE_VERSION closes it and reloads the page. */
export function useDialogMutation<I extends object, R>({ subscription, onClose, onStale, op, send, done, onError }: MutationOptions<I, R>) {
  const keys = useIdempotencyKeys();
  const refresh = useSubscriptionRefresh();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: I) => send(input, op ? keys.keyFor({ op, subscription: subscription.id, ...input }) : ""),
    onSuccess: (result, input) => {
      keys.settle();
      const out = done(result, input);
      refresh(out.detail);
      toast.show(out.message, out.tone ?? "success");
      onClose();
    },
    onError: (error, input) => {
      keys.settle(error);
      if (isStale(error)) {
        refresh();
        onClose();
        onStale();
        return;
      }
      refresh();
      onError?.(error, input);
    },
  });
}

/** The subscription was updated while the dialog was open: what is sent is still checked against the version it opened with. */
export function ChangedNotice({ changed }: { changed?: boolean }) {
  const t = useTranslations("admin.subscriptions.dialogs");
  if (!changed) return null;
  return (
    <Notice tone="warning" title={t("changedTitle")}>
      {t("changedBody")}
    </Notice>
  );
}

/** An error notice (STALE_VERSION has its own close-and-reload; a validation error shows on its field). */
export function ErrorNotice({ error, hideCodes = [] }: { error: unknown; hideCodes?: readonly string[] }) {
  const describe = useSubscriptionErrorMessage();
  if (!error) return null;
  const code = (error as { code?: string }).code;
  if (code && (code === "STALE_VERSION" || hideCodes.includes(code))) return null;
  return <Notice tone="danger">{describe(error)}</Notice>;
}

/** One figure of a preview; a figure a TERMS_CHANGED moved is marked (and named for screen readers). */
export function TermsRow({ label, value, changed }: { label: ReactNode; value: ReactNode; changed?: boolean }) {
  const t = useTranslations("admin.subscriptions.dialogs");
  return (
    <>
      <dt className="text-ink-600">{label}</dt>
      <dd className={clsx("font-latin text-ink-900", changed && "w-fit rounded-sm bg-apricot-100 px-1 font-bold")} data-changed={changed ? "true" : undefined}>
        {value}
        {changed && <span className="sr-only"> {t("changedMark")}</span>}
      </dd>
    </>
  );
}

/** 409 TERMS_CHANGED: nothing was done; the new terms are on screen and need a fresh confirm. */
export function TermsChangedNotice({ body }: { body: string }) {
  const t = useTranslations("admin.subscriptions.dialogs");
  return (
    <Notice tone="warning" title={t("termsChangedTitle")} role="alert">
      {body}
    </Notice>
  );
}

/** A reference, phone number or date in Latin digits, isolated so it keeps its order in Arabic text. */
export function Ltr({ children, className }: { children: string | number; className?: string }) {
  return (
    <bdi dir="ltr" className={clsx("font-latin", className)}>
      {children}
    </bdi>
  );
}

/**
 * `(error, field, fallback) => message`: the API's 422 message for a request field in the UI language, else our own
 * fallback copy (the API answers in English with raw attribute names for strings it has no Arabic for).
 */
export function useFieldError() {
  const serverMessage = useServerFieldMessage();
  return useCallback(
    (error: unknown, field: string, fallback: string): string | undefined => {
      if (!(error instanceof AdminApiError) || error.code !== "VALIDATION_FAILED") return undefined;
      const message = error.fieldErrors[field]?.[0];
      return message ? serverMessage(message, fallback) : undefined;
    },
    [serverMessage],
  );
}

/** True for a 422 that put a message on one of these fields (the dialog shows it there, not in a notice). */
export function hasFieldErrors(error: unknown, fields: readonly string[]): boolean {
  return error instanceof AdminApiError && error.code === "VALIDATION_FAILED" && fields.some((f) => (error.fieldErrors[f] ?? []).length > 0);
}

/** The grey summary box of a preview. */
export function PreviewBox({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} aria-live="polite" className={clsx("flex flex-col gap-2 rounded-md bg-neutral-100 p-4 text-sm", className)}>
      <p className="font-bold text-ink-900">{title}</p>
      {children}
    </section>
  );
}
