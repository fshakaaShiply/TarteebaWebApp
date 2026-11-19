"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Notice } from "@/components/admin";
import { SUBSCRIPTIONS_READ } from "@/lib/admin/nav";
import { useCustomerText } from "@/lib/admin/customers/text";
import type { DeletionBlocker, DeletionImpact, DeletionImpactItem } from "@/lib/admin/customers/types";
import { useAdminSession } from "@/lib/admin/session";
import type { Translatable } from "@/lib/admin/types";
import { Ltr } from "../../bookings/_components/BookingBits";

/** The staff print's text: bilingual in the staff print, one string elsewhere. */
export function useApiText() {
  const text = useCustomerText();
  return (value: Translatable | string | null | undefined): string => (typeof value === "string" ? value : value ? text.name(value) : "");
}

/** A booking or subscription reference, linked to its page when the id is the API's numeric one and the staff may open it. */
function Reference({ type, id, reference }: { type: string; id: number | string | null; reference: string | null }) {
  const { can, canAny } = useAdminSession();
  if (!reference) return null;
  const numeric = typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id));
  const href =
    numeric && type === "booking" && can("bookings.view")
      ? `/admin/bookings/${id}`
      : numeric && type === "subscription" && canAny(SUBSCRIPTIONS_READ)
        ? `/admin/subscriptions/${id}`
        : null;
  return href ? (
    <Link href={href} className="font-medium underline">
      <Ltr>{reference}</Ltr>
    </Link>
  ) : (
    <Ltr>{reference}</Ltr>
  );
}

/**
 * What stops a deletion (A4b §3, 409 DELETION_BLOCKED and the staff print's `blocking`): each item with its reference
 * linked to its page and the API's own words for the reason. Staff cancel open bookings and subscriptions first, in A03
 * and A08, where each one's policy preview is shown (P5-C24).
 */
export function DeletionBlockedList({ items }: { items: readonly DeletionBlocker[] }) {
  const t = useTranslations("admin.privacy.create");
  const words = useApiText();
  if (items.length === 0) return null;
  return (
    <Notice tone="warning" title={t("blockedTitle")}>
      <span className="flex flex-col gap-1">
        <span>{t("blockedBody")}</span>
        <ul className="flex flex-col gap-1">
          {items.map((item, i) => (
            <li key={`${item.code}-${item.id ?? i}`} className="flex flex-wrap gap-x-2">
              <Reference type={item.type} id={item.id} reference={item.reference} />
              <span>{words(item.message) || t(`blocking.${item.code}`)}</span>
            </li>
          ))}
        </ul>
      </span>
    </Notice>
  );
}

function OpenList({ title, type, items }: { title: string; type: "booking" | "subscription"; items: readonly DeletionImpactItem[] }) {
  const words = useApiText();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-ink-600">{title}</p>
      <ul className="flex flex-col gap-0.5 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap gap-x-2">
            <Reference type={type} id={item.id} reference={item.reference} />
            {item.status_label && <span className="text-ink-600">{words(item.status_label)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The open items a deletion is refused for, then what blocks it beyond them. */
export function DeletionImpactView({ impact }: { impact: DeletionImpact }) {
  const t = useTranslations("admin.privacy.create");
  const open = impact.bookings.length + impact.subscriptions.length;
  // Open bookings and subscriptions are also in `blocking` (open_booking / open_subscription): list each once.
  const rest = impact.blocking.filter((b) => b.code !== "open_booking" && b.code !== "open_subscription");
  return (
    <div className="flex flex-col gap-3">
      {open > 0 && (
        <Notice tone="warning" title={t("openTitle")}>
          <span className="flex flex-col gap-2">
            <span>{t("openBody")}</span>
            <OpenList title={t("openBookings")} type="booking" items={impact.bookings} />
            <OpenList title={t("openSubscriptions")} type="subscription" items={impact.subscriptions} />
          </span>
        </Notice>
      )}
      <DeletionBlockedList items={rest} />
    </div>
  );
}
