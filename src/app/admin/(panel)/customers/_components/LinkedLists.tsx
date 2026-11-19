"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ButtonLink, Card, DataTable, EmptyState, StarRating, StatusBadge, type Column } from "@/components/admin";
import { fetchLinked } from "@/lib/admin/customers/endpoints";
import { customerKeys } from "@/lib/admin/customers/keys";
import { PRIVACY_QUEUE_PATH, privacyToneOf } from "@/lib/admin/customers/status";
import { useCustomerText } from "@/lib/admin/customers/text";
import type { CustomerDetail, CustomerListLink } from "@/lib/admin/customers/types";
import type { AdminCaseRow, RatingRow } from "@/lib/admin/quality/types";
import { statusToneOf } from "@/lib/admin/subscriptions/status";
import type { AdminPayment } from "@/lib/admin/types";
import { useAdminSession } from "@/lib/admin/session";
import { Ltr, BookingChips } from "../../bookings/_components/BookingBits";
import { paymentTone } from "../../bookings/_components/bookingText";
import type { ActivityRow } from "./useCustomerActivity";

/** The design's "recent bookings and subscriptions" table: reference, when, state and amount, each opening its own page. */
export function CustomerActivityTable({ rows, pending, error, onRetry }: { rows: readonly ActivityRow[]; pending: boolean; error: unknown; onRetry: () => void }) {
  const t = useTranslations("admin.customers.activity");
  const text = useCustomerText();
  const columns: Column<ActivityRow>[] = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (r) =>
        r.kind === "booking" ? (
          <Link href={`/admin/bookings/${r.booking.id}`} className="font-bold">
            <Ltr>{r.booking.reference}</Ltr>
          </Link>
        ) : (
          <span className="flex flex-col">
            <Link href={`/admin/subscriptions/${r.subscription.id}`} className="font-bold">
              <Ltr>{r.subscription.reference}</Ltr>
            </Link>
            <span className="text-xs text-ink-600">{text.name(r.subscription.plan_label) || t("subscription")}</span>
          </span>
        ),
    },
    {
      id: "when",
      header: t("columns.when"),
      cell: (r) =>
        r.kind === "booking" ? (
          <span className="flex flex-col">
            <span className="whitespace-nowrap">{text.date(r.booking.service_date)}</span>
            <span className="text-xs text-ink-600">{text.name(r.booking.service.name)}</span>
          </span>
        ) : (
          <span className="flex flex-col">
            <span className="whitespace-nowrap">{t("termEnds", { date: text.date(r.subscription.term_end_date) })}</span>
            <span className="text-xs text-ink-600">{[r.subscription.address.label, r.subscription.address.area].filter(Boolean).join(" · ")}</span>
          </span>
        ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) =>
        r.kind === "booking" ? (
          <BookingChips status={r.booking.status} statusLabel={r.booking.status_label} payment={r.booking.payment_status} paymentLabel={r.booking.payment_status_label} />
        ) : (
          <StatusBadge tone={statusToneOf(r.subscription.status)}>{text.name(r.subscription.status_label)}</StatusBadge>
        ),
    },
    {
      id: "amount",
      header: t("columns.amount"),
      cell: (r) => (r.kind === "booking" ? <span className="font-latin whitespace-nowrap">{text.money(r.booking.total_fils)}</span> : <span className="text-ink-600">—</span>),
    },
  ];
  return (
    <Card title={t("title")}>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={pending ? undefined : rows}
        getRowId={(r) => r.key}
        loading={pending}
        error={error}
        onRetry={onRetry}
        empty={<EmptyState title={t("empty")} />}
        minWidth={560}
      />
    </Card>
  );
}

const PER_PAGE = 10;

/** One module's list for this customer, a page at a time, through the profile's link (null without that list's permission). */
function useLinkedPage<T>(customerId: string, name: string, link: CustomerListLink | null) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: customerKeys.linked(customerId, name, page),
    queryFn: () => fetchLinked<T>(link!, { page, perPage: PER_PAGE }),
    enabled: link !== null,
    placeholderData: keepPreviousData,
  });
  return { page, setPage, query };
}

/** The customer's payments (payments.view), each opening A09's payment page. */
export function CustomerPaymentsTab({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.payments");
  const text = useCustomerText();
  const { setPage, query } = useLinkedPage<AdminPayment>(customer.id, "payments", customer.links.payments);
  const columns: Column<AdminPayment>[] = [
    { id: "date", header: t("columns.date"), cell: (p) => <span className="whitespace-nowrap">{text.dateTime(p.created_at)}</span> },
    {
      id: "for",
      header: t("columns.for"),
      cell: (p) => (
        <span className="flex flex-col">
          <Link href={`/admin/finance/payments/${p.id}`} className="w-fit font-bold">
            <Ltr>{p.payable.reference ?? `#${p.id}`}</Ltr>
          </Link>
          <span className="text-xs text-ink-600">{t(`payable.${p.payable.type}`)}</span>
        </span>
      ),
    },
    { id: "amount", header: t("columns.amount"), cell: (p) => <span className="font-latin whitespace-nowrap">{text.money(p.amount_fils)}</span> },
    {
      id: "status",
      header: t("columns.status"),
      cell: (p) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={paymentTone[p.status] ?? "neutral"}>{text.name(p.status_label)}</StatusBadge>
          {p.refunded_fils > 0 && <span className="text-xs text-ink-600">{t("refunded", { amount: text.money(p.refunded_fils) })}</span>}
        </span>
      ),
    },
  ];
  return (
    <Card title={t("title")}>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.data}
        getRowId={(p) => p.id}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={t("empty")} />}
        pagination={query.data ? { meta: query.data.meta, onPageChange: setPage } : undefined}
        minWidth={520}
      />
    </Card>
  );
}

/** The customer's complaints and support requests and the ratings she gave (complaints.manage), each opening its page. */
export function CustomerQualityTab({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.quality");
  const text = useCustomerText();
  const cases = useLinkedPage<AdminCaseRow>(customer.id, "complaints", customer.links.complaints);
  const ratings = useLinkedPage<RatingRow>(customer.id, "ratings", customer.links.ratings);
  const caseColumns: Column<AdminCaseRow>[] = [
    {
      id: "case",
      header: t("columns.case"),
      cell: (c) => (
        <span className="flex flex-col">
          <Link href={`/admin/quality/${c.id}`} className="w-fit font-bold">
            <Ltr>{c.reference}</Ltr>
          </Link>
          <span className="text-xs text-ink-600">{text.name(c.type_label)}</span>
        </span>
      ),
    },
    { id: "status", header: t("columns.status"), cell: (c) => <StatusBadge tone="neutral">{text.name(c.status_label)}</StatusBadge> },
    { id: "created", header: t("columns.created"), cell: (c) => <span className="whitespace-nowrap">{text.dateTime(c.created_at)}</span> },
  ];
  const ratingColumns: Column<RatingRow>[] = [
    {
      id: "visit",
      header: t("columns.visit"),
      cell: (r) => (
        <span className="flex flex-col">
          <Link href={`/admin/bookings/${r.booking.id}`} className="w-fit font-bold">
            <Ltr>{r.booking.reference}</Ltr>
          </Link>
          <span className="text-xs text-ink-600">{text.date(r.service_date)}</span>
        </span>
      ),
    },
    { id: "rating", header: t("columns.rating"), cell: (r) => <StarRating value={r.overall} size="sm" /> },
    { id: "comment", header: t("columns.comment"), cell: (r) => (r.comment ? <span className="line-clamp-2 max-w-[260px]">“{r.comment}”</span> : <span className="text-ink-600">—</span>) },
  ];
  return (
    <div className="flex flex-col gap-4">
      {customer.links.complaints && (
        <Card title={t("casesTitle")} actions={<ButtonLink variant="outline" size="sm" href={`/admin/quality?customer_id=${customer.id}&status=all`}>{t("allCases")}</ButtonLink>}>
          <DataTable
            caption={t("casesCaption")}
            columns={caseColumns}
            rows={cases.query.data?.data}
            getRowId={(c) => c.id}
            loading={cases.query.isPending}
            fetching={cases.query.isFetching && !cases.query.isPending}
            error={cases.query.error}
            onRetry={() => void cases.query.refetch()}
            empty={<EmptyState title={t("noCases")} />}
            pagination={cases.query.data ? { meta: cases.query.data.meta, onPageChange: cases.setPage } : undefined}
            minWidth={460}
          />
        </Card>
      )}
      {customer.links.ratings && (
        <Card title={t("ratingsTitle")} actions={<ButtonLink variant="outline" size="sm" href={`/admin/quality/ratings?customer_id=${customer.id}`}>{t("allRatings")}</ButtonLink>}>
          <DataTable
            caption={t("ratingsCaption")}
            columns={ratingColumns}
            rows={ratings.query.data?.data}
            getRowId={(r) => r.id}
            loading={ratings.query.isPending}
            fetching={ratings.query.isFetching && !ratings.query.isPending}
            error={ratings.query.error}
            onRetry={() => void ratings.query.refetch()}
            empty={<EmptyState title={t("noRatings")} />}
            pagination={ratings.query.data ? { meta: ratings.query.data.meta, onPageChange: ratings.setPage } : undefined}
            minWidth={460}
          />
        </Card>
      )}
    </div>
  );
}

/**
 * Her privacy requests (the last five, from the profile), and what staff can do for her on a call: file a data copy or a
 * deletion, or record that she wants no more marketing. A deleted account has nothing to file.
 */
export function CustomerPrivacyPanel({
  customer,
  onCreate,
  onOptOut,
}: {
  customer: CustomerDetail;
  onCreate: () => void;
  onOptOut: () => void;
}) {
  const t = useTranslations("admin.customers.privacy");
  const text = useCustomerText();
  const { can } = useAdminSession();
  const queueLink = customer.links.privacy_requests && can("customers.privacy_requests");
  return (
    <Card
      title={t("title")}
      actions={
        <span className="flex flex-wrap items-center gap-2">
          {customer.actions.marketing_opt_out && (
            <Button size="sm" variant="outline" onClick={onOptOut}>
              {t("optOut")}
            </Button>
          )}
          {customer.actions.privacy_request && (
            <Button size="sm" onClick={onCreate}>
              {t("create")}
            </Button>
          )}
        </span>
      }
    >
      {customer.privacy_requests.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {customer.privacy_requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <span className="flex flex-col">
                <span className="font-bold text-ink-900">{text.privacyType(r.type)}</span>
                <span className="text-xs text-ink-600">
                  {text.dateTime(r.created_at)}
                  {r.scheduled_for && r.status === "scheduled" ? ` · ${t("runsOn", { at: text.dateTime(r.scheduled_for) })}` : ""}
                  {r.completed_at ? ` · ${t("completedOn", { at: text.dateTime(r.completed_at) })}` : ""}
                </span>
              </span>
              <StatusBadge tone={privacyToneOf(r.status)}>{text.privacyStatus(r.status, r.status_label)}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
      {queueLink && (
        <div>
          <ButtonLink size="sm" variant="ghost" href={`${PRIVACY_QUEUE_PATH}?q=${customer.id}&status=all`}>
            {t("openQueue")}
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}
