import { isIsoDate } from "../format";
import type { Translatable } from "../types";
import { FAQ_PLACEHOLDERS, LIMITS, type LegalSlug } from "./types";

/*
 * Form checks of the legal pages and the FAQ (contract A4a §3). The API answers 422 for all of them; the editors say so
 * first, per field, in their own words. Lengths count characters.
 */

export type FieldError = "required" | "tooLong" | "invalid";

const length = (value: string) => Array.from(value).length;
const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function checkVersionLabel(raw: string): FieldError | null {
  const v = raw.trim();
  if (v === "") return "required";
  if (v.length > LIMITS.versionLabel) return "tooLong";
  return VERSION_LABEL.test(v) ? null : "invalid";
}

export function checkEffectiveDate(raw: string): FieldError | null {
  if (raw === "") return "required";
  return isIsoDate(raw) ? null : "invalid";
}

/** Both languages are required and bounded. */
export function checkTranslatable(value: Translatable, max: number): LangErrors {
  const one = (text: string): FieldError | null => (text.trim() === "" ? "required" : length(text) > max ? "tooLong" : null);
  return { ar: one(value.ar), en: one(value.en) };
}

export type PageDraft = { version_label: string; effective_date: string; title: Translatable; body: Translatable };
export type LangErrors = { ar: FieldError | null; en: FieldError | null };
export type PageErrors = { version_label?: FieldError; effective_date?: FieldError; title?: LangErrors; body?: LangErrors };

/** The first problem of each field of a page draft, or null when it can be saved. */
export function checkPage(draft: PageDraft): { ok: true } | { ok: false; errors: PageErrors } {
  const errors: PageErrors = {};
  const label = checkVersionLabel(draft.version_label);
  if (label) errors.version_label = label;
  const date = checkEffectiveDate(draft.effective_date);
  if (date) errors.effective_date = date;
  const title = checkTranslatable(draft.title, LIMITS.title);
  if (title.ar || title.en) errors.title = title;
  const body = checkTranslatable(draft.body, LIMITS.body);
  if (body.ar || body.en) errors.body = body;
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

/** A percentage, in Latin or Arabic-Indic digits (the cancellation page may quote none, P5-C58, P5-C77). */
const FIGURE = /[0-9٠-٩۰-۹]+\s?[%٪]/;

/** True when the cancellation page's title or body (either language) quotes a percentage: the API refuses to publish it. */
export function quotesFigures(slug: LegalSlug, title: Translatable, body: Translatable): boolean {
  if (slug !== "cancellation") return false;
  return [title.ar, title.en, body.ar, body.en].some((text) => FIGURE.test(text));
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]*)\s*\}\}/g;

/** The `{{names}}` in a text that are not placeholders the API renders. */
export function unknownPlaceholders(text: string): string[] {
  const allowed: readonly string[] = FAQ_PLACEHOLDERS;
  const out = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) if (!allowed.includes(match[1])) out.add(match[1]);
  return [...out];
}

export type FaqDraft = { question: Translatable; answer: Translatable; is_active: boolean };
export type FaqErrors = { question?: LangErrors; answer?: LangErrors; placeholder?: string };

export function checkFaq(draft: FaqDraft): { ok: true } | { ok: false; errors: FaqErrors } {
  const errors: FaqErrors = {};
  const question = checkTranslatable(draft.question, LIMITS.question);
  if (question.ar || question.en) errors.question = question;
  const answer = checkTranslatable(draft.answer, LIMITS.answer);
  if (answer.ar || answer.en) errors.answer = answer;
  const unknown = [draft.question.ar, draft.question.en, draft.answer.ar, draft.answer.en].flatMap(unknownPlaceholders);
  if (unknown.length > 0) errors.placeholder = unknown[0];
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

/** The ids in the order after moving the item at `index` one place (`delta` -1 up, +1 down); the same list at an end. */
export function moveId(ids: readonly number[], index: number, delta: -1 | 1): number[] {
  const to = index + delta;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
