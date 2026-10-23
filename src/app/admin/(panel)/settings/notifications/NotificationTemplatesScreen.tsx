"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Card, EmptyState, ErrorState, FilterBar, LoadingBlock, PageHeader, SearchField, Select, StatusBadge } from "@/components/admin";
import { fetchNotificationTemplates } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import {
  AUDIENCES,
  CHANNELS,
  LOCALES,
  NO_TEMPLATE_FILTERS,
  filterTemplates,
  groupTemplates,
  type TemplateEvent,
  type TemplateFilters,
} from "@/lib/admin/notifications/templates";
import type { NotificationTemplate } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useTemplateText } from "./templateText";

/**
 * A11 notification templates (spec §12, §17 "notification templates (ar/en with preview)"; settings.manage; design
 * AdminSettings.dc.html "قوالب الإشعارات"): every template grouped by event, one row per audience and channel with
 * the Arabic and English text side by side, whether each is sent, and a link to edit it.
 */
export function NotificationTemplatesScreen() {
  const t = useTranslations("admin.notificationTemplates");
  return (
    <RequirePermission anyOf={["settings.manage"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <TemplatesContent />
    </RequirePermission>
  );
}

function TemplatesContent() {
  const t = useTranslations("admin.notificationTemplates");
  const text = useTemplateText();
  const [filters, setFilters] = useState<TemplateFilters>(NO_TEMPLATE_FILTERS);
  const templates = useQuery({ queryKey: adminKeys.notificationTemplateList(), queryFn: () => fetchNotificationTemplates() });
  const groups = useMemo(() => groupTemplates(filterTemplates(templates.data ?? [], filters)), [templates.data, filters]);
  const filtered = filters.search.trim() !== "" || filters.audience !== "" || filters.channel !== "" || filters.state !== "";

  if (templates.isPending) return <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />;
  if (templates.isError) {
    return (
      <Card>
        <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
      </Card>
    );
  }

  const active = templates.data.filter((tpl) => tpl.is_active).length;

  return (
    <>
      <Card>
        <FilterBar canReset={filtered} onReset={() => setFilters(NO_TEMPLATE_FILTERS)}>
          <SearchField
            label={t("filters.search")}
            placeholder={t("filters.searchPlaceholder")}
            value={filters.search}
            onChange={(search) => setFilters({ ...filters, search })}
          />
          <Select
            label={t("filters.audience")}
            placeholder={t("filters.allAudiences")}
            value={filters.audience}
            onChange={(e) => setFilters({ ...filters, audience: e.target.value as TemplateFilters["audience"] })}
            options={AUDIENCES.map((a) => ({ value: a, label: text.audience(a) }))}
            containerClassName="min-w-[160px]"
          />
          <Select
            label={t("filters.channel")}
            placeholder={t("filters.allChannels")}
            value={filters.channel}
            onChange={(e) => setFilters({ ...filters, channel: e.target.value as TemplateFilters["channel"] })}
            options={CHANNELS.map((c) => ({ value: c, label: text.channel(c) }))}
            containerClassName="min-w-[170px]"
          />
          <Select
            label={t("filters.state")}
            placeholder={t("filters.allStates")}
            value={filters.state}
            onChange={(e) => setFilters({ ...filters, state: e.target.value as TemplateFilters["state"] })}
            options={[
              { value: "active", label: t("active") },
              { value: "inactive", label: t("inactive") },
            ]}
            containerClassName="min-w-[150px]"
          />
        </FilterBar>
        <p className="text-sm text-ink-600">{t("count", { total: templates.data.length, active })}</p>
      </Card>

      {groups.length === 0 ? (
        <Card>
          <EmptyState title={filtered ? t("emptyFiltered") : t("empty")} />
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.group ?? "other"} title={text.group(group.group)}>
            <div className="flex flex-col">
              {group.events.map((event) => (
                <EventTemplates key={event.eventKey} event={event} />
              ))}
            </div>
          </Card>
        ))
      )}
    </>
  );
}

function EventTemplates({ event }: { event: TemplateEvent }) {
  const t = useTranslations("admin.notificationTemplates");
  const text = useTemplateText();
  const headingId = `event-${event.eventKey.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 id={headingId} className="text-base font-bold text-ink-900">
          {event.label}
        </h3>
        <code dir="ltr" className="font-latin text-xs text-ink-600">
          {event.eventKey}
        </code>
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">{t("tableCaption", { event: event.label })}</caption>
          <thead>
            <tr className="text-ink-600">
              <th scope="col" className="px-2 py-1.5 text-start font-medium">
                {t("columns.audience")}
              </th>
              <th scope="col" className="px-2 py-1.5 text-start font-medium">
                {t("columns.channel")}
              </th>
              {LOCALES.map((locale) => (
                <th key={locale} scope="col" className="px-2 py-1.5 text-start font-medium">
                  {text.language(locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {event.rows.map((row) => (
              <tr key={`${row.audience}:${row.channel}`} className="border-t border-line align-top">
                <td className="px-2 py-2.5">{text.audience(row.audience)}</td>
                <td className="px-2 py-2.5">{row.channelLabel || text.channel(row.channel)}</td>
                {LOCALES.map((locale) => (
                  <td key={locale} className="px-2 py-2.5">
                    {row[locale] ? <TemplateCell template={row[locale]} eventLabel={event.label} /> : <span className="text-ink-600">{t("missing")}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TemplateCell({ template, eventLabel }: { template: NotificationTemplate; eventLabel: string }) {
  const t = useTranslations("admin.notificationTemplates");
  const text = useTemplateText();
  const excerpt = template.subject || template.body;
  return (
    <div className="flex max-w-[320px] flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={template.is_active ? "success" : "neutral"}>{template.is_active ? t("active") : t("inactive")}</StatusBadge>
        {/* The name has the audience too: an event can have a customer and a staff template on one channel and language. */}
        <Link
          href={`/admin/settings/notifications/${template.id}`}
          className="touch-target inline-flex items-center gap-1 text-sm font-bold"
          aria-label={t("editLabel", {
            event: eventLabel,
            audience: text.audience(template.audience),
            channel: template.channel_label || text.channel(template.channel),
            language: text.language(template.locale),
          })}
        >
          <Pencil aria-hidden className="size-3.5" />
          {t("edit")}
        </Link>
      </span>
      <span dir={template.locale === "ar" ? "rtl" : "ltr"} lang={template.locale} className="line-clamp-2 text-xs text-ink-600">
        {excerpt}
      </span>
    </div>
  );
}
