import { adminApi, unwrap } from "../client";
import type { DataEnvelope, Translatable } from "../types";
import type { ContentPage, FaqItem, LegalSlug } from "./types";

/*
 * A11 legal pages and FAQ (settings.manage; contract A4a §3). Versioned edits send the record's version as If-Match
 * (409 STALE_VERSION). Nothing here moves money; publishing a terms or privacy version asks every customer to accept it
 * again (the API sets the legal version), so it carries a reason.
 */

const ifMatch = (version: number | null | undefined) => (version === null || version === undefined ? {} : { "If-Match": String(version) });

// ---- legal pages --------------------------------------------------------------------------------------------------

export async function fetchPages(slug?: LegalSlug): Promise<ContentPage[]> {
  const body = await unwrap<DataEnvelope<ContentPage[]>>(adminApi.GET("/v1/admin/pages", { params: { query: (slug ? { slug } : {}) as never } }));
  return body.data;
}

export async function fetchPage(id: number): Promise<ContentPage> {
  const body = await unwrap<DataEnvelope<ContentPage>>(adminApi.GET("/v1/admin/pages/{page}", { params: { path: { page: id } } }));
  return body.data;
}

export type PageBody = { slug: LegalSlug; version_label: string; effective_date: string; title: Translatable; body: Translatable };

/** A new draft version of a page (422 VERSION_LABEL_TAKEN when the label exists for the slug). */
export async function createPage(body: PageBody): Promise<ContentPage> {
  const answer = await unwrap<DataEnvelope<ContentPage>>(adminApi.POST("/v1/admin/pages", { body: { ...body, version_label: body.version_label.trim() } as never }));
  return answer.data;
}

export type PagePatch = Partial<Omit<PageBody, "slug">>;

/** Saves a draft (409 PAGE_NOT_EDITABLE once published or superseded). */
export async function updatePage(id: number, patch: PagePatch, version: number): Promise<ContentPage> {
  const answer = await unwrap<DataEnvelope<ContentPage>>(
    adminApi.PATCH("/v1/admin/pages/{page}", { params: { path: { page: id } }, body: patch as never, headers: ifMatch(version) }),
  );
  return answer.data;
}

export async function deletePage(id: number, version: number): Promise<void> {
  await unwrap(adminApi.DELETE("/v1/admin/pages/{page}", { params: { path: { page: id } }, headers: ifMatch(version) } as never));
}

/** Publishes a draft: the previous published version becomes history (the API refuses a cancellation page that quotes a percentage). */
export async function publishPage(id: number, reason: string, version: number): Promise<ContentPage> {
  const answer = await unwrap<DataEnvelope<ContentPage>>(
    adminApi.POST("/v1/admin/pages/{page}/publish", { params: { path: { page: id } }, body: { reason: reason.trim() } as never, headers: ifMatch(version) }),
  );
  return answer.data;
}

// ---- FAQ ----------------------------------------------------------------------------------------------------------

export async function fetchFaq(): Promise<FaqItem[]> {
  const body = await unwrap<DataEnvelope<FaqItem[]>>(adminApi.GET("/v1/admin/faq"));
  return body.data;
}

export type FaqBody = { question: Translatable; answer: Translatable; is_active?: boolean };

/** Appends an item (422 FAQ_LIMIT_REACHED, PLACEHOLDER_UNKNOWN). */
export async function createFaq(body: FaqBody): Promise<FaqItem> {
  const answer = await unwrap<DataEnvelope<FaqItem>>(adminApi.POST("/v1/admin/faq", { body: body as never }));
  return answer.data;
}

export async function updateFaq(id: number, patch: Partial<FaqBody>, version: number): Promise<FaqItem> {
  const answer = await unwrap<DataEnvelope<FaqItem>>(adminApi.PATCH("/v1/admin/faq/{item}", { params: { path: { item: id } }, body: patch as never, headers: ifMatch(version) }));
  return answer.data;
}

export async function deleteFaq(id: number): Promise<void> {
  await unwrap(adminApi.DELETE("/v1/admin/faq/{item}", { params: { path: { item: id } } }));
}

/** Every item id once, in the new order (422 ORDER_INCOMPLETE otherwise); answers the list in that order. */
export async function reorderFaq(ids: readonly number[]): Promise<FaqItem[]> {
  const body = await unwrap<DataEnvelope<FaqItem[]>>(adminApi.PUT("/v1/admin/faq/order", { body: { ids } as never }));
  return body.data;
}
