"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingBlock,
  PageHeader,
  SearchField,
  StatusBadge,
} from "@/components/admin";
import { formatAed } from "@/lib/money";
import { fetchSettings } from "@/lib/admin/endpoints";
import { formatDateTime } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { summarizeWeeklyHours } from "@/lib/admin/ops/weeklyHours";
import { editorKind, formatTimeRange, groupSettings } from "@/lib/admin/settings";
import type { Setting } from "@/lib/admin/types";
import { RequirePermission } from "../../_components/RequirePermission";
import { useOpsText } from "../_ops/opsText";
import { SettingEditDialog } from "./SettingEditDialog";
import { useSettingText } from "./settingText";

export function SettingsScreen() {
  const t = useTranslations("admin.settings");
  return (
    <RequirePermission anyOf={["settings.manage"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SettingsContent />
    </RequirePermission>
  );
}

function SettingsContent() {
  const t = useTranslations("admin.settings");
  const text = useSettingText();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Setting | null>(null);
  const [stale, setStale] = useState(false);

  const query = useQuery({ queryKey: adminKeys.settings(), queryFn: fetchSettings });

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (query.data ?? []).filter(
      (s) =>
        needle === "" ||
        s.key.toLowerCase().includes(needle) ||
        text.label(s).toLowerCase().includes(needle) ||
        (text.description(s) ?? "").toLowerCase().includes(needle),
    );
    return groupSettings(list);
  }, [query.data, search, text]);

  if (query.isPending) return <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />;
  if (query.isError) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  return (
    <>
      <FilterBar onReset={() => setSearch("")} canReset={search !== ""}>
        <SearchField label={t("search")} placeholder={t("searchPlaceholder")} value={search} onChange={setSearch} className="max-w-md" />
      </FilterBar>

      {groups.length === 0 ? (
        <Card>
          <EmptyState title={search ? t("noMatches") : t("empty")} />
        </Card>
      ) : (
        groups.map(({ group, items }) => (
          <Card key={group} title={text.group(group)}>
            <ul className="flex flex-col">
              {items.map((setting) => (
                <SettingRow key={setting.key} setting={setting} onEdit={() => setEditing(setting)} />
              ))}
            </ul>
          </Card>
        ))
      )}

      {editing && (
        <SettingEditDialog
          setting={editing}
          onClose={() => setEditing(null)}
          onStale={() => {
            setEditing(null);
            setStale(true);
          }}
        />
      )}

      <Dialog
        open={stale}
        onOpenChange={setStale}
        title={t("stale.title")}
        description={t("stale.body")}
        size="sm"
        footer={
          <Button
            onClick={() => {
              setStale(false);
              void query.refetch();
            }}
          >
            {t("stale.reload")}
          </Button>
        }
      />
    </>
  );
}

function SettingRow({ setting, onEdit }: { setting: Setting; onEdit: () => void }) {
  const t = useTranslations("admin.settings");
  const locale = useLocale();
  const text = useSettingText();
  const label = text.label(setting);
  const description = text.description(setting);

  return (
    <li className="flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
        <span className="font-bold text-ink-900">{label}</span>
        {description && <span className="text-sm/6 text-ink-600">{description}</span>}
        <code dir="ltr" className="self-start font-latin text-xs text-ink-600">
          {setting.key}
        </code>
      </div>
      <div className="flex min-w-[200px] flex-col items-start gap-1">
        <SettingValue setting={setting} />
        {setting.updated_at && (
          <span className="text-xs text-ink-600">{t("updatedAt", { date: formatDateTime(setting.updated_at, locale) })}</span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onEdit}
        icon={<Pencil aria-hidden className="size-4" />}
        aria-label={t("editLabel", { name: label })}
      >
        {t("edit")}
      </Button>
    </li>
  );
}

/** "Mon–Thu 08:00–20:00 · Fri closed" (Monday first). */
function WeeklyHoursSummary({ value }: { value: unknown }) {
  const t = useTranslations("admin.settings.weeklyHours");
  const text = useOpsText();
  const runs = summarizeWeeklyHours(value);
  if (!runs) return <span className="text-sm text-ink-600">{t("invalid")}</span>;
  if (runs.length === 1) {
    const hours = runs[0].hours;
    return (
      <span className="font-medium text-ink-900">
        {hours ? (
          <>
            {t("everyDay")}{" "}
            <bdi dir="ltr" className="font-latin">
              {hours.open}–{hours.close}
            </bdi>
          </>
        ) : (
          t("closedAllWeek")
        )}
      </span>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {runs.map((run) => {
        const first = text.weekdayShort(run.days[0]);
        const days = run.days.length === 1 ? first : t("dayRange", { from: first, to: text.weekdayShort(run.days[run.days.length - 1]) });
        return (
          <li key={run.days.join("-")} className="text-ink-900">
            <span className="font-medium">{days}</span>{" "}
            {run.hours ? (
              <bdi dir="ltr" className="font-latin">
                {run.hours.open}–{run.hours.close}
              </bdi>
            ) : (
              <span className="text-ink-600">{t("closed")}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function isRangeList(value: unknown): value is { start: string; end: string }[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => formatTimeRange(v) !== null);
}

export function SettingValue({ setting }: { setting: Setting }) {
  const t = useTranslations("admin.settings");
  const locale = useLocale();
  const text = useSettingText();
  const { value } = setting;
  const kind = editorKind(setting);

  if (value === null || value === undefined) return <StatusBadge tone="pending">{t("notSet")}</StatusBadge>;

  switch (kind) {
    case "weekly_hours":
      return <WeeklyHoursSummary value={value} />;
    case "dates": {
      const dates = value as string[];
      if (dates.length === 0) return <span className="text-sm text-ink-600">{t("holidays.none")}</span>;
      const shown = dates.slice(0, 6);
      return (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("holidays.listLabel")}>
          {shown.map((date) => (
            <li key={date} dir="ltr" className="rounded-pill bg-petrol-50 px-2.5 py-0.5 font-latin text-[13px] font-medium text-petrol-700">
              {date}
            </li>
          ))}
          {dates.length > shown.length && (
            <li className="px-1 text-[13px] text-ink-600">{t("holidays.more", { count: dates.length - shown.length })}</li>
          )}
        </ul>
      );
    }
    case "bool":
      return <StatusBadge tone={value === true ? "success" : "neutral"}>{value === true ? t("on") : t("off")}</StatusBadge>;
    case "money":
      return <span className="font-medium text-ink-900">{typeof value === "number" ? formatAed(value, locale) : String(value)}</span>;
    case "enum":
      return <span className="font-medium text-ink-900">{text.option(setting.key, String(value))}</span>;
    case "chips": {
      const items = value as string[];
      if (items.length === 0) return <span className="text-sm text-ink-600">{t("emptyList")}</span>;
      return (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} dir="ltr" className="rounded-pill bg-petrol-50 px-2.5 py-0.5 font-latin text-[13px] font-medium text-petrol-700">
              {item}
            </li>
          ))}
        </ul>
      );
    }
    case "int":
    case "string":
      return (
        <span dir="auto" className="font-medium text-ink-900">
          {String(value)}
        </span>
      );
    default: {
      const range = formatTimeRange(value);
      const summary = range ?? (isRangeList(value) ? value.map((v) => formatTimeRange(v)).join(" · ") : JSON.stringify(value));
      return (
        <span dir="ltr" className="max-w-[320px] truncate font-latin font-medium text-ink-900" title={JSON.stringify(value)}>
          {summary}
        </span>
      );
    }
  }
}
