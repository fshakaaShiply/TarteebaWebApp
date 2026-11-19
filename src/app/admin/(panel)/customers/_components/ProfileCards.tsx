"use client";

import { useTranslations } from "next-intl";
import { Button, Card, EmptyState, StarRating, StatusBadge } from "@/components/admin";
import { useCustomerText } from "@/lib/admin/customers/text";
import { customerToneOf } from "@/lib/admin/customers/status";
import type { CustomerAddress, CustomerDetail } from "@/lib/admin/customers/types";
import { Fact, Facts } from "../../finance/_components/FinanceParts";
import { Ltr } from "../../bookings/_components/BookingBits";

/**
 * The profile card of the design (AdminCustomers.dc.html): customer since, bookings and cancelled ones, everything she
 * paid, the average of the ratings she gave, her preferred cleaners, marketing and status. Every figure comes from the API
 * (the web counts nothing); a figure the API has no answer for yet is "—".
 */
export function CustomerProfileCard({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.profile");
  const text = useCustomerText();
  const s = customer.stats;
  const gone = customer.status === "deleted";
  return (
    <Card title={t("title")}>
      <Facts>
        <Fact label={t("since")}>{text.instantDate(customer.created_at) || "—"}</Fact>
        <Fact label={t("status")}>
          <StatusBadge tone={customerToneOf(customer.status)}>{text.status(customer.status, customer.status_label)}</StatusBadge>
        </Fact>
        <Fact label={t("bookings")}>{t("bookingsValue", { total: s.bookings_total, cancelled: s.bookings_cancelled })}</Fact>
        <Fact label={t("open")}>{t("openValue", { bookings: s.bookings_open, subscriptions: s.subscriptions_open })}</Fact>
        <Fact label={t("paid")}>
          <span className="font-latin">{text.money(s.paid_total_fils)}</span>
        </Fact>
        <Fact label={t("rating")}>
          {s.avg_rating_given ? (
            <StarRating value={s.avg_rating_given.average} size="sm" showValue count={s.avg_rating_given.count} />
          ) : (
            "—"
          )}
        </Fact>
        <Fact label={t("preferred")}>
          {customer.preferred_workers.length > 0
            ? text.list(customer.preferred_workers.map((w) => `${w.display_name} (${w.times})`))
            : "—"}
        </Fact>
        <Fact label={t("marketing")}>{gone ? "—" : customer.consents.marketing.accepted ? t("marketingYes") : t("marketingNo")}</Fact>
        <Fact label={t("lastBooking")}>{s.last_booking_on ? text.date(s.last_booking_on) : "—"}</Fact>
        <Fact label={t("lastLogin")}>{customer.last_login_at ? text.dateTime(customer.last_login_at) : "—"}</Fact>
        {s.complaints_open !== null && <Fact label={t("complaints")}>{s.complaints_open}</Fact>}
        {!gone && (
          <Fact label={t("language")}>
            <Ltr>{customer.locale}</Ltr>
          </Fact>
        )}
      </Facts>
    </Card>
  );
}

/** The saved addresses with their block state; the block buttons need `actions.block_address` (refused once erasure began). */
export function CustomerAddresses({
  customer,
  onBlock,
}: {
  customer: CustomerDetail;
  onBlock: (address: CustomerAddress, mode: "block" | "unblock") => void;
}) {
  const t = useTranslations("admin.customers.addresses");
  const text = useCustomerText();
  return (
    <Card title={t("title")}>
      {customer.addresses.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {customer.addresses.map((a) => {
            const place = [a.building, a.unit_number, a.street, a.area_text].filter(Boolean).join(", ");
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-ink-900">{a.label}</span>
                    {a.is_default && <StatusBadge tone="confirmed">{t("default")}</StatusBadge>}
                    {a.is_blocked && <StatusBadge tone="danger">{t("blocked")}</StatusBadge>}
                    {a.deleted && <StatusBadge tone="neutral">{t("deleted")}</StatusBadge>}
                  </span>
                  <span className="text-sm text-ink-900">{place || "—"}</span>
                  <span className="text-xs text-ink-600">
                    {t.has(`property.${a.property_type}`) ? t(`property.${a.property_type}`) : a.property_type}
                    {a.zone ? ` · ${text.name(a.zone.name)}` : ""}
                  </span>
                  {a.is_blocked && (
                    <span className="text-xs text-danger-700">
                      {a.blocked_reason ? t("blockedReason", { reason: a.blocked_reason }) : t("blockedNoReason")}
                      {a.blocked_at ? ` · ${text.dateTime(a.blocked_at)}` : ""}
                    </span>
                  )}
                </div>
                {customer.actions.block_address && (
                  <Button size="sm" variant="outline" onClick={() => onBlock(a, a.is_blocked ? "unblock" : "block")} aria-label={t(a.is_blocked ? "unblockLabel" : "blockLabel", { label: a.label })}>
                    {t(a.is_blocked ? "unblock" : "block")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** What she agreed to: the marketing and analytics switches, the legal versions she accepted against the current ones, and her cards. */
export function CustomerConsents({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.consents");
  const text = useCustomerText();
  const c = customer.consents;
  const version = (v: CustomerDetail["consents"]["terms"]) => (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-latin">{v.accepted_version ?? t("none")}</span>
      <StatusBadge tone={v.up_to_date ? "success" : "pending"}>{v.up_to_date ? t("upToDate") : t("current", { version: v.current_version })}</StatusBadge>
    </span>
  );
  const sw = (accepted: boolean, at: string | null) => (
    <span className="flex flex-col">
      <span>{accepted ? t("yes") : t("no")}</span>
      {at && <span className="text-xs text-ink-600">{t("since", { at: text.dateTime(at) })}</span>}
    </span>
  );
  return (
    <Card title={t("title")}>
      <Facts>
        <Fact label={t("marketing")}>{sw(c.marketing.accepted, c.marketing.updated_at)}</Fact>
        <Fact label={t("analytics")}>{sw(c.analytics.accepted, c.analytics.updated_at)}</Fact>
        <Fact label={t("terms")}>{version(c.terms)}</Fact>
        <Fact label={t("privacy")}>{version(c.privacy)}</Fact>
        <Fact label={t("cards")}>{c.card_on_file_count}</Fact>
        <Fact label={t("email")}>
          {customer.email ? (
            <span className="flex flex-col">
              <Ltr>{customer.email}</Ltr>
              <span className="text-xs text-ink-600">{customer.email_verified ? t("emailVerified") : t("emailUnverified")}</span>
            </span>
          ) : (
            "—"
          )}
        </Fact>
      </Facts>
    </Card>
  );
}
