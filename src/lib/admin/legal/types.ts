import type { components } from "@/lib/api/schema";

/*
 * A11 legal pages and FAQ (slice W3; contract A4a §3): the shapes of GET/POST/PATCH /admin/pages and /admin/faq, from the
 * generated schema (it types them exactly).
 */
type Schemas = components["schemas"];

export type ContentPage = Schemas["AdminContentPageResource"];
export type FaqItem = Schemas["AdminFaqItemResource"];

/** The closed list of legal pages (settings.content_page_slugs). */
export const LEGAL_SLUGS = ["terms", "privacy", "cancellation"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
/** Terms and privacy ask every customer to accept the new version again; the cancellation page quotes no figure. */
export const ACCEPTANCE_SLUGS: readonly LegalSlug[] = ["terms", "privacy"];

export const CONTENT_STATUSES = ["draft", "published", "superseded"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** The placeholders an FAQ question or answer may hold, rendered by GET /public/faq (P5-C31). */
export const FAQ_PLACEHOLDERS = ["confirmation_sla", "refund_estimated_arrival"] as const;

/** Limits of the API (settings config). */
export const LIMITS = { versionLabel: 20, title: 120, body: 60_000, question: 200, answer: 2000, faqItems: 100, reason: 500 } as const;
