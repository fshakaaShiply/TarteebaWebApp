"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Eye, X } from "lucide-react";
import { createTranslator, useTranslations, type AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";
import { Card, IconButton, LoadingBlock, Notice, StatusBadge } from "@/components/admin";
import { formatAed } from "@/lib/money";
import type { CatalogPreview, PublicService } from "@/lib/admin/types";

/*
 * A11 "preview before publish" (spec §17): the public payload the API built from the unsaved values, side by side in
 * Arabic and English, laid out like the customer screens (Home, Service details, Recurring, Full day). The labels of
 * each column are in that column's language, so the copy for both languages is loaded on demand.
 */

type Lang = "ar" | "en";
type Translator = (key: string, values?: Record<string, string | number>) => string;

function useCustomerCopy() {
  return useQuery({
    queryKey: ["admin", "catalog", "customer-copy"],
    queryFn: async () => {
      const [ar, en] = await Promise.all([import("@/messages/ar.json"), import("@/messages/en.json")]);
      const make = (locale: Lang, messages: unknown): Translator =>
        createTranslator({
          locale,
          messages: messages as AbstractIntlMessages,
          namespace: "admin.catalog.customer",
        }) as unknown as Translator;
      return { ar: make("ar", ar.default), en: make("en", en.default) };
    },
    staleTime: Infinity,
  });
}

export function PreviewPanel({
  preview,
  outdated,
  onClose,
  title,
  intro,
}: {
  preview: CatalogPreview;
  /** The form changed after this preview was made. */
  outdated?: boolean;
  onClose?: () => void;
  title?: ReactNode;
  /** Replaces the default "after you save" explanation (e.g. for a delete). */
  intro?: ReactNode;
}) {
  const t = useTranslations("admin.catalog.preview");
  const copy = useCustomerCopy();

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Eye aria-hidden className="size-5 text-petrol-700" strokeWidth={1.75} />
          {title ?? t("title")}
        </span>
      }
      actions={
        onClose && (
          <IconButton label={t("close")} onClick={onClose}>
            <X aria-hidden className="size-5" />
          </IconButton>
        )
      }
      className="border border-petrol-50"
    >
      <Notice tone={outdated ? "warning" : "info"}>{outdated ? t("outdated") : (intro ?? t("intro"))}</Notice>
      {copy.isPending ? (
        <LoadingBlock lines={6} />
      ) : copy.isError ? (
        <Notice tone="danger">{t("copyFailed")}</Notice>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <PreviewColumn lang="ar" label={t("arabic")} service={preview.payload.ar} examples={preview.price_examples} tr={copy.data.ar} />
          <PreviewColumn lang="en" label={t("english")} service={preview.payload.en} examples={preview.price_examples} tr={copy.data.en} />
        </div>
      )}
    </Card>
  );
}

function PreviewColumn({
  lang,
  label,
  service,
  examples,
  tr,
}: {
  lang: Lang;
  label: string;
  service: PublicService;
  examples: CatalogPreview["price_examples"];
  tr: Translator;
}) {
  const money = (fils: number) => formatAed(fils, lang);
  const hours = Math.floor(service.duration_minutes / 60);
  const minutes = service.duration_minutes % 60;
  const duration = hours && minutes ? tr("durationHm", { h: hours, m: minutes }) : hours ? tr("durationH", { h: hours }) : tr("durationM", { m: minutes });

  return (
    <section
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      aria-label={label}
      className={clsx("flex flex-col gap-4 rounded-md bg-ivory-50 p-4", lang === "ar" ? "font-arabic" : "font-latin")}
    >
      <p className="text-xs font-bold tracking-wide text-ink-600 uppercase">{label}</p>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg/7 font-bold text-ink-900">{service.name}</h3>
        {service.price_from_fils !== null && service.price_unit ? (
          <p className="text-sm font-medium text-petrol-700">
            {tr("priceFrom", { price: money(service.price_from_fils), unit: tr(`unit.${service.price_unit}`) })}{" "}
            <span className="font-normal text-ink-600">· {tr("vatIncluded")}</span>
          </p>
        ) : (
          <p className="text-sm text-ink-600">{tr("noPrice")}</p>
        )}
        {service.description && <p className="text-sm/6 text-ink-900">{service.description}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-sm bg-surface p-3 text-sm">
        <dt className="text-ink-600">{tr("durationLabel")}</dt>
        <dd className="font-medium text-ink-900">{duration}</dd>
        <dt className="text-ink-600">{tr("workersLabel")}</dt>
        <dd className="font-medium text-ink-900">
          {service.min_workers === service.max_workers
            ? tr("workersCount", { count: service.min_workers })
            : tr("workersRange", { min: service.min_workers, max: service.max_workers })}
        </dd>
        <dt className="text-ink-600">{tr("materialsLabel")}</dt>
        <dd className="font-medium text-ink-900">{tr(`materials.${service.materials_mode}`)}</dd>
      </dl>

      {(service.includes.length > 0 || service.excludes.length > 0) && (
        <div className="grid gap-3">
          {service.includes.length > 0 && <ItemList title={tr("includes")} items={service.includes} tone="in" />}
          {service.excludes.length > 0 && <ItemList title={tr("excludes")} items={service.excludes} tone="out" />}
        </div>
      )}

      {examples.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-bold text-ink-900">{tr("examplesTitle")}</h4>
          <ul className="flex flex-col gap-1 text-sm text-ink-900">
            {examples.map((e) => (
              <li key={e.workers}>
                {tr("example", { workers: e.workers, gross: money(e.gross_fils), net: money(e.net_fils), vat: money(e.vat_fils) })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {service.packages.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-bold text-ink-900">{tr("packagesTitle")}</h4>
          <ul className="flex flex-col gap-2">
            {service.packages.map((p) => (
              <li key={p.code} className="flex flex-col gap-0.5 rounded-sm bg-surface p-3 text-sm">
                <span className="font-bold text-ink-900">{p.name}</span>
                <span className="text-ink-600">
                  {tr("visitsPerWeek", { count: p.visits_per_week })} ·{" "}
                  {p.term_months !== null ? tr("termMonths", { count: p.term_months }) : tr("termWeeks", { count: p.term_weeks ?? 0 })}
                </span>
                <span className="text-petrol-700">
                  {p.discount_value === 0
                    ? tr("noDiscount")
                    : p.discount_type === "percent"
                      ? tr("discountPercent", { value: p.discount_value })
                      : tr("discountFixed", { amount: money(p.discount_value) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {service.live_out_plans.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-bold text-ink-900">{tr("plansTitle")}</h4>
          <ul className="flex flex-col gap-2">
            {service.live_out_plans.map((p) => (
              <li key={p.code} className="flex flex-col gap-1 rounded-sm bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-ink-900">{p.name}</span>
                  {p.price_fils !== undefined ? (
                    <span className="font-medium text-petrol-700">{tr("planPrice", { price: money(p.price_fils) })}</span>
                  ) : null}
                </div>
                {!p.available && <StatusBadge tone="pending" className="self-start">{tr("planUnavailable")}</StatusBadge>}
                <span className="text-ink-600">
                  {tr("planDays", { days: p.service_days_per_month, rest: p.rest_days_per_week })}
                </span>
                <span className="text-ink-600">
                  <bdi dir="ltr" className="font-latin">
                    {p.window_start}–{p.window_end}
                  </bdi>{" "}
                  · {tr("planWindow", { hours: p.work_hours, break: p.break_minutes })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ItemList({ title, items, tone }: { title: string; items: string[]; tone: "in" | "out" }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-bold text-ink-900">{title}</h4>
      <ul className={clsx("list-disc ps-5 text-sm/6", tone === "in" ? "text-ink-900" : "text-ink-600")}>
        {items.map((item, i) => (
          <li key={`${i}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
