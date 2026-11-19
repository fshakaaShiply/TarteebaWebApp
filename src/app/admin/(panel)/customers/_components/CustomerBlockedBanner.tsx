"use client";

import { useTranslations } from "next-intl";
import { CustomerLink, Notice } from "@/components/admin";
import type { Translatable } from "@/lib/admin/types";

/**
 * «العميل موقوف»: shown on a booking and on a subscription whose customer is blocked (P5-C10). A block stops new business
 * and automatic renewals, but a confirmed visit may still be wanted (or owed), so it stays for staff to decide here; the
 * banner says so and links the profile (CustomerLink: plain text without customers.view). Nothing is shown for any other
 * status, nor when the answer carries none (an older answer).
 */
export function CustomerBlockedBanner({ customer }: { customer: { id: string | number | null; name?: string | null; phone?: string | null; status?: string; status_label?: Translatable } | null | undefined }) {
  const t = useTranslations("admin.customers.blockedBanner");
  if (!customer || customer.status !== "blocked") return null;
  return (
    <Notice tone="warning" title={t("title")}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t("body")}</span>
        <CustomerLink customer={customer} className="font-bold">
          {t("open", { name: customer.name ?? t("unnamed") })}
        </CustomerLink>
      </span>
    </Notice>
  );
}
