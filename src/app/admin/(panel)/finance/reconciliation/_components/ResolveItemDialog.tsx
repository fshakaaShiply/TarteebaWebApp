"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button, Dialog, ErrorState, LoadingBlock, Notice, Select, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { fetchReconciliationItem, resolveItem } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import {
  NOTE_MAX,
  buildResolveBody,
  itemRef,
  termsChangedAmount,
  type ItemDetail,
  type ItemRow,
  type ResolveBody,
  type ResolveFormError,
  type ResolveValues,
} from "@/lib/admin/finance/reconciliation";
import { selectableReasons } from "@/lib/admin/finance/refund";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import { useAdminSession } from "@/lib/admin/session";
import { Code, Fact, Facts, Money } from "../../_components/FinanceParts";
import { useFinanceText } from "../../_components/financeText";
import { useRefundReasons } from "../../_components/useRefundReasons";
import { ItemStatusChip, useReconText } from "./ReconParts";

/*
 * Resolve one reconciliation item (reconciliation.run). The dialog loads the item's own facts first (GET /items/{id}):
 * the provider's line against our records, the payment's figures, and the resolutions the API allows for it right now
 * (`allowed_resolutions`). A resolution that only records a note is one step. The three that move money (refund_confirmed,
 * provider_refund_recorded, refund_reinstated) show the exact amount in a second step and are sent with the amount shown
 * (`expected_amount_fils`), an Idempotency-Key (one per body) and the item's version as If-Match; a 409 TERMS_CHANGED puts
 * the new amount on screen, marked, and asks for a fresh confirmation. Every error code of the route reads in our words.
 */

type Props = { item: Pick<ItemRow, "id" | "line_no">; onClose: () => void };

const EMPTY: ResolveValues = { code: "", note: "", paired_item_id: "", refund_reason_code: "" };

export function ResolveItemDialog({ item, onClose }: Props) {
  const t = useTranslations("admin.finance.reconciliation.resolve");
  const detail = useQuery({ queryKey: adminKeys.reconciliationItem(item.id), queryFn: () => fetchReconciliationItem(item.id) });
  // While a resolution is being sent the dialog can't be closed: its outcome would be lost to the person.
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      dismissible={!busy}
      closeOnOutsideClick={false}
      title={t("title", { line: item.line_no ?? "—" })}
      description={t("description")}
      size="lg"
    >
      {detail.isPending ? (
        <LoadingBlock lines={5} />
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <ResolveForm item={detail.data} onClose={onClose} onBusy={setBusy} />
      )}
    </Dialog>
  );
}

function ItemFacts({ item }: { item: ItemDetail }) {
  const t = useTranslations("admin.finance.reconciliation");
  const label = useReconText();
  const ref = itemRef(item);
  return (
    <div className="flex flex-col gap-3 rounded-md bg-ivory-50 p-4">
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold text-ink-900">{label.line(item.line_type, item.line_type_label)}</span>
        <ItemStatusChip item={item} />
        <span className="text-ink-600">{label.reason(item.reason_code, item.reason_label)}</span>
      </span>
      <Facts>
        {ref && (
          <Fact label={t("resolve.reference")}>
            <Code wrap className="text-xs">
              {ref}
            </Code>
          </Fact>
        )}
        <Fact label={t("columns.ourAmount")}>
          <Money fils={item.system_amount_fils} />
        </Fact>
        <Fact label={t("columns.providerAmount")}>
          <Money fils={item.gateway_amount_fils} />
        </Fact>
        <Fact label={t("columns.difference")}>
          <Money fils={item.difference_fils} className={item.difference_fils ? "font-bold text-danger-700" : undefined} />
        </Fact>
        {item.payment_facts && (
          <>
            <Fact label={t("resolve.captured")}>
              <Money fils={item.payment_facts.captured_fils} />
            </Fact>
            <Fact label={t("resolve.refunded")}>
              <Money fils={item.payment_facts.refunded_fils} />
            </Fact>
            {item.payment_facts.disputed_fils > 0 && (
              <Fact label={t("resolve.disputed")}>
                <Money fils={item.payment_facts.disputed_fils} className="font-bold text-danger-700" />
              </Fact>
            )}
            <Fact label={t("resolve.refundable")}>
              <Money fils={item.payment_facts.refundable_fils} />
            </Fact>
          </>
        )}
        {item.refund_facts && (
          <Fact label={t("resolve.ourRefund")} wide>
            <Money fils={item.refund_facts.amount_fils} /> · {t(`resolve.refundStatus.${item.refund_facts.status}`)}
          </Fact>
        )}
      </Facts>
    </div>
  );
}

function ResolveForm({ item, onClose, onBusy }: { item: ItemDetail; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const t = useTranslations("admin.finance.reconciliation.resolve");
  const text = useFinanceText();
  const label = useReconText();
  const describe = useFinanceError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAdminSession();
  const reasons = useRefundReasons();
  const keys = useIdempotencyKeys();
  const summary = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState<ResolveValues>(EMPTY);
  const [error, setError] = useState<ResolveFormError | null>(null);
  // The amount the API says the line has after a TERMS_CHANGED: the old one is kept to show what moved.
  const [changed, setChanged] = useState<{ from: number; to: number } | null>(null);
  const [confirming, setConfirming] = useState<ResolveBody | null>(null);

  const allowed = item.allowed_resolutions;
  const chosen = allowed.find((a) => a.code === values.code) ?? null;
  const reasonList = selectableReasons(reasons.data);
  const set = (changes: Partial<ResolveValues>) => {
    setValues((v) => ({ ...v, ...changes }));
    setError(null);
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
    void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
    void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
  };

  const send = useMutation({
    mutationFn: (body: ResolveBody) => resolveItem(item.id, body, item.version, keys.keyFor({ item: item.id, version: item.version, ...body })),
    onSuccess: (result) => {
      keys.settle();
      refresh();
      toast.success(result.refund ? t("doneRefund", { status: text.refund(result.refund.status, result.refund.status_label) }) : t("done"));
      onClose();
    },
    onError: (e) => {
      keys.settle(e);
      refresh();
      const moved = termsChangedAmount(e);
      if (moved !== null && confirming?.expected_amount_fils !== undefined) {
        // The numbers on the screen are not the API's any more: show the new ones and ask again.
        setChanged({ from: confirming.expected_amount_fils, to: moved });
        setConfirming({ ...confirming, expected_amount_fils: moved });
        void queryClient.invalidateQueries({ queryKey: adminKeys.reconciliationItem(item.id) });
        return;
      }
      if (e instanceof AdminApiError && ["STALE_VERSION", "RESOLUTION_NOT_ALLOWED", "RECONCILIATION_ITEM_RESOLVED", "RECONCILIATION_RUN_NOT_ACTIVE"].includes(e.code)) {
        setConfirming(null);
        void queryClient.invalidateQueries({ queryKey: adminKeys.reconciliationItem(item.id) });
      }
    },
  });
  const sending = send.isPending;
  useEffect(() => {
    onBusy(sending);
  }, [sending, onBusy]);

  useEffect(() => {
    if (confirming) summary.current?.focus();
  }, [confirming]);

  const review = () => {
    const built = buildResolveBody(values, item, allowed);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setChanged(null);
    send.reset();
    if (built.allowed.moves_money) setConfirming(built.body);
    else send.mutate(built.body);
  };

  const confirm = (event: MouseEvent<HTMLButtonElement>, body: ResolveBody) => {
    if (event.detail > 1) return;
    send.mutate(body);
  };

  const outcomeUnknown = send.isError && keepsIdempotencyKey(send.error);
  const errorText = send.error && !termsChangedAmount(send.error) ? describe(send.error) : null;
  const errorMessage = (code: ResolveFormError | null) => (code ? t(`errors.${code}`) : undefined);
  const reasonLabel = (code: string) => text.reason(reasonList.find((r) => r.code === code)?.label);

  const footer = confirming ? (
    <>
      <Button key="back" variant="outline" onClick={() => setConfirming(null)} disabled={send.isPending}>
        {t("back")}
      </Button>
      <Button key="confirm" variant="danger" onClick={(event) => confirm(event, confirming)} loading={send.isPending}>
        {t("confirmButton", { amount: text.money(confirming.expected_amount_fils ?? 0) })}
      </Button>
    </>
  ) : (
    <>
      <Button key="cancel" variant="outline" onClick={onClose} disabled={send.isPending}>
        {t("cancel")}
      </Button>
      <Button key="review" onClick={review} loading={send.isPending} disabled={allowed.length === 0}>
        {chosen?.moves_money ? t("review") : t("resolve")}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {confirming ? (
        <div ref={summary} tabIndex={-1} className="flex flex-col gap-3 outline-none">
          <dl className="flex flex-col gap-2 rounded-md bg-ivory-50 p-4 text-sm">
            <div className="flex justify-between gap-3 text-base font-bold text-ink-900">
              <dt>{t("amountToBook")}</dt>
              <dd>
                <Money fils={confirming.expected_amount_fils} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("resolution")}</dt>
              <dd className="text-end">{chosen ? label.resolution(chosen.code, chosen.label) : confirming.resolution_code}</dd>
            </div>
            {confirming.refund_reason_code && (
              <div className="flex justify-between gap-3">
                <dt>{t("refundReason")}</dt>
                <dd className="text-end">{reasonLabel(confirming.refund_reason_code)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt>{t("note")}</dt>
              <dd className="text-end">“{confirming.note}”</dd>
            </div>
          </dl>
          {changed && (
            <Notice tone="warning" title={t("termsChangedTitle")}>
              {t("termsChanged", { from: text.money(changed.from), to: text.money(changed.to) })}
            </Notice>
          )}
          <Notice tone="warning">{t("confirmNote")}</Notice>
        </div>
      ) : (
        <>
          <ItemFacts item={item} />
          {allowed.length === 0 ? (
            <Notice tone="info">{t("nothingAllowed")}</Notice>
          ) : (
            <>
              <Select
                label={t("resolution")}
                required
                placeholder={t("chooseResolution")}
                value={values.code}
                onChange={(e) => set({ code: e.target.value, paired_item_id: "", refund_reason_code: "" })}
                options={allowed.map((a) => ({
                  value: a.code,
                  label: `${label.resolution(a.code, a.label)}${a.moves_money ? ` — ${t("movesMoney")}` : ""}`,
                }))}
                error={errorMessage(error === "code_required" ? error : null)}
              />
              {chosen?.moves_money && !can("refunds.create") && <Notice tone="warning">{t("needsRefundPermission")}</Notice>}
              {chosen?.needs_pair && (
                <Select
                  label={t("pair")}
                  required
                  hint={t("pairHint")}
                  placeholder={item.pair_candidates.length === 0 ? t("noPairs") : t("choosePair")}
                  disabled={item.pair_candidates.length === 0}
                  value={values.paired_item_id}
                  onChange={(e) => set({ paired_item_id: e.target.value })}
                  options={item.pair_candidates.map((c) => ({
                    value: String(c.id),
                    label: t("pairOption", { line: c.line_no ?? "—", type: label.line(c.line_type, c.line_type_label), ref: itemRef(c) ?? "—", amount: text.money(c.gateway_amount_fils ?? c.system_amount_fils) }),
                  }))}
                  error={errorMessage(error === "pair_required" ? error : null)}
                />
              )}
              {chosen?.needs_reason_code && (
                <Select
                  label={t("refundReason")}
                  required
                  placeholder={reasons.isPending ? t("reasonsLoading") : t("chooseReason")}
                  disabled={reasons.isPending}
                  value={values.refund_reason_code}
                  onChange={(e) => set({ refund_reason_code: e.target.value })}
                  options={reasonList.map((r) => ({ value: r.code, label: text.reason(r.label) }))}
                  error={errorMessage(error === "reason_required" ? error : null)}
                />
              )}
              <TextArea
                label={t("noteField")}
                required
                hint={t("noteHint")}
                rows={3}
                maxLength={NOTE_MAX}
                value={values.note}
                onChange={(e) => set({ note: e.target.value })}
                error={errorMessage(error === "note_required" || error === "note_short" || error === "note_long" ? error : null)}
              />
            </>
          )}
        </>
      )}
      {outcomeUnknown ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          <p>{errorText}</p>
          <p>{t("unknownBody")}</p>
        </Notice>
      ) : errorText ? (
        <Notice tone="danger">{errorText}</Notice>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">{footer}</div>
    </div>
  );
}
