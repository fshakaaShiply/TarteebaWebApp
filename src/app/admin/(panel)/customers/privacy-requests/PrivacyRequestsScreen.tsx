"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, ConfirmDialog, CustomerLink, DataTable, EmptyState, FilterBar, Notice, PageHeader, SearchField, Select, StatusBadge, TextArea, useToast, type Column } from "@/components/admin";
import { filterKey } from "@/lib/admin/finance/filters";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { cancelPrivacyRequest, fetchPrivacyRequest, fetchPrivacyRequests, retryPrivacyRequest } from "@/lib/admin/customers/endpoints";
import { isStale, privacyRequestEnded, usePrivacyError } from "@/lib/admin/customers/errors";
import { FormProblem, REASON_MAX, checkReason, type FormError } from "@/lib/admin/customers/forms";
import { PRIVACY_FILTERS, PRIVACY_STATUS_CHOICES, privacyQuery } from "@/lib/admin/customers/filters";
import { customerKeys } from "@/lib/admin/customers/keys";
import { privacyToneOf } from "@/lib/admin/customers/status";
import { useCustomerText } from "@/lib/admin/customers/text";
import { PRIVACY_STATUSES, PRIVACY_TYPES, type PrivacyRequest, type PrivacyStatus } from "@/lib/admin/customers/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Ltr } from "../../bookings/_components/BookingBits";
import { useUrlFilters } from "../../finance/_components/useUrlFilters";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";
import { MovedNotice } from "../_components/CustomerParts";

const PER_PAGE = 25;
/** Statuses that still need someone (the API's `open`): the count shown on the "Open" shortcut. */
const OPEN_STATUSES: readonly PrivacyStatus[] = ["received", "scheduled", "processing", "failed"];

/**
 * A07 privacy requests (customers §7.1, P5-C45; customers.privacy_requests): the data copies and account deletions of every
 * customer, the open ones first. A deletion shows the day it runs and what it waits on; a failed one shows why and can be
 * retried; a request that has not started erasing can be cancelled (the account comes back; what the deletion already
 * cancelled does not). Once erasure has begun the API offers neither: only a retry.
 */
export function PrivacyRequestsScreen() {
  const t = useTranslations("admin.privacy");
  return (
    <RequirePermission anyOf={["customers.privacy_requests"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Queue />
    </RequirePermission>
  );
}

function Queue() {
  const t = useTranslations("admin.privacy");
  const text = useCustomerText();
  const toast = useToast();
  const describe = usePrivacyError();
  const queryClient = useQueryClient();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(PRIVACY_FILTERS);
  const q = useDebouncedValue(filters.q.trim(), 300);
  const query = useMemo(() => privacyQuery(filters, q, PER_PAGE), [filters, q]);
  const list = useQuery({
    queryKey: customerKeys.privacyList(filterKey(PRIVACY_FILTERS, filters, { q })),
    queryFn: () => fetchPrivacyRequests(query),
    placeholderData: keepPreviousData,
  });
  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const [cancelling, setCancelling] = useState<PrivacyRequest | null>(null);
  // The dialog follows the row the queue holds now; the click's copy stands in once the cancel took it out of the list.
  const live = cancelling ? list.data?.data.find((r) => r.id === cancelling.id) : undefined;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: customerKeys.all });
  const retry = useMutation({
    mutationFn: (row: PrivacyRequest) => retryPrivacyRequest(row.id, row.version),
    onSuccess: () => {
      refresh();
      toast.success(t("retried"));
    },
    onError: (e, row) => {
      toast.error(isStale(e) ? t("retryStale") : describe(e, "retry", row.id));
      refresh();
    },
  });

  const counts = meta?.counts_by_status;
  const openCount = counts ? OPEN_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : null;
  const status = filters.status || "open";

  const columns: Column<PrivacyRequest>[] = [
    {
      id: "request",
      header: t("columns.request"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-bold text-ink-900">{text.privacyType(r.type, r.type_label)}</span>
          <span className="text-xs text-ink-600">
            <Ltr>{`#${r.id}`}</Ltr> · {r.source === "staff" ? t("fromStaff") : t("fromApp")} · {text.verification(r.verification, r.verification_label)}
          </span>
          {r.handled_by && <span className="text-xs text-ink-600">{t("handledBy", { name: r.handled_by.name })}</span>}
        </span>
      ),
    },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          {/* A null name is a deleted account only when the status says so: a live customer may not have given one yet
              (the phone stands in, as CustomerLink does). */}
          <CustomerLink customer={{ id: r.customer.id, name: r.customer.name || (r.customer.status === "deleted" ? t("deletedCustomer") : null), phone: r.customer.phone }} />
          {r.customer.status !== "active" && <span className="text-xs text-ink-600">{text.status(r.customer.status, r.customer.status_label)}</span>}
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={privacyToneOf(r.status)}>{text.privacyStatus(r.status, r.status_label)}</StatusBadge>
          {r.waiting_on.length > 0 && (
            <span className="flex flex-wrap gap-1" aria-label={t("waitingOn")}>
              {r.waiting_on.map((w) => (
                <StatusBadge key={w.code} tone="neutral">
                  {text.waitingOn(w.code, w.label)}
                </StatusBadge>
              ))}
            </span>
          )}
          {r.status === "failed" && (
            <span className="text-xs text-danger-700">
              {t("failedWith", { reason: r.failure_code ? text.failure(r.failure_code, r.failure_label) : t("failedUnknown"), attempts: r.attempts })}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "dates",
      header: t("columns.dates"),
      cell: (r) => (
        <span className="flex flex-col text-xs text-ink-600">
          <span className="whitespace-nowrap">{t("createdOn", { at: text.dateTime(r.created_at) })}</span>
          {r.status === "scheduled" && r.scheduled_for && <span className="whitespace-nowrap text-ink-900">{t("runsOn", { at: text.dateTime(r.scheduled_for) })}</span>}
          {r.completed_at && <span className="whitespace-nowrap">{t("completedOn", { at: text.dateTime(r.completed_at) })}</span>}
          {r.cancelled_at && <span className="whitespace-nowrap">{t("cancelledOn", { at: text.dateTime(r.cancelled_at) })}</span>}
          {r.type === "export" && r.export && (
            <span>{t("exportInfo", { downloads: r.export.download_count, expires: r.export.expires_at ? text.dateTime(r.export.expires_at) : "—" })}</span>
          )}
          {r.cancel_reason && <span>“{r.cancel_reason}”</span>}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          {r.actions.cancel && (
            <Button size="sm" variant="outline" onClick={() => setCancelling(r)} aria-label={t("cancelLabel", { id: r.id })}>
              {t("cancel")}
            </Button>
          )}
          {r.actions.retry && (
            <Button size="sm" variant="secondary" onClick={() => retry.mutate(r)} loading={retry.isPending && retry.variables?.id === r.id} aria-label={t("retryLabel", { id: r.id })}>
              {t("retry")}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Card>
      {counts && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("counts")}>
          <Button size="sm" variant={status === "open" ? "primary" : "outline"} onClick={() => set({ status: "" })} aria-pressed={status === "open"}>
            {t("openCount", { count: openCount ?? 0 })}
          </Button>
          {PRIVACY_STATUSES.map((s) => (
            <Button key={s} size="sm" variant={status === s ? "primary" : "outline"} onClick={() => set({ status: s })} aria-pressed={status === s}>
              {t("statusCount", { status: text.privacyStatus(s), count: counts[s] ?? 0 })}
            </Button>
          ))}
        </div>
      )}
      <FilterBar canReset={filtered} onReset={reset}>
        <SearchField value={filters.q} onChange={(v) => set({ q: v })} label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} />
        <Select
          label={t("filters.type")}
          placeholder={t("filters.allTypes")}
          value={filters.type}
          onChange={(e) => set({ type: e.target.value })}
          options={PRIVACY_TYPES.map((v) => ({ value: v, label: text.privacyType(v) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.openDefault")}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          options={PRIVACY_STATUS_CHOICES.filter((v) => v !== "open").map((v) => ({ value: v, label: v === "all" ? t("filters.allStatuses") : text.privacyStatus(v) }))}
          containerClassName="min-w-[190px]"
        />
      </FilterBar>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? t("emptyFilteredBody") : t("emptyBody")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={900}
      />
      {cancelling && <CancelRequestDialog request={live ?? cancelling} onClose={() => setCancelling(null)} />}
    </Card>
  );
}

/**
 * Cancels a request that has not started erasing (customers.privacy_requests; reason 3 to 500 characters, the request's
 * version as If-Match). A deletion's account is restored to what it was, but what the request cancelled stays cancelled
 * (P5-C15): the dialog lists it as not restored.
 *
 * The dialog acts on its copy of the request (useSeenRecord). After a 409 STALE_VERSION it reads the request itself
 * (GET /admin/privacy-requests/{id}): the queue's filtered page may no longer hold it (one someone else cancelled leaves the
 * default "open" list), so waiting for the list would wait for ever and resend the refused version. When the request can
 * still be cancelled, its new facts and version replace the copy and staff confirm again; when it cannot (the API's
 * `actions.cancel` is false), or the API answers 409 INVALID_STATE (the hourly run claimed it: processing, without a new
 * version) or ERASURE_STARTED, the dialog closes and says why, and the queue is read again.
 */
function CancelRequestDialog({ request, onClose }: { request: PrivacyRequest; onClose: () => void }) {
  const t = useTranslations("admin.privacy.cancelDialog");
  const privacy = useTranslations("admin.privacy");
  const errors = useTranslations("admin.customers.errors");
  const text = useCustomerText();
  const describe = usePrivacyError();
  const toast = useToast();
  const queryClient = useQueryClient();
  // The request as read on its own after the API said it moved; the newer of it and the queue's row is the live one.
  const [fresh, setFresh] = useState<PrivacyRequest | null>(null);
  const [rereadError, setRereadError] = useState<unknown>(null);
  const live = fresh && fresh.version >= request.version ? fresh : request;
  const seen = useSeenRecord(live);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const shownRequest = seen.record;
  const snapshot = shownRequest.type === "delete" ? shownRequest.impact_snapshot : null;
  const bookings = snapshot?.bookings ?? [];
  const subscriptions = snapshot?.subscriptions ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: customerKeys.all });
  const ended = (message: string) => {
    toast.error(message);
    onClose();
  };

  const reread = async () => {
    setRereadError(null);
    try {
      const now = await fetchPrivacyRequest(request.id);
      if (now.actions.cancel) return setFresh(now);
      // A failed deletion whose erasure began keeps a cancellable status but is no longer cancellable (P5-C51).
      const erasing = now.status === "failed" && (now.processing_started_at !== null || Object.keys(now.erasure_log ?? {}).length > 0);
      ended(erasing ? errors("ERASURE_STARTED") : privacy("state.cancel", { id: now.id, status: text.privacyStatus(now.status, now.status_label) }));
    } catch (e) {
      setRereadError(e);
    }
  };

  const run = useMutation({
    mutationFn: () => {
      const problem = checkReason(reason);
      if (problem) throw new FormProblem("reason", problem);
      return cancelPrivacyRequest(request.id, reason, seen.record.version);
    },
    onSuccess: () => {
      refresh();
      toast.success(t("done"));
      onClose();
    },
    onError: (e) => {
      if (e instanceof FormProblem) return setError(e.error);
      refresh();
      if (isStale(e)) {
        seen.moved();
        void reread();
      } else if (privacyRequestEnded(e)) {
        ended(describe(e, "cancel", request.id));
      }
    },
  });
  const shown = run.isError && !(run.error instanceof FormProblem) && !isStale(run.error) && !privacyRequestEnded(run.error) ? run.error : null;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !run.isPending && onClose()}
      title={t("title", { id: request.id })}
      description={request.type === "delete" ? t("descriptionDelete") : t("descriptionExport")}
      confirmLabel={t("confirm")}
      tone="danger"
      pending={run.isPending}
      // While the request is being read again, a confirm would only send the refused version once more.
      onConfirm={() => !seen.waiting && (setError(null), seen.seen(), run.mutate())}
    >
      <div className="flex flex-col gap-4">
        {(bookings.length > 0 || subscriptions.length > 0) && (
          <Notice tone="warning" title={t("notRestoredTitle")}>
            <span className="flex flex-col gap-1">
              <span>{t("notRestoredBody")}</span>
              <ul className="flex flex-col gap-0.5">
                {bookings.map((b) => (
                  <li key={b.ulid}>
                    <Ltr>{b.reference}</Ltr> · {t("bookingMoney", { fee: text.money(b.fee_fils), refund: text.money(b.refund_fils) })}
                  </li>
                ))}
                {subscriptions.map((s) => (
                  <li key={s.ulid}>
                    <Ltr>{s.reference}</Ltr> · {t("subscriptionMoney", { fee: text.money(s.fee_fils), refund: text.money(s.refund_fils) })}
                  </li>
                ))}
              </ul>
            </span>
          </Notice>
        )}
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
        <MovedNotice kind="request" waiting={seen.waiting} renewed={seen.renewed} />
        {seen.waiting && rereadError !== null && (
          <Notice
            tone="danger"
            action={
              <div>
                <Button size="sm" variant="secondary" onClick={() => void reread()}>
                  {privacy("moved.readAgain")}
                </Button>
              </div>
            }
          >
            {describe(rereadError, "cancel", request.id)}
          </Notice>
        )}
        {shown && <Notice tone="danger">{describe(shown, "cancel", request.id)}</Notice>}
      </div>
    </ConfirmDialog>
  );
}
