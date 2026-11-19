"use client";

import { useTranslations } from "next-intl";
import { useNow } from "@/lib/admin/hooks";
import { slaChip, slaKindOf, type SlaUnit } from "@/lib/admin/quality/sla";
import type { CaseSla } from "@/lib/admin/quality/types";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/**
 * The deadline of a case (A10): "3 h left", "2 h overdue" in the danger tone, "paused" while the case waits for the
 * customer, "—" when nothing is due. The distance counts down with the page's own clock (`useNow(30_000)`), so a list
 * left open stays right between two reads. The visible text is short; the accessible name spells the unit out, and the
 * tooltip says which deadline it is (the first reply or the resolution).
 */
export function SlaChip({ sla, className }: { sla: CaseSla; className?: string }) {
  const t = useTranslations("admin.quality.sla");
  const now = useNow(30_000);
  const model = slaChip(sla, now);
  const kind = slaKindOf(sla);
  const title = kind ? t(`kind.${kind}`) : undefined;

  if (model.kind === "none") {
    return (
      <span className="text-ink-600" title={title}>
        <span aria-hidden>—</span>
        <span className="sr-only">{t("none")}</span>
      </span>
    );
  }
  const tone: StatusTone = model.kind === "overdue" ? "danger" : model.kind === "paused" ? "neutral" : model.due ? "pending" : "neutral";
  let text: string;
  let full: string;
  if (model.kind === "paused") {
    text = full = t("paused");
  } else if (model.kind === "overdue") {
    text = model.unit ? t(`overdue.${model.unit}`, { count: model.value }) : t("overdue.plain");
    full = model.unit ? t(`overdueFull.${model.unit}`, { count: model.value }) : t("overdue.plain");
  } else {
    text = t(`left.${model.unit}`, { count: model.value });
    full = t(`leftFull.${model.unit}`, { count: model.value });
  }
  return (
    <span title={title} className={className}>
      <StatusBadge tone={tone}>
        <span aria-hidden>{text}</span>
        <span className="sr-only">{full}</span>
      </StatusBadge>
    </span>
  );
}

export const SLA_UNITS: readonly SlaUnit[] = ["minutes", "hours", "days"];
