"use client";

import { useTranslations } from "next-intl";
import { Notice } from "@/components/admin";
import { useCustomerText } from "@/lib/admin/customers/text";
import type { CustomerDetail } from "@/lib/admin/customers/types";

/**
 * What a dialog says after the API answered that the customer is not the version it showed (409 STALE_VERSION): nothing was
 * saved, the profile was read again, and the person confirms once more. A status region, so a screen reader hears it
 * without losing its place.
 */
export function MovedNotice({ waiting, renewed }: { waiting: boolean; renewed: boolean }) {
  const t = useTranslations("admin.customers.moved");
  if (!waiting && !renewed) return null;
  return (
    <Notice tone="warning" title={t("title")} role="status">
      {waiting ? t("waiting") : t("renewed")}
    </Notice>
  );
}

/** The profile's block banner: the reason staff gave, who blocked and when (never shown for a deleted account). */
export function BlockedBanner({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.banners");
  const text = useCustomerText();
  if (customer.status !== "blocked") return null;
  const by = customer.blocked?.by?.name;
  return (
    <Notice tone="danger" title={t("blockedTitle")}>
      <span className="flex flex-col gap-0.5">
        {customer.blocked?.reason && <span>{t("blockedReason", { reason: customer.blocked.reason })}</span>}
        {(by || customer.blocked?.at) && (
          <span className="text-xs">{by ? t("blockedBy", { name: by, at: text.dateTime(customer.blocked?.at) }) : t("blockedAt", { at: text.dateTime(customer.blocked?.at) })}</span>
        )}
        <span className="text-xs">{t("blockedEffects")}</span>
      </span>
    </Notice>
  );
}

/** A deletion waiting out its cooling-off: the day it runs and what it waits on (the holds the API found at the last check). */
export function DeletionBanner({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.banners");
  const text = useCustomerText();
  if (customer.status !== "pending_deletion" || !customer.deletion) return null;
  const waiting = customer.deletion.waiting_on.map((code) => text.waitingOn(code));
  return (
    <Notice tone="warning" title={t("deletionTitle")}>
      <span className="flex flex-col gap-0.5">
        <span>{customer.deletion.scheduled_for ? t("deletionOn", { date: text.dateTime(customer.deletion.scheduled_for) }) : t("deletionScheduled")}</span>
        {waiting.length > 0 && <span className="text-xs">{t("deletionWaiting", { holds: text.list(waiting) })}</span>}
      </span>
    </Notice>
  );
}

/** A deleted account is read-only and holds no personal data. */
export function DeletedBanner({ customer }: { customer: CustomerDetail }) {
  const t = useTranslations("admin.customers.banners");
  if (customer.status !== "deleted") return null;
  return (
    <Notice tone="neutral" title={t("deletedTitle")}>
      {t("deletedBody")}
    </Notice>
  );
}
