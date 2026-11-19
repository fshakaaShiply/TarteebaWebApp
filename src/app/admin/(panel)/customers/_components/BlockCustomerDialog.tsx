"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog, Notice, TextArea, useToast } from "@/components/admin";
import { blockCustomer, unblockCustomer } from "@/lib/admin/customers/endpoints";
import { isStale, useCustomerError } from "@/lib/admin/customers/errors";
import { FormProblem, REASON_MAX, checkReason, type FormError } from "@/lib/admin/customers/forms";
import type { CustomerDetail } from "@/lib/admin/customers/types";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";
import { Ltr } from "../../bookings/_components/BookingBits";
import { MovedNotice } from "./CustomerParts";
import { useCustomerRefresh } from "./useCustomerRefresh";

/** A booking or subscription of the customer that is still open: staff decide each one, a block does not touch it. */
export type OpenItem = { type: "booking" | "subscription"; id: number; reference: string; href: string | null };

/**
 * Blocks or unblocks the customer (customers.block + customers.view). A reason of 3 to 500 characters is required and
 * kept; the version is the If-Match. The dialog says what a block does and does not do (P5-C10): the customer cannot sign
 * in or book, signed-in sessions end, auto-renew of her subscriptions switches off (the paid term continues), and her open
 * bookings and subscriptions stay for staff to decide: they are listed with links. Unblocking restores access only: she
 * signs in again and auto-renew stays off (P5-C11). Nobody is notified (P5-C14).
 */
export function BlockCustomerDialog({
  customer,
  mode,
  openItems,
  onClose,
}: {
  customer: CustomerDetail;
  mode: "block" | "unblock";
  openItems: readonly OpenItem[];
  onClose: () => void;
}) {
  const t = useTranslations("admin.customers.block");
  const describe = useCustomerError();
  const toast = useToast();
  const refresh = useCustomerRefresh(customer.id);
  const seen = useSeenRecord(customer);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);

  const run = useMutation({
    mutationFn: () => {
      const problem = checkReason(reason);
      if (problem) throw new FormProblem("reason", problem);
      return (mode === "block" ? blockCustomer : unblockCustomer)(customer.id, reason, seen.record.version);
    },
    onSuccess: (answer) => {
      refresh(answer);
      toast.success(t(mode === "block" ? "blocked" : "unblocked"));
      onClose();
    },
    onError: (e) => {
      if (e instanceof FormProblem) return setError(e.error);
      if (isStale(e)) {
        seen.moved();
        refresh();
      }
    },
  });
  const shown = run.isError && !(run.error instanceof FormProblem) && !isStale(run.error) ? run.error : null;
  const alreadyBlocked = mode === "block" && customer.status === "blocked";

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !run.isPending && onClose()}
      title={t(`${mode}.title`)}
      description={t(`${mode}.description`)}
      confirmLabel={t(`${mode}.confirm`)}
      tone={mode === "block" ? "danger" : "primary"}
      pending={run.isPending}
      onConfirm={() => (setError(null), seen.seen(), run.mutate())}
    >
      <div className="flex flex-col gap-4">
        <ul className="list-disc ps-5 text-sm/6 text-ink-900">
          {(mode === "block" ? (["signIn", "sessions", "renewals", "bookings", "silent"] as const) : (["access", "renewalsStayOff"] as const)).map((k) => (
            <li key={k}>{t(`effects.${k}`)}</li>
          ))}
        </ul>
        {mode === "block" && openItems.length > 0 && (
          <Notice tone="info" title={t("openTitle")}>
            <span className="flex flex-col gap-1">
              <span>{t("openBody")}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {openItems.map((item) =>
                  item.href ? (
                    <Link key={`${item.type}-${item.id}`} href={item.href} className="font-medium underline">
                      <Ltr>{item.reference}</Ltr>
                    </Link>
                  ) : (
                    <Ltr key={`${item.type}-${item.id}`}>{item.reference}</Ltr>
                  ),
                )}
              </span>
            </span>
          </Notice>
        )}
        {alreadyBlocked && <Notice tone="neutral">{t("changeReason")}</Notice>}
        <TextArea
          label={t("reason")}
          hint={t("reasonHint")}
          required
          rows={3}
          maxLength={REASON_MAX + 200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={error ? t(`errors.${error}`, { min: 3, max: REASON_MAX }) : undefined}
        />
        <MovedNotice waiting={seen.waiting} renewed={seen.renewed} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </ConfirmDialog>
  );
}
