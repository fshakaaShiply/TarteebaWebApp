"use client";

import { useLocale, useTranslations } from "next-intl";
import { LtrText, StatusBadge, type Column } from "@/components/admin";
import type { CatalogPackage, LiveOutPlan, Translatable } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";
import { ActiveBadge } from "./CatalogFields";
import { useCatalogText } from "./catalogText";

function NameCell({ name, code }: { name: string; code: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-bold text-ink-900">{name}</span>
      <LtrText className="text-xs text-ink-600">{code}</LtrText>
    </div>
  );
}

/** Table columns shared by the Packages / Live-out pages and the service page tabs. */
export function useOfferColumns() {
  const p = useTranslations("admin.catalog.packages");
  const l = useTranslations("admin.catalog.liveOut");
  const locale = useLocale();
  const text = useCatalogText();
  const name = (value: Translatable) => text.name(value);

  const packageColumns: Column<CatalogPackage>[] = [
    { id: "name", header: p("columns.package"), cell: (pkg) => <NameCell name={name(pkg.name)} code={pkg.code} /> },
    { id: "visits", header: p("columns.visits"), cell: (pkg) => p("visitsOption", { count: pkg.visits_per_week }) },
    {
      id: "term",
      header: p("columns.term"),
      cell: (pkg) =>
        pkg.term_months !== null ? p("termMonthsValue", { count: pkg.term_months }) : p("termWeeksValue", { count: pkg.term_weeks ?? 0 }),
    },
    {
      id: "discount",
      header: p("columns.discount"),
      cell: (pkg) =>
        pkg.discount_value === 0
          ? p("noDiscount")
          : pkg.discount_type === "percent"
            ? p("percentValue", { value: pkg.discount_value })
            : p("fixedValue", { amount: formatAed(pkg.discount_value, locale) }),
    },
    { id: "status", header: p("columns.status"), cell: (pkg) => <ActiveBadge active={pkg.is_active} /> },
  ];

  const planColumns: Column<LiveOutPlan>[] = [
    { id: "name", header: l("columns.plan"), cell: (plan) => <NameCell name={name(plan.name)} code={plan.code} /> },
    { id: "kind", header: l("columns.kind"), cell: (plan) => text.planKind(plan.kind) },
    {
      id: "price",
      header: l("columns.price"),
      cell: (plan) =>
        plan.price_fils === null ? (
          <span className="text-ink-600">{l("noPrice")}</span>
        ) : (
          <div className="flex flex-col">
            <span className="font-medium text-ink-900">{formatAed(plan.price_fils, locale)}</span>
            <span className="text-xs text-ink-600">{plan.vat_inclusive ? l("vatIncl") : l("vatExcl")}</span>
          </div>
        ),
    },
    {
      id: "days",
      header: l("columns.days"),
      cell: (plan) => l("daysValue", { days: plan.service_days_per_month, rest: plan.rest_days_per_week }),
    },
    {
      id: "window",
      header: l("columns.window"),
      cell: (plan) => (
        <bdi dir="ltr" className="font-latin">
          {plan.window_start}–{plan.window_end}
        </bdi>
      ),
    },
    {
      id: "status",
      header: l("columns.status"),
      cell: (plan) => (
        <div className="flex flex-wrap gap-1.5">
          {/* D-03: a plan without a price is hidden from customers until priced. */}
          <ActiveBadge active={plan.is_active} />
          {plan.price_fils === null && <StatusBadge tone="pending">{l("hiddenUntilPriced")}</StatusBadge>}
        </div>
      ),
    },
  ];

  return { packageColumns, planColumns, name };
}
