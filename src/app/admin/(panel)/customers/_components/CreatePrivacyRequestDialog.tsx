"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Dialog, LoadingBlock, Notice, Select, TextArea, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createPrivacyRequest, fetchDeletionImpact, sendPrivacyOtp } from "@/lib/admin/customers/endpoints";
import { useCustomerError } from "@/lib/admin/customers/errors";
import { FormProblem, OTP_CODE_MAX, VERIFICATION_NOTE_MAX, buildPrivacyRequest, type PrivacyFormError } from "@/lib/admin/customers/forms";
import { customerKeys } from "@/lib/admin/customers/keys";
import { useCustomerText } from "@/lib/admin/customers/text";
import { PRIVACY_TYPES, STAFF_VERIFICATIONS, type CustomerDetail, type DeletionBlocker, type PrivacyType, type StaffVerification } from "@/lib/admin/customers/types";
import { DeletionBlockedList, DeletionImpactView } from "./DeletionItems";
import { useCustomerRefresh } from "./useCustomerRefresh";

/** The items of a refused deletion (409 DELETION_BLOCKED `details.items`), when the answer carries them. */
function blockedItems(error: unknown): DeletionBlocker[] {
  if (!(error instanceof AdminApiError) || error.code !== "DELETION_BLOCKED") return [];
  const items = error.details.items;
  return Array.isArray(items) ? (items as DeletionBlocker[]) : [];
}

/**
 * Files a data copy or an account deletion for a customer who asked by phone, in person or in writing
 * (customers.privacy_requests, P5-C24, P5-C50). The requester must prove she holds the account: a call to the registered
 * number is proved by the code she reads back (staff send it from here), a visit or a letter by the reference of the
 * document that proved who she is. A deletion first shows what is open: it is refused while the customer has open
 * bookings or subscriptions, which staff cancel first (links), and the account is signed out for the cooling-off. A data copy
 * reaches the customer through the link sent to her phone; staff never download it.
 */
export function CreatePrivacyRequestDialog({ customer, onClose }: { customer: CustomerDetail; onClose: () => void }) {
  const t = useTranslations("admin.privacy.create");
  const text = useCustomerText();
  const describe = useCustomerError();
  const toast = useToast();
  const refresh = useCustomerRefresh(customer.id);
  const [type, setType] = useState<PrivacyType>("export");
  const [verification, setVerification] = useState<StaffVerification>("registered_phone_call");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<{ field: "note" | "code"; error: PrivacyFormError } | null>(null);

  const impact = useQuery({
    queryKey: customerKeys.deletionImpact(customer.id),
    queryFn: () => fetchDeletionImpact(customer.id),
    enabled: type === "delete",
    staleTime: 0,
    gcTime: 0,
  });
  const refused = type === "delete" && impact.data !== undefined && !impact.data.can_request;

  // The code is for one request. The API signs a data copy and a deletion with the same purpose (P5-C121); only the SMS
  // says which one the code is for (A4b §12). So the dialog keeps the type each code was sent for, and changing the type or
  // the method drops the code: a code the customer read back after an SMS about a data copy never files a deletion. The
  // resend countdown keeps running, since the API's cooldown is per phone (a new code cannot come sooner).
  const [sent, setSent] = useState<{ to: string; type: PrivacyType } | null>(null);
  const [codeReset, setCodeReset] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const send = useMutation({
    mutationFn: (forType: PrivacyType) => sendPrivacyOtp(customer.id, forType),
    onSuccess: (answer, forType) => {
      setSent({ to: answer.phone_masked, type: forType });
      setCodeReset(false);
      setWait(Math.max(0, answer.resend_in));
    },
  });

  const submit = useMutation({
    mutationFn: () => {
      const built = buildPrivacyRequest({ type, verification, note, code, codeFor: sent?.type ?? null });
      if (!built.ok) throw new FormProblem(built.field, built.error);
      return createPrivacyRequest(customer.id, built.body);
    },
    onSuccess: () => {
      refresh();
      toast.success(t(type === "export" ? "doneExport" : "doneDelete"));
      onClose();
    },
    onError: (e) => {
      if (e instanceof FormProblem) setProblem({ field: e.field as "note" | "code", error: e.error as PrivacyFormError });
    },
  });
  const failed = submit.isError && !(submit.error instanceof FormProblem) ? submit.error : null;
  const busy = submit.isPending || send.isPending;

  /** What she asked for or how she proved it changed: the code in hand (and any answer about it) no longer counts. */
  const restart = () => {
    if (sent) setCodeReset(true);
    setSent(null);
    setCode("");
    setProblem(null);
    send.reset();
    submit.reset();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      dismissible={!busy}
      size="lg"
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant={type === "delete" ? "danger" : "primary"} onClick={() => (setProblem(null), submit.mutate())} loading={submit.isPending} disabled={refused || (type === "delete" && impact.isPending)}>
            {t(type === "delete" ? "submitDelete" : "submitExport")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t("type")}
            value={type}
            disabled={busy}
            onChange={(e) => (setType(e.target.value as PrivacyType), restart())}
            options={PRIVACY_TYPES.map((v) => ({ value: v, label: text.privacyType(v) }))}
          />
          <Select
            label={t("verification")}
            value={verification}
            disabled={busy}
            onChange={(e) => (setVerification(e.target.value as StaffVerification), restart())}
            options={STAFF_VERIFICATIONS.map((v) => ({ value: v, label: text.verification(v) }))}
          />
        </div>

        {verification === "registered_phone_call" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm/6 text-ink-600">{t("callHelp")}</p>
            {codeReset && (
              <Notice tone="info" role="status">
                {t("codeReset")}
              </Notice>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <Button variant="secondary" onClick={() => send.mutate(type)} loading={send.isPending} disabled={wait > 0}>
                {sent ? t("sendAgain") : t("sendCode")}
              </Button>
              {wait > 0 && <span className="text-xs text-ink-600">{t("resendIn", { seconds: wait })}</span>}
            </div>
            {sent && (
              <p role="status" className="text-sm text-ink-900">
                {t.rich("codeSent", {
                  phone: sent.to,
                  ltr: (chunks) => (
                    <bdi dir="ltr" className="font-latin">
                      {chunks}
                    </bdi>
                  ),
                })}
              </p>
            )}
            {send.isError && <Notice tone="danger">{describe(send.error)}</Notice>}
            <TextField
              label={t("code")}
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={OTP_CODE_MAX + 4}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={problem?.field === "code" ? t(`codeErrors.${problem.error}`) : undefined}
              containerClassName="max-w-xs"
            />
          </div>
        ) : (
          <TextArea
            label={t("note")}
            hint={t("noteHint")}
            required
            rows={3}
            maxLength={VERIFICATION_NOTE_MAX + 100}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={problem?.field === "note" ? t(`noteErrors.${problem.error}`, { min: 10, max: VERIFICATION_NOTE_MAX }) : undefined}
          />
        )}

        {type === "delete" && (
          <div className="flex flex-col gap-3">
            {impact.isPending && <LoadingBlock lines={3} />}
            {impact.isError && (
              <Notice tone="danger" action={<Button size="sm" variant="secondary" onClick={() => void impact.refetch()}>{t("retry")}</Button>}>
                {describe(impact.error)}
              </Notice>
            )}
            {impact.data && <DeletionImpactView impact={impact.data} />}
            {impact.data?.can_request && (
              <Notice tone="warning" title={t("deleteTitle")}>
                {t("deleteBody", { days: impact.data.grace_days })}
              </Notice>
            )}
          </div>
        )}
        {type === "export" && <Notice tone="info">{t("exportBody")}</Notice>}

        {failed && <Notice tone="danger">{describe(failed)}</Notice>}
        {failed && <DeletionBlockedList items={blockedItems(failed)} />}
      </div>
    </Dialog>
  );
}
