import { apiOrigin } from "./apiProxy";

/*
 * The customer web's legal pages and FAQ (D-16, customers §7.2): GET /api/v1/public/pages/{slug} and /public/faq on the
 * server, in the page's language, from API_INTERNAL_URL like the support contacts (publicConfig.ts) and cached for five
 * minutes (the API answers `Cache-Control: max-age=300, public`). A page renders its own "cannot load now" state when the
 * API is unreachable; an unknown slug is a 404 without calling the API.
 */

type Fetcher = (input: string, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

export type LegalLocale = "ar" | "en";
export const LEGAL_PAGE_SLUGS = ["terms", "privacy", "cancellation"] as const;
export type LegalPageSlug = (typeof LEGAL_PAGE_SLUGS)[number];

export function isLegalSlug(value: unknown): value is LegalPageSlug {
  return typeof value === "string" && (LEGAL_PAGE_SLUGS as readonly string[]).includes(value);
}

/** `?lang=` of the customer pages: "en" or "ar", Arabic when absent or anything else. */
export function readLang(value: unknown): LegalLocale {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "en" ? "en" : "ar";
}

export type LegalPage = { slug: string; version_label: string; effective_date: string; title: string; body: string };
export type FaqEntry = { id: number; question: string; answer: string };

export type Loaded<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "unavailable" };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The page as the API sends it, or null when the answer is not one. */
export function readLegalPage(body: unknown): LegalPage | null {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const title = text(d.title);
  const pageBody = text(d.body);
  if (title === "" && pageBody === "") return null;
  return { slug: text(d.slug), version_label: text(d.version_label), effective_date: text(d.effective_date), title, body: pageBody };
}

export function readFaq(body: unknown): FaqEntry[] | null {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return null;
  const out: FaqEntry[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const question = text(r.question);
    const answer = text(r.answer);
    if (question !== "" && answer !== "") out.push({ id: typeof r.id === "number" ? r.id : out.length, question, answer });
  }
  return out;
}

async function load<T>(path: string, locale: LegalLocale, read: (body: unknown) => T | null, fetcher: Fetcher): Promise<Loaded<T>> {
  try {
    const res = await fetcher(`${apiOrigin()}/api/v1/public/${path}`, {
      headers: { Accept: "application/json", "Accept-Language": locale },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "unavailable" };
    const data = read(await res.json());
    return data === null ? { status: "unavailable" } : { status: "ok", data };
  } catch {
    return { status: "unavailable" };
  }
}

export function getLegalPage(slug: string, locale: LegalLocale, fetcher: Fetcher = fetch): Promise<Loaded<LegalPage>> {
  if (!isLegalSlug(slug)) return Promise.resolve({ status: "not_found" });
  return load(`pages/${slug}`, locale, readLegalPage, fetcher);
}

export function getFaq(locale: LegalLocale, fetcher: Fetcher = fetch): Promise<Loaded<FaqEntry[]>> {
  return load("faq", locale, readFaq, fetcher);
}
