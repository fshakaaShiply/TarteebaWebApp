"use client";

import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/admin";
import type { RefusedWorker } from "@/lib/admin/subscriptions/actions";
import { healthToneOf, statusToneOf } from "@/lib/admin/subscriptions/status";
import type { UnfitDay } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import type { Translatable } from "@/lib/admin/types";
import { Ltr } from "./kit";

/** The status chip: the API's label; a paused subscription says "Frozen until {date}" (design §9.1). */
export function StatusChip({ status, label, pausedTo, className }: { status: string; label?: Translatable | null; pausedTo?: string | null; className?: string }) {
  const t = useTranslations("admin.subscriptions");
  const text = useSubscriptionText();
  const content = status === "paused" && pausedTo ? t("frozenUntil", { date: text.dateShort(pausedTo) }) : text.label(label, "status", status);
  return (
    <StatusBadge tone={statusToneOf(status)} className={className}>
      {content}
    </StatusBadge>
  );
}

/** Payment health: paid / pending / verifying / renewal failed / suspended / refunded / none. */
export function HealthChip({ health, className }: { health: string; className?: string }) {
  const text = useSubscriptionText();
  return (
    <StatusBadge tone={healthToneOf(health)} className={className}>
      {text.health(health)}
    </StatusBadge>
  );
}

/** The days a worker cannot cover, each with the reasons the worker check gave. */
export function UnfitList({ days, limit = 8 }: { days: readonly UnfitDay[]; limit?: number }) {
  const t = useTranslations("admin.subscriptions.workers");
  const text = useSubscriptionText();
  if (days.length === 0) return null;
  const shown = days.slice(0, limit);
  return (
    <ul className="flex flex-col gap-0.5 text-sm" aria-label={t("unfitTitle")}>
      {shown.map((d) => (
        <li key={d.date} className="flex flex-wrap gap-x-2">
          <Ltr>{text.dateShort(d.date)}</Ltr>
          <span className="text-warning-700">{d.reasons.length > 0 ? d.reasons.map((r) => text.unfit(r)).join(text.locale === "ar" ? "، " : ", ") : t("unfitUnknown")}</span>
        </li>
      ))}
      {days.length > limit && <li className="text-ink-600">{t("unfitMore", { count: days.length - limit })}</li>}
    </ul>
  );
}

/**
 * 422 WORKER_NOT_ASSIGNABLE: each refused worker by her role and name, as the API names them (P4-242: primary, backup
 * or a Live-out day's substitute), and why; "worker no. {id}" only when the API has no name for her.
 */
export function RefusedWorkers({ workers }: { workers: readonly RefusedWorker[] }) {
  const t = useTranslations("admin.subscriptions.refused");
  const text = useSubscriptionText();
  if (workers.length === 0) return null;
  return (
    <ul className="list-disc ps-5 text-sm text-danger-700" aria-label={t("title")}>
      {workers.map((w) => {
        const name = w.name ?? t("workerNo", { id: w.workerId });
        const who = w.role ? t("line", { role: t(`roles.${w.role}`), name }) : name;
        const reasons = [...new Set([w.reason, ...w.reasons].filter(Boolean))].map((r) => text.unfit(r));
        return <li key={`${w.role ?? "worker"}-${w.workerId}`}>{reasons.length > 0 ? `${who} · ${text.list(reasons)}` : who}</li>;
      })}
    </ul>
  );
}

/** A row of dates (the dates a change credits or adds), in order. */
export function DateList({ dates, limit = 12 }: { dates: readonly string[]; limit?: number }) {
  const t = useTranslations("admin.subscriptions.dialogs");
  const text = useSubscriptionText();
  const shown = dates.slice(0, limit);
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {shown.map((d) => (
        <Ltr key={d}>{text.dateShort(d)}</Ltr>
      ))}
      {dates.length > limit && <span className="text-ink-600">{t("moreDates", { count: dates.length - limit })}</span>}
    </span>
  );
}
