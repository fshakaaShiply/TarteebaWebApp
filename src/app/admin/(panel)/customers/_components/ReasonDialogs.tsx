"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog, Notice, TextArea, useToast } from "@/components/admin";
import { blockAddress, optOutMarketing, unblockAddress } from "@/lib/admin/customers/endpoints";
import { isStale, useCustomerError } from "@/lib/admin/customers/errors";
import { FormProblem, REASON_MAX, checkReason, type FormError } from "@/lib/admin/customers/forms";
import type { CustomerAddress, CustomerDetail } from "@/lib/admin/customers/types";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";
import { MovedNotice } from "./CustomerParts";
import { useCustomerRefresh } from "./useCustomerRefresh";

function ReasonField({ label, hint, value, onChange, error }: { label: string; hint?: string; value: string; onChange: (v: string) => void; error?: string }) {
  return <TextArea label={label} hint={hint} required rows={3} maxLength={REASON_MAX + 200} value={value} onChange={(e) => onChange(e.target.value)} error={error} />;
}

/**
 * Records that the customer asked for no more marketing (customers.privacy_requests + customers.view): the reason is the
 * customer's words on the call or message, kept in the consent log with the staff member's name (409 ALREADY_OPTED_OUT).
 */
export function MarketingOptOutDialog({ customer, onClose }: { customer: CustomerDetail; onClose: () => void }) {
  const t = useTranslations("admin.customers.optOut");
  const describe = useCustomerError();
  const toast = useToast();
  const refresh = useCustomerRefresh(customer.id);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);

  const run = useMutation({
    mutationFn: () => {
      const problem = checkReason(reason);
      if (problem) throw new FormProblem("reason", problem);
      return optOutMarketing(customer.id, reason);
    },
    onSuccess: (answer) => {
      refresh(answer);
      toast.success(t("done"));
      onClose();
    },
    onError: (e) => {
      if (e instanceof FormProblem) return setError(e.error);
      // ALREADY_OPTED_OUT: another member of staff recorded it first; the profile says so after it is read again.
      if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ALREADY_OPTED_OUT") refresh();
    },
  });
  const shown = run.isError && !(run.error instanceof FormProblem) ? run.error : null;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !run.isPending && onClose()}
      title={t("title")}
      description={t("description")}
      confirmLabel={t("confirm")}
      pending={run.isPending}
      onConfirm={() => (setError(null), run.mutate())}
    >
      <div className="flex flex-col gap-4">
        <ReasonField label={t("reason")} hint={t("reasonHint")} value={reason} onChange={setReason} error={error ? t(`errors.${error}`, { min: 3, max: REASON_MAX }) : undefined} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </ConfirmDialog>
  );
}

/**
 * Blocks or unblocks one of the customer's addresses (customers.block + customers.view). A blocked address is refused for
 * new bookings and renewals; auto-renew of the subscriptions at that address switches off (P5-C13). The address's version
 * is the If-Match; the API refuses once the account's erasure has started.
 */
export function BlockAddressDialog({
  customerUlid,
  address,
  mode,
  onClose,
}: {
  customerUlid: string;
  address: CustomerAddress;
  mode: "block" | "unblock";
  onClose: () => void;
}) {
  const t = useTranslations("admin.customers.addressBlock");
  const describe = useCustomerError();
  const toast = useToast();
  const refresh = useCustomerRefresh(customerUlid);
  const seen = useSeenRecord(address);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);

  const run = useMutation({
    mutationFn: () => {
      const problem = checkReason(reason);
      if (problem) throw new FormProblem("reason", problem);
      return (mode === "block" ? blockAddress : unblockAddress)(address.id, reason, seen.record.version);
    },
    onSuccess: () => {
      // The answer is the address alone; the profile holds the list, so it is read again.
      refresh();
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

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !run.isPending && onClose()}
      title={t(`${mode}.title`, { label: address.label })}
      description={t(`${mode}.description`)}
      confirmLabel={t(`${mode}.confirm`)}
      tone={mode === "block" ? "danger" : "primary"}
      pending={run.isPending}
      onConfirm={() => (setError(null), seen.seen(), run.mutate())}
    >
      <div className="flex flex-col gap-4">
        <ReasonField label={t("reason")} value={reason} onChange={setReason} error={error ? t(`errors.${error}`, { min: 3, max: REASON_MAX }) : undefined} />
        <MovedNotice waiting={seen.waiting} renewed={seen.renewed} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </ConfirmDialog>
  );
}
