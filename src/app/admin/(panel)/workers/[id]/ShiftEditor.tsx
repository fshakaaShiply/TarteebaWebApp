"use client";

import clsx from "clsx";
import { CopyCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Select, StatusBadge, Switch } from "@/components/admin";
import { WEEK_ORDER, applyShiftToWorkingDays, type ShiftDraft, type ShiftError } from "@/lib/admin/ops/workforce";
import { TimeSelect } from "../../_ops/OpsFields";
import { useOpsErrorKey, useOpsText } from "../../_ops/opsText";

/**
 * The weekly shift pattern (A05 schedule): seven rows, Monday first, each a working day with start and end times in
 * 15-minute steps (24:00 may end a shift) or a day off. The weekly rest day is chosen above the rows and highlighted;
 * it must be a day off (SHIFT_ON_REST_DAY). `readOnly` shows the same week without controls.
 */
export function ShiftEditor({
  draft,
  restDay,
  onChange,
  onRestDayChange,
  errors,
  serverErrors,
  readOnly,
}: {
  draft: ShiftDraft;
  restDay: number;
  onChange?: (draft: ShiftDraft) => void;
  onRestDayChange?: (day: number) => void;
  errors?: Partial<Record<number, ShiftError>>;
  /** API field messages per weekday (VALIDATION_FAILED on shifts.N.*). */
  serverErrors?: Partial<Record<number, string>>;
  readOnly?: boolean;
}) {
  const t = useTranslations("admin.workers.schedule");
  const text = useOpsText();
  const errorText = useOpsErrorKey();
  const setDay = (day: number, patch: Partial<ShiftDraft[number]>) => onChange?.({ ...draft, [day]: { ...draft[day], ...patch } });

  return (
    <div className="flex flex-col gap-3">
      {readOnly ? (
        <p className="text-sm text-ink-900">
          <span className="font-medium">{t("restDay")}:</span> {text.weekday(restDay)}
        </p>
      ) : (
        <Select
          label={t("restDay")}
          value={String(restDay)}
          onChange={(e) => onRestDayChange?.(Number(e.target.value))}
          options={WEEK_ORDER.map((d) => ({ value: String(d), label: text.weekday(d) }))}
          hint={t("restDayHint")}
          containerClassName="max-w-xs"
        />
      )}
      <ul className="flex flex-col" aria-label={t("weekLabel")}>
        {WEEK_ORDER.map((day) => {
          const row = draft[day];
          const name = text.weekday(day);
          const isRest = day === restDay;
          const error = errors?.[day] ? errorText(errors[day]) : serverErrors?.[day];
          return (
            <li
              key={day}
              className={clsx(
                "grid grid-cols-1 items-end gap-x-3 gap-y-2 rounded-sm border-t border-line px-2 py-3 first:border-t-0 sm:grid-cols-[minmax(130px,1fr)_auto_minmax(110px,1fr)_minmax(110px,1fr)_auto]",
                isRest && "bg-apricot-100/60",
                error && "bg-danger-50/60",
              )}
            >
              <span className="flex flex-wrap items-center gap-2 self-center">
                <span className="text-sm font-bold text-ink-900">{name}</span>
                {isRest && <StatusBadge tone="pending">{t("restDayBadge")}</StatusBadge>}
              </span>
              {readOnly ? (
                <span className="self-center text-sm text-ink-600 sm:col-span-4">
                  {row.working ? (
                    <bdi dir="ltr" className="font-latin text-ink-900">
                      {row.start}–{row.end}
                    </bdi>
                  ) : (
                    t("dayOff")
                  )}
                </span>
              ) : (
                <>
                  <Switch
                    label={<span className="sr-only">{t("worksLabel", { day: name })}</span>}
                    checked={row.working}
                    onCheckedChange={(working) => setDay(day, { working })}
                    stateLabel={row.working ? t("works") : t("off")}
                    className="self-center"
                  />
                  {row.working ? (
                    <>
                      <TimeSelect
                        kind="start"
                        label={
                          <>
                            {t("start")}
                            {" "}
                            <span className="sr-only">({name})</span>
                          </>
                        }
                        value={row.start}
                        onChange={(e) => setDay(day, { start: e.target.value })}
                        aria-invalid={error ? true : undefined}
                      />
                      <TimeSelect
                        kind="end"
                        label={
                          <>
                            {t("end")}
                            {" "}
                            <span className="sr-only">({name})</span>
                          </>
                        }
                        value={row.end}
                        onChange={(e) => setDay(day, { end: e.target.value })}
                        aria-invalid={error ? true : undefined}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-center"
                        onClick={() => onChange?.(applyShiftToWorkingDays(draft, day))}
                        icon={<CopyCheck aria-hidden className="size-4" />}
                        aria-label={t("copyLabel", { day: name })}
                      >
                        {t("copy")}
                      </Button>
                    </>
                  ) : (
                    <span className="self-center text-sm text-ink-600 sm:col-span-3">{isRest ? t("restDayOff") : t("dayOff")}</span>
                  )}
                </>
              )}
              {error && (
                <p role="alert" className="text-xs font-medium text-danger-700 sm:col-span-5">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
