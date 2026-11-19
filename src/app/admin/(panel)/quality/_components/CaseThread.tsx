"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ThreadBubble } from "@/components/admin";
import { useQualityText, type QualityText } from "@/lib/admin/quality/labels";
import type { AdminCaseDetail, CaseEvent } from "@/lib/admin/quality/types";
import { AttachmentList } from "./AttachmentLink";

type Props = {
  c: AdminCaseDetail;
  /** Reads the case again (fresh file links). */
  onRefreshFiles: () => void;
  refreshingFiles?: boolean;
  /** A staff id's name, for the timeline ("assigned to Dima"). */
  staffName?: (id: number) => string | null;
};

/**
 * The conversation of a case (A10): what the customer wrote first, then every message oldest first. The team's public
 * replies and the internal notes are styled apart (an internal note says it is never shown to the customer), files are
 * signed links, and the timeline of everything that happened to the case can be shown below.
 */
export function CaseThread({ c, onRefreshFiles, refreshingFiles, staffName }: Props) {
  const t = useTranslations("admin.quality.thread");
  const text = useQualityText();
  const [timeline, setTimeline] = useState(false);
  const customerName = c.customer.name ?? t("customer");
  const files = (list: AdminCaseDetail["attachments"]) => <AttachmentList files={list} onRefresh={onRefreshFiles} refreshing={refreshingFiles} />;

  return (
    <div className="flex flex-col gap-3">
      <ol aria-label={t("list")} className="flex flex-col gap-2.5">
        <ThreadBubble side={c.source === "rating" ? "system" : "customer"} author={customerName} time={text.dateTime(c.created_at)} files={c.attachments.length > 0 ? files(c.attachments) : undefined}>
          {c.description}
        </ThreadBubble>
        {c.messages.map((m) => (
          <ThreadBubble
            key={m.id}
            side={m.author_type === "customer" ? "customer" : m.author_type === "staff" ? "team" : "system"}
            author={m.author_type === "staff" ? (m.author?.name ?? t("team")) : m.author_type === "customer" ? customerName : t("system")}
            time={text.dateTime(m.created_at)}
            internal={m.is_internal}
            resolution={m.kind === "resolution"}
            files={m.attachments.length > 0 ? files(m.attachments) : undefined}
          >
            {m.body}
          </ThreadBubble>
        ))}
      </ol>
      <div>
        <Button variant="ghost" size="sm" aria-expanded={timeline} aria-controls="case-timeline" onClick={() => setTimeline((v) => !v)}>
          {timeline ? t("hideTimeline") : t("showTimeline", { count: c.events.length })}
        </Button>
      </div>
      {timeline && (
        <ol id="case-timeline" aria-label={t("timeline")} className="flex flex-col gap-1.5 border-s-2 border-line ps-3 text-sm">
          {c.events.map((event, i) => (
            <li key={`${event.created_at}-${i}`} className="flex flex-col">
              <span className="text-ink-900">{eventLine(event, text, t as unknown as Translate, staffName)}</span>
              <span className="text-xs text-ink-600">
                {text.dateTime(event.created_at)} · {actorName(event, t as unknown as Translate)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Translate = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

function actorName(event: CaseEvent, t: Translate): string {
  if (event.actor.type === "system") return t("system");
  if (event.actor.type === "customer") return event.actor.name ?? t("customer");
  return event.actor.name ?? t("team");
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One sentence for a timeline row; a type this page does not know reads as its code, never as nothing. */
export function eventLine(event: CaseEvent, text: QualityText, t: Translate, staffName?: (id: number) => string | null): string {
  const d = event.data;
  const key = `events.${event.type}`;
  const reason = str(d.reason);
  const withReason = (line: string) => (reason ? `${line} · ${t("events.reason", { reason })}` : line);
  switch (event.type) {
    case "status_changed":
      return withReason(t(key, { from: text.status(str(d.from)), to: text.status(str(d.to)) }));
    case "priority_changed":
      return t(key, { from: text.priority(str(d.from)), to: text.priority(str(d.to)) });
    case "category_changed":
      return t(key, { from: text.category(str(d.from)), to: text.category(str(d.to)) });
    case "assigned": {
      const to = num(d.to);
      if (to === null) return t("events.unassigned");
      return t(key, { name: staffName?.(to) ?? t("events.someone") });
    }
    case "workers_changed": {
      const added = Array.isArray(d.added) ? d.added.length : 0;
      const removed = Array.isArray(d.removed) ? d.removed.length : 0;
      return t(key, { added, removed });
    }
    case "sla_breached":
      return t(key, { kind: d.kind === "first_response" ? t("events.firstReply") : t("events.resolutionDeadline") });
    case "reopened":
      return t(key, { by: str(d.by) === "system" ? t("system") : str(d.by) === "customer" ? t("customer") : t("team") });
    case "rating_received":
      return t(key, { overall: num(d.overall) ?? 0 });
    case "created":
      return withReason(str(d.source) ? t(key, { source: text.source(str(d.source)) }) : t("events.createdPlain"));
    case "merged":
      return t(typeof d.into_reference === "string" ? "events.mergedInto" : "events.mergedFrom", { reference: str(d.into_reference) || str(d.from_reference) });
    case "compensation_proposed":
    case "compensation_executed":
    case "compensation_rejected":
    case "compensation_cancelled":
    case "compensation_failed": {
      const amount = num(d.amount_fils);
      const type = str(d.type);
      const what = type ? (amount ? `${text.compensationType(type)} ${text.money(amount)}` : text.compensationType(type)) : "";
      return withReason(t(key, { what }));
    }
    default:
      return t.has(key) ? t(key) : event.type;
  }
}
