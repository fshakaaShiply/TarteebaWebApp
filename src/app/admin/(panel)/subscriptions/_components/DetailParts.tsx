"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, Notice, Pagination, StatusBadge } from "@/components/admin";
import { useAdminSession } from "@/lib/admin/session";
import { conflictReasonOf, pendingReview, renewalBusy } from "@/lib/admin/subscriptions/actions";
import { fetchSubscriptionEvents } from "@/lib/admin/subscriptions/endpoints";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import { OPEN_STATUSES, RUNNING_STATUSES, occurrenceTone, periodTone, tone } from "@/lib/admin/subscriptions/status";
import type { AddonDetail, SubscriptionDetail } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { DeadlineCountdown } from "../../bookings/_components/BookingBits";
import type { DialogRequest } from "./DialogHost";
import { HistoryLine } from "./HistoryLine";
import { HealthChip } from "./SubscriptionBits";
import { decisionFromRequest } from "./VisitDecisionDialogs";
import { Ltr } from "./kit";

export type TabId = "overview" | "visits" | "calendar" | "periods" | "history";

/** Label / value pairs of a card. */
export function Facts({ items, columns = 2 }: { items: { label: ReactNode; value: ReactNode }[]; columns?: 1 | 2 }) {
  return (
    <dl className={columns === 2 ? "grid gap-x-6 gap-y-2 sm:grid-cols-2" : "grid gap-y-2"}>
      {items.map((item, i) => (
        <div key={i} className="flex min-w-0 flex-col">
          <dt className="text-xs text-ink-600">{item.label}</dt>
          <dd className="text-sm text-ink-900">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Worker names in a list, each isolated (<bdi>) so a Latin name keeps its trailing period in Arabic. */
export function WorkerNames({ workers, className }: { workers: readonly { id: number; name: string }[]; className?: string }) {
  const text = useSubscriptionText();
  return (
    <span className={className}>
      {workers.map((w, i) => (
        <span key={w.id}>
          {i > 0 && (text.locale === "ar" ? "، " : ", ")}
          <bdi>{w.name}</bdi>
        </span>
      ))}
    </span>
  );
}

// ---- Banners --------------------------------------------------------------------------------------------------------

/**
 * What needs a decision or attention, above the tabs (design §9.1): a request waiting for confirmation with its
 * deadline and first visit (the API's `first_visit_at`, P4-244), a capture whose result is unknown, conflicts, a
 * failing renewal (Renew now waits while an attempt is under way, P4-251), a cancellation review, the customers' moves
 * waiting for an answer (each decided on its occurrence, `occurrence_ulid`), a running freeze, and how a finished
 * subscription ended.
 */
export function Banners({ subscription, open, goTo }: { subscription: SubscriptionDetail; open: (request: DialogRequest) => void; goTo: (tab: TabId) => void }) {
  const t = useTranslations("admin.subscriptions.banners");
  const text = useSubscriptionText();
  const { can } = useAdminSession();
  const manage = can("subscriptions.manage");
  const a = subscription.actions;
  const review = pendingReview(subscription);
  const renewal = subscription.renewal;
  const busy = renewalBusy(subscription);
  const failing = ["failed", "retrying", "suspended", "verifying"].includes(renewal.state);
  const requests = subscription.reschedule_requests ?? [];

  return (
    <div className="flex flex-col gap-2">
      {subscription.status === "pending_confirmation" && (
        <Notice tone="warning" title={t("pendingTitle")}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {subscription.confirmation_deadline_at && (
              <>
                <span>{t("deadline", { time: text.dateTime(subscription.confirmation_deadline_at) })}</span>
                <DeadlineCountdown deadline={subscription.confirmation_deadline_at} />
              </>
            )}
            {subscription.first_visit_at && <span>{t("firstVisit", { time: text.dateTime(subscription.first_visit_at) })}</span>}
          </span>
        </Notice>
      )}
      {subscription.capture_unknown_at && subscription.status === "pending_confirmation" && (
        <Notice
          tone="warning"
          title={t("captureUnknownTitle")}
          action={
            manage && a.confirm ? (
              <Button size="sm" className="self-start" onClick={() => open({ kind: "confirm" })}>
                {t("captureUnknownAction")}
              </Button>
            ) : undefined
          }
        >
          {t("captureUnknownBody", { time: text.dateTime(subscription.capture_unknown_at) })}
        </Notice>
      )}
      {subscription.conflicts.length > 0 && (
        <Notice
          tone="danger"
          title={t("conflictsTitle", { count: subscription.conflicts.length })}
          action={
            <Button variant="secondary" size="sm" className="self-start" onClick={() => goTo("visits")}>
              {t("conflictsAction")}
            </Button>
          }
        >
          <ul className="text-sm">
            {subscription.conflicts.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Ltr>{text.dateShort(c.scheduled_date)}</Ltr> · {text.conflictWithReason(c.conflict?.code ?? "", conflictReasonOf(c))}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {failing && (
        <Notice
          tone={renewal.state === "verifying" ? "info" : "danger"}
          title={t(`renewal.${renewal.state}`)}
          action={
            manage && a.renew ? (
              <Button size="sm" className="self-start" disabled={busy} onClick={() => open({ kind: "renew" })}>
                {t("renewNow")}
              </Button>
            ) : undefined
          }
        >
          <span className="flex flex-col gap-0.5">
            {busy && <span className="font-medium">{t("attemptUnderWay")}</span>}
            <span>{t("renewalAttempt", { n: renewal.attempt_no, max: renewal.max_attempts })}</span>
            {renewal.decline_message && <span>{text.name(renewal.decline_message)}</span>}
            {renewal.next_attempt_at && renewal.state === "retrying" && <span>{t("nextAttempt", { time: text.dateTime(renewal.next_attempt_at) })}</span>}
            {renewal.state === "suspended" && renewal.cancels_on && <span>{t("cancelsOn", { date: text.dateShort(renewal.cancels_on) })}</span>}
            {renewal.unreserved_from_date && <span>{t("unreservedFrom", { date: text.dateShort(renewal.unreserved_from_date), count: renewal.unreserved_visits_count })}</span>}
          </span>
        </Notice>
      )}
      {review && (
        <Notice
          tone="warning"
          title={t("reviewTitle")}
          action={
            <span className="flex flex-wrap gap-2">
              {can("refunds.create") && a.resolve_review && (
                <Button size="sm" onClick={() => open({ kind: "resolveReview" })}>
                  {t("resolve")}
                </Button>
              )}
              {manage && a.resolve_review && (
                <Button variant="secondary" size="sm" onClick={() => open({ kind: "declineReview" })}>
                  {t("decline")}
                </Button>
              )}
              {/* §4.7: coordinators may instead cancel as the company; the API closes the review as superseded. */}
              {manage && a.resolve_review && (
                <Button variant="outline" size="sm" className="text-danger-700" onClick={() => open({ kind: "cancel", party: "company" })}>
                  {t("cancelAsCompany")}
                </Button>
              )}
            </span>
          }
        >
          {t("reviewBody", {
            time: text.dateTime(review.requested_at),
            party: review.party ? t(`party.${review.party}`) : "—",
            reason: review.reason_code ? text.reason(review.reason_code) : "—",
          })}
          {review.reason_text && <span className="block">“{review.reason_text}”</span>}
        </Notice>
      )}
      {requests.length > 0 && (
        <Notice
          tone="warning"
          title={t("requestsTitle", { count: requests.length })}
          action={
            <span className="flex flex-wrap gap-2">
              {requests.map((r) => {
                const decision = decisionFromRequest(r, subscription.upcoming ?? []);
                return (
                  <span key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{t("request", { from: text.dateShort(r.occurrence_date ?? r.from_date), date: text.dateShort(r.date), slot: text.slot(r.slot) })}</span>
                    {manage && decision && (
                      <Button size="sm" variant="secondary" onClick={() => open({ kind: "decide", request: decision })}>
                        {t("decide")}
                      </Button>
                    )}
                  </span>
                );
              })}
            </span>
          }
        />
      )}
      {subscription.freeze && RUNNING_STATUSES.includes(subscription.status) && (
        <Notice
          tone="info"
          title={t("freezeTitle", { from: text.dateShort(subscription.freeze.from), to: text.dateShort(subscription.freeze.to) })}
          action={
            manage && a.unfreeze ? (
              <Button variant="secondary" size="sm" className="self-start" onClick={() => open({ kind: "unfreeze" })}>
                {t("unfreeze")}
              </Button>
            ) : undefined
          }
        />
      )}
      {subscription.status === "expiring" && <Notice tone="info">{t("expiring", { date: text.dateShort(subscription.term_end_date) })}</Notice>}
      {subscription.cancelled && (
        <Notice tone="neutral" title={t("cancelledTitle", { time: text.dateTime(subscription.cancelled.at) })}>
          {subscription.cancelled.reason_code ? text.reason(subscription.cancelled.reason_code) : null}
          {subscription.cancelled.reason && <span className="block">“{subscription.cancelled.reason}”</span>}
        </Notice>
      )}
      {subscription.status === "rejected" && subscription.rejected_reason && (
        <Notice tone="neutral" title={t("rejectedTitle")}>
          “{subscription.rejected_reason}”
        </Notice>
      )}
    </div>
  );
}

// ---- Overview -------------------------------------------------------------------------------------------------------

const ADDRESS_KEYS = ["label", "building", "street", "area", "city", "notes"] as const;

export function OverviewTab({ subscription, open, goTo }: { subscription: SubscriptionDetail; open: (request: DialogRequest) => void; goTo: (tab: TabId) => void }) {
  const t = useTranslations("admin.subscriptions.overview");
  const text = useSubscriptionText();
  const { can } = useAdminSession();
  const manage = can("subscriptions.manage") && subscription.actions.assign;
  const liveOut = subscription.type === "live_out";
  const address = ADDRESS_KEYS.map((k) => subscription.address?.[k]).filter((v): v is string => typeof v === "string" && v !== "");
  const renewal = subscription.renewal;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title={t("contract")}>
        <Facts
          items={[
            { label: t("plan"), value: text.name(subscription.plan_label) || subscription.service.code },
            { label: t("service"), value: text.name(subscription.service.name) },
            { label: t("term"), value: `${text.dateShort(subscription.start_date)} – ${text.dateShort(subscription.term_end_date)}` },
            { label: t("visitsPerPeriod"), value: subscription.visits_per_period },
            { label: t("autoRenew"), value: subscription.auto_renew ? t("on") : subscription.auto_renew_allowed ? t("off") : t("notAllowed") },
            { label: t("source"), value: text.source(subscription.source) },
            { label: t("materials"), value: text.materialsBy(subscription.materials_by) },
            { label: t("workersCount"), value: subscription.workers_count },
            ...(subscription.addon_details.length > 0 ? [{ label: t("addons"), value: <AddonNames addons={subscription.addon_details} /> }] : []),
            ...(subscription.coupon?.code ? [{ label: t("coupon"), value: <Ltr>{subscription.coupon.code}</Ltr> }] : []),
          ]}
        />
        {subscription.instructions && <p className="rounded-md bg-neutral-100 p-3 text-sm text-ink-900">{subscription.instructions}</p>}
      </Card>

      <Card title={t("pattern")}>
        <Facts
          items={[
            ...(liveOut
              ? [{ label: t("restDays"), value: text.weekdays(subscription.pattern.rest_weekdays, "long") || "—" }]
              : [{ label: t("days"), value: text.weekdays(subscription.pattern.days_of_week, "long") || "—" }]),
            { label: t("slot"), value: <Ltr>{text.slot(subscription.pattern.slot)}</Ltr> },
            { label: t("patternFrom"), value: text.dateShort(subscription.pattern.pattern_from) },
          ]}
        />
      </Card>

      <Card title={t("customer")}>
        <Facts
          items={[
            { label: t("name"), value: subscription.customer.name ?? t("noName") },
            { label: t("phone"), value: <Ltr>{subscription.customer.phone}</Ltr> },
            { label: t("zone"), value: text.name(subscription.zone.name) },
            { label: t("address"), value: address.length > 0 ? address.join(text.locale === "ar" ? "، " : ", ") : "—" },
          ]}
        />
      </Card>

      <Card
        title={t("workers")}
        actions={
          manage ? (
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => open({ kind: "assign", role: "primary" })}>
                {t("assignPrimary")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => open({ kind: "assign", role: "backup" })}>
                {t("assignBackup")}
              </Button>
            </span>
          ) : undefined
        }
      >
        <Facts
          items={[
            { label: t("primary"), value: subscription.workers.primary ? <bdi>{subscription.workers.primary.name}</bdi> : t("none") },
            { label: t("backup"), value: subscription.workers.backup ? <bdi>{subscription.workers.backup.name}</bdi> : t("none") },
          ]}
        />
        <p className="text-xs text-ink-600">{liveOut ? t("workersNoteLiveOut") : t("workersNote")}</p>
      </Card>

      <Card title={t("payment")}>
        <Facts
          items={[
            { label: t("health"), value: <HealthChip health={subscription.payment_health} /> },
            {
              label: t("card"),
              value: subscription.payment_method ? (
                <span>
                  {subscription.payment_method.label}
                  {subscription.payment_method.expired && <span className="ms-1 text-danger-700">{t("cardExpired")}</span>}
                </span>
              ) : (
                t("noCard")
              ),
            },
            { label: t("consent"), value: subscription.mit_consent.at ? text.dateTime(subscription.mit_consent.at) : t("noConsent") },
            { label: t("renewal"), value: t(`renewalStates.${renewal.state}`) },
            ...(renewal.next_renewal_at ? [{ label: t("nextRenewal"), value: text.dateTime(renewal.next_renewal_at) }] : []),
            ...(renewal.amount_fils !== null ? [{ label: t("renewalAmount"), value: text.moneyFixed(renewal.amount_fils) }] : []),
            ...(subscription.discount.type
              ? [{ label: t("discount"), value: subscription.discount.eligible ? t("discountOn", { visits: subscription.discount.consumed_visits, min: subscription.discount.min_visits_for_discount ?? 0 }) : t("discountRevoked") }]
              : []),
          ]}
        />
      </Card>

      <Card
        title={t("upcoming")}
        actions={
          <Button variant="ghost" size="sm" onClick={() => goTo("visits")}>
            {t("allVisits")}
          </Button>
        }
      >
        {(subscription.upcoming ?? []).length === 0 ? (
          // "…yet" only while the subscription is open: an ended, cancelled, expired or declined one plans none.
          <p className="text-sm text-ink-600">{OPEN_STATUSES.includes(subscription.status) ? t("noUpcoming") : t("noUpcomingClosed")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {subscription.upcoming.slice(0, 8).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Ltr>{text.dateShort(v.scheduled_date)}</Ltr>
                <Ltr>{text.slot(v.slot)}</Ltr>
                <StatusBadge tone={tone(occurrenceTone, v.state)}>{v.state_label || text.occurrence(v.state)}</StatusBadge>
                <WorkerNames workers={v.workers} className="text-ink-600" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * The contract's add-ons by name in the UI language (the detail's `addon_details`, P4-244, for every reader); a code
 * the catalogue no longer names is shown as it is, kept left to right.
 */
function AddonNames({ addons }: { addons: readonly AddonDetail[] }) {
  const text = useSubscriptionText();
  return (
    <span>
      {addons.map((addon, i) => {
        const name = addon.name ? text.name(addon.name) : "";
        return (
          <span key={addon.code}>
            {i > 0 && (text.locale === "ar" ? "، " : ", ")}
            {name || <Ltr>{addon.code}</Ltr>}
          </span>
        );
      })}
    </span>
  );
}

// ---- Periods and payments -------------------------------------------------------------------------------------------

/** Every period with its dates, visits, state, amount and what its payment and invoice are (A09 links for finance readers). */
export function PeriodsTab({ subscription }: { subscription: SubscriptionDetail }) {
  const t = useTranslations("admin.subscriptions.periods");
  const text = useSubscriptionText();
  const { canAny } = useAdminSession();
  const payments = canAny(["payments.view"]);
  const invoices = canAny(["payments.view", "invoices.manage"]);
  if (subscription.periods.length === 0) return <EmptyState title={t("empty")} />;
  // A voided authorization (a request rejected or cancelled before confirmation) took no money: never "failed".
  const paymentLabel = (status: string) => (status === "voided" ? t("paymentVoided") : text.health(paymentHealthOf(status)));
  const th = "px-2 py-2 text-start font-medium";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 900 }}>
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="text-ink-600">
            <th scope="col" className={th}>{t("sequence")}</th>
            <th scope="col" className={th}>{t("dates")}</th>
            <th scope="col" className={th}>{t("visits")}</th>
            <th scope="col" className={th}>{t("status")}</th>
            <th scope="col" className={th}>{t("amount")}</th>
            <th scope="col" className={th}>{t("payment")}</th>
            <th scope="col" className={th}>{t("invoice")}</th>
            <th scope="col" className={th}>{t("refunded")}</th>
          </tr>
        </thead>
        <tbody>
          {subscription.periods.map((p) => (
            <tr key={p.id} className="border-t border-line align-top">
              <td className="px-2 py-2.5 font-latin font-bold">{p.sequence}</td>
              <td className="px-2 py-2.5 whitespace-nowrap">
                <Ltr>{`${text.dateShort(p.start)} – ${text.dateShort(p.end)}`}</Ltr>
              </td>
              <td className="px-2 py-2.5 font-latin">{t("visitsOf", { done: p.visits_completed, planned: p.visits_planned })}</td>
              <td className="px-2 py-2.5">
                <StatusBadge tone={tone(periodTone, p.status)}>{text.period(p.status)}</StatusBadge>
              </td>
              <td className="px-2 py-2.5 whitespace-nowrap">
                {/* An upcoming period is priced at its renewal notice (notified_amount_fils): until then its 0 is no price. */}
                {p.status === "upcoming" && p.notified_amount_fils === null ? (
                  <span className="text-ink-600">{t("notPriced")}</span>
                ) : (
                  <span className="font-latin">{text.moneyFixed(p.amount_fils)}</span>
                )}
                {p.notified_amount_fils !== null && p.notified_amount_fils !== p.amount_fils && (
                  <span className="block font-latin text-xs text-ink-600">{t("notified", { amount: text.moneyFixed(p.notified_amount_fils) })}</span>
                )}
              </td>
              <td className="px-2 py-2.5">
                {p.payment ? (
                  <span className="flex flex-col">
                    {payments ? (
                      <Link href={`/admin/finance/payments/${p.payment.id}`} className="font-medium">
                        {paymentLabel(p.payment.status)}
                      </Link>
                    ) : (
                      <span>{paymentLabel(p.payment.status)}</span>
                    )}
                    {p.payment.card_label && <span className="text-xs text-ink-600">{p.payment.card_label}</span>}
                  </span>
                ) : (
                  <span className="text-ink-600">—</span>
                )}
              </td>
              <td className="px-2 py-2.5">
                {p.invoice ? invoices ? <Link href={`/admin/finance/invoices/${p.invoice.id}`} className="font-medium"><Ltr>{p.invoice.number}</Ltr></Link> : <Ltr>{p.invoice.number}</Ltr> : <span className="text-ink-600">—</span>}
              </td>
              <td className="px-2 py-2.5 font-latin whitespace-nowrap">
                {p.refunded_fils > 0 ? text.moneyFixed(p.refunded_fils) : "—"}
                {p.refundable_fils > 0 && <span className="block text-xs text-ink-600">{t("refundable", { amount: text.moneyFixed(p.refundable_fils) })}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A payment's own status as the provider reports it, mapped to the health words staff know (never "paid" before
 * capture). `voided` has its own label (PeriodsTab), as nothing failed there.
 */
function paymentHealthOf(status: string): string {
  if (status === "captured" || status === "partially_refunded") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "verifying") return "verifying";
  if (status === "failed") return "renewal_failed";
  return "pending";
}

// ---- History --------------------------------------------------------------------------------------------------------

export function HistoryTab({ subscription }: { subscription: SubscriptionDetail }) {
  const t = useTranslations("admin.subscriptions.history");
  const text = useSubscriptionText();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: subscriptionKeys.events(subscription.id, page),
    queryFn: () => fetchSubscriptionEvents(subscription.id, page),
    retry: false,
  });
  if (query.isPending) return <LoadingBlock lines={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data.data.length === 0) return <EmptyState title={t("empty")} />;
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col" aria-label={t("title")}>
        {query.data.data.map((e) => (
          <li key={e.id} className="flex flex-col gap-0.5 border-t border-line py-2.5 first:border-t-0">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-bold text-ink-900">{e.type_label || e.type}</span>
              <span className="text-xs text-ink-600">
                {text.dateTime(e.created_at)} · {e.actor.name ? <bdi>{e.actor.name}</bdi> : t(`actors.${e.actor.type}`)}
              </span>
            </p>
            <HistoryLine event={e} periods={subscription.periods} />
          </li>
        ))}
      </ol>
      <Pagination meta={query.data.meta} onPageChange={setPage} />
    </div>
  );
}
