"use client";

import clsx from "clsx";
import { CalendarPlus, CopyCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Switch, TextField } from "@/components/admin";
import { addDate } from "@/lib/admin/settings";
import { WEEK_ORDER, applyToAllDays, type WeeklyHoursDraft, type WeeklyHoursError } from "@/lib/admin/ops/weeklyHours";
import { TimeSelect } from "../_ops/OpsFields";
import { useOpsText } from "../_ops/opsText";

/**
 * booking.working_hours (R-13): one row per weekday, Monday first; each day open or closed, with opening and closing
 * times in 15-minute steps (closing may be 24:00). "Apply to all days" copies a row to the whole week.
 */
export function WeeklyHoursEditor({
  draft,
  onChange,
  errors,
}: {
  draft: WeeklyHoursDraft;
  onChange: (draft: WeeklyHoursDraft) => void;
  /** Problems per weekday, shown after a save attempt. */
  errors: Partial<Record<number, WeeklyHoursError>>;
}) {
  const t = useTranslations("admin.settings.weeklyHours");
  const errorsT = useTranslations("admin.settings.errors");
  const text = useOpsText();
  const legendId = useId();

  const setDay = (day: number, patch: Partial<WeeklyHoursDraft[number]>) => onChange({ ...draft, [day]: { ...draft[day], ...patch } });

  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-2">
      <legend id={legendId} className="mb-1 text-sm font-medium text-ink-900">
        {t("legend")}
      </legend>
      <p className="text-xs text-ink-600">{t("hint")}</p>
      <ul className="flex flex-col">
        {WEEK_ORDER.map((day) => {
          const row = draft[day];
          const error = errors[day];
          const name = text.weekday(day);
          return (
            <li
              key={day}
              className={clsx(
                "grid grid-cols-1 items-end gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 sm:grid-cols-[minmax(110px,1fr)_auto_minmax(110px,1fr)_minmax(110px,1fr)_auto]",
                error && "rounded-sm bg-danger-50/60 px-2",
              )}
            >
              <span className="self-center text-sm font-bold text-ink-900">{name}</span>
              <Switch
                label={<span className="sr-only">{t("openLabel", { day: name })}</span>}
                checked={row.open}
                onCheckedChange={(open) => setDay(day, { open })}
                stateLabel={row.open ? t("open") : t("closed")}
                className="self-center"
              />
              {row.open ? (
                <>
                  <TimeSelect
                    kind="start"
                    label={
                      <>
                        {t("from")}
                        {" "}
                        <span className="sr-only">({name})</span>
                      </>
                    }
                    value={row.from}
                    onChange={(e) => setDay(day, { from: e.target.value })}
                    aria-invalid={error ? true : undefined}
                  />
                  <TimeSelect
                    kind="end"
                    label={
                      <>
                        {t("to")}
                        {" "}
                        <span className="sr-only">({name})</span>
                      </>
                    }
                    value={row.to}
                    onChange={(e) => setDay(day, { to: e.target.value })}
                    aria-invalid={error ? true : undefined}
                  />
                </>
              ) : (
                <span className="self-center text-sm text-ink-600 sm:col-span-2">{t("closedDay")}</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="self-center"
                onClick={() => onChange(applyToAllDays(draft, day))}
                icon={<CopyCheck aria-hidden className="size-4" />}
                aria-label={t("applyToAllLabel", { day: name })}
              >
                {t("applyToAll")}
              </Button>
              {error && (
                <p role="alert" className="text-xs font-medium text-danger-700 sm:col-span-5">
                  {errorsT(error)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** calendar.public_holidays: dates picked one at a time, kept sorted without duplicates. */
export function HolidaysEditor({ dates, onChange, error }: { dates: string[]; onChange: (dates: string[]) => void; error: string | null }) {
  const t = useTranslations("admin.settings.holidays");
  const errorsT = useTranslations("admin.settings.errors");
  const text = useOpsText();
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const add = () => {
    const result = addDate(dates, draft);
    if (!result.ok) {
      setAddError(errorsT(result.error));
      return;
    }
    onChange(result.dates);
    setDraft("");
    setAddError(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          type="date"
          label={t("add")}
          value={draft}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[200px] flex-1"
          onChange={(e) => {
            setDraft(e.target.value);
            setAddError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          hint={t("hint")}
          // Announced as it appears: Enter in the field adds the date without moving focus, so focusing the field
          // would not read the error out.
          error={addError ? <span role="alert">{addError}</span> : undefined}
        />
        <Button variant="outline" onClick={add} disabled={draft === ""} icon={<CalendarPlus aria-hidden className="size-4" />}>
          {t("addButton")}
        </Button>
      </div>
      {dates.length === 0 ? (
        <p className="text-sm text-ink-600">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col" aria-label={t("listLabel")}>
          {dates.map((date) => (
            <li key={date} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
              <span className="flex flex-col">
                <span className="text-sm font-medium text-ink-900">{text.date(date)}</span>
                <bdi dir="ltr" className="font-latin text-xs text-ink-600">
                  {date}
                </bdi>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
                onClick={() => onChange(dates.filter((d) => d !== date))}
                icon={<X aria-hidden className="size-4" />}
                aria-label={t("remove", { date: text.date(date) })}
              >
                {t("removeShort")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs font-medium text-danger-700">{error}</p>}
    </div>
  );
}
