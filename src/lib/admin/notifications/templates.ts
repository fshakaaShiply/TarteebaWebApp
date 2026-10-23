import { z } from "zod";
import type { SampleValue } from "../endpoints";
import type { NotificationAudience, NotificationChannel, NotificationTemplate } from "../types";

/*
 * A11 notification templates (spec §12, §14.3, §17 "notification templates (ar/en with preview)"). The API fixes the
 * set: one template per event, audience, channel and language. Admins edit the subject, the body and whether it is
 * sent. The rules below mirror the API's (UpdateNotificationTemplate) so the editor explains a problem before saving;
 * the API checks everything again.
 */

export const CHANNELS = ["push", "in_app", "sms", "email", "whatsapp_future"] as const satisfies readonly NotificationChannel[];
export const AUDIENCES = ["customer", "staff"] as const satisfies readonly NotificationAudience[];
/** Preference groups (screen 28) in the app's order; staff-only events share their booking or payment group. */
export const TEMPLATE_GROUPS = ["bookings", "payments", "reminders", "visit_progress", "waitlist"] as const;
export const LOCALES = ["ar", "en"] as const;

/** config notification.limits. */
export const SUBJECT_MAX = 150;
export const REASON_MAX = 500;

export function bodyLimit(channel: NotificationChannel): number {
  if (channel === "sms") return 320;
  if (channel === "push") return 500;
  return 2000;
}

/** SMS (and the WhatsApp stub) show no subject; push, in-app and e-mail need one. */
export function hasSubject(channel: NotificationChannel): boolean {
  return channel !== "sms" && channel !== "whatsapp_future";
}

/** TemplateRenderer::PATTERN: {{name}}, spaces inside the braces allowed. */
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Placeholder names used in a text, in order of first use. */
export function usedPlaceholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) if (!names.includes(match[1])) names.push(match[1]);
  return names;
}

/** Placeholders in the text that the event does not offer (they would render as nothing; the API refuses them). */
export function unknownPlaceholders(text: string | null | undefined, allowed: readonly string[]): string[] {
  return usedPlaceholders(text).filter((name) => !allowed.includes(name));
}

/**
 * Puts `token` where the caret is (replacing a selection) and says where the caret goes next: right after the token.
 * Without a known caret the token goes at the end.
 */
export function insertToken(value: string, token: string, start: number | null, end: number | null): { value: string; caret: number } {
  const from = start === null ? value.length : Math.max(0, Math.min(start, value.length));
  const to = end === null ? from : Math.max(from, Math.min(end, value.length));
  return { value: value.slice(0, from) + token + value.slice(to), caret: from + token.length };
}

export type TemplateRow = {
  audience: NotificationAudience;
  channel: NotificationChannel;
  channelLabel: string;
  ar: NotificationTemplate | null;
  en: NotificationTemplate | null;
};

export type TemplateEvent = { eventKey: string; label: string; rows: TemplateRow[] };

export type TemplateGroup = { group: string | null; events: TemplateEvent[] };

const rank = <T extends string>(list: readonly T[], value: string) => {
  const i = (list as readonly string[]).indexOf(value);
  return i < 0 ? list.length : i;
};

/**
 * The list grouped as A11 shows it: preference group, then event (the API's order), then one row per audience and
 * channel with its Arabic and English template side by side.
 */
export function groupTemplates(templates: readonly NotificationTemplate[]): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();
  const events = new Map<string, TemplateEvent>();
  for (const t of templates) {
    const groupKey = t.group ?? "";
    let group = groups.get(groupKey);
    if (!group) {
      group = { group: t.group, events: [] };
      groups.set(groupKey, group);
    }
    let event = events.get(t.event_key);
    if (!event) {
      event = { eventKey: t.event_key, label: t.event_label, rows: [] };
      events.set(t.event_key, event);
      group.events.push(event);
    }
    let row = event.rows.find((r) => r.audience === t.audience && r.channel === t.channel);
    if (!row) {
      row = { audience: t.audience, channel: t.channel, channelLabel: t.channel_label, ar: null, en: null };
      event.rows.push(row);
    }
    if (t.locale === "ar" || t.locale === "en") row[t.locale] = t;
  }
  for (const event of events.values()) {
    event.rows.sort((a, b) => rank(AUDIENCES, a.audience) - rank(AUDIENCES, b.audience) || rank(CHANNELS, a.channel) - rank(CHANNELS, b.channel));
  }
  return [...groups.values()].sort((a, b) => rank(TEMPLATE_GROUPS, a.group ?? "") - rank(TEMPLATE_GROUPS, b.group ?? ""));
}

export type TemplateFilters = { search: string; audience: NotificationAudience | ""; channel: NotificationChannel | ""; state: "active" | "inactive" | "" };

export const NO_TEMPLATE_FILTERS: TemplateFilters = { search: "", audience: "", channel: "", state: "" };

/** Client-side filters over the whole set (it is small): text in the event name or key, subject or body. */
export function filterTemplates(templates: readonly NotificationTemplate[], filters: TemplateFilters): NotificationTemplate[] {
  const needle = filters.search.trim().toLocaleLowerCase();
  return templates.filter(
    (t) =>
      (filters.audience === "" || t.audience === filters.audience) &&
      (filters.channel === "" || t.channel === filters.channel) &&
      (filters.state === "" || t.is_active === (filters.state === "active")) &&
      (needle === "" ||
        [t.event_label, t.event_key, t.subject ?? "", t.body].some((text) => text.toLocaleLowerCase().includes(needle))),
  );
}

export type TemplateFormValues = { subject: string; body: string; is_active: boolean; reason: string };

export type TemplateFormError = "subject_required" | "subject_length" | "body_required" | "body_length" | "unknown_placeholders" | "reason_length";

export const TEMPLATE_FORM_ERRORS: readonly TemplateFormError[] = [
  "subject_required",
  "subject_length",
  "body_required",
  "body_length",
  "unknown_placeholders",
  "reason_length",
];

/** The editor's schema for one template's channel and placeholders; problems are TemplateFormError codes. */
export function templateFormSchema(channel: NotificationChannel, allowed: readonly string[]) {
  const subjectShown = hasSubject(channel);
  const max = bodyLimit(channel);
  return z
    .object({ subject: z.string(), body: z.string(), is_active: z.boolean(), reason: z.string() })
    .superRefine((v, ctx) => {
      const issue = (path: keyof TemplateFormValues, message: TemplateFormError) => ctx.addIssue({ code: "custom", path: [path], message });
      if (subjectShown) {
        if (v.subject.trim() === "") issue("subject", "subject_required");
        else if (v.subject.trim().length > SUBJECT_MAX) issue("subject", "subject_length");
        else if (unknownPlaceholders(v.subject, allowed).length > 0) issue("subject", "unknown_placeholders");
      }
      const body = normalizeBody(v.body);
      if (body === "") issue("body", "body_required");
      else if ([...body].length > max) issue("body", "body_length");
      else if (unknownPlaceholders(body, allowed).length > 0) issue("body", "unknown_placeholders");
      if (v.reason.trim().length > REASON_MAX) issue("reason", "reason_length");
    });
}

/** The API stores the body trimmed with Unix line ends; the editor counts and compares the same text. */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

export function templateFormValues(t: Pick<NotificationTemplate, "subject" | "body" | "is_active">): TemplateFormValues {
  return { subject: t.subject ?? "", body: t.body, is_active: t.is_active, reason: "" };
}

/** Only what changed goes in the PATCH (the reason when given): a save without changes sends nothing. */
export function templateChanges(
  original: Pick<NotificationTemplate, "subject" | "body" | "is_active" | "channel">,
  values: TemplateFormValues,
): { subject?: string | null; body?: string; is_active?: boolean; reason?: string | null } {
  const out: { subject?: string | null; body?: string; is_active?: boolean; reason?: string | null } = {};
  if (hasSubject(original.channel)) {
    const subject = values.subject.trim();
    if (subject !== (original.subject ?? "")) out.subject = subject;
  }
  const body = normalizeBody(values.body);
  if (body !== original.body) out.body = body;
  if (values.is_active !== original.is_active) out.is_active = values.is_active;
  if (Object.keys(out).length > 0 && values.reason.trim() !== "") out.reason = values.reason.trim();
  return out;
}

export type SampleDraft = Record<string, { ar: string; en: string }>;

/** The preview's sample payload: only the values the admin typed (the API keeps its own samples for the rest). */
export function samplePayload(samples: SampleDraft): Record<string, SampleValue> {
  const out: Record<string, SampleValue> = {};
  for (const [name, value] of Object.entries(samples)) {
    const ar = value.ar.trim();
    const en = value.en.trim();
    if (ar === "" && en === "") continue;
    out[name] = { ...(ar ? { ar } : {}), ...(en ? { en } : {}) };
  }
  return out;
}
