import type { CatalogPreviewRequest, ServicePayload, ServicePricePayload } from "../endpoints";
import { priceFormSchema, serviceFormSchema, type PriceFormValues, type ServiceFormValues } from "./forms";

/*
 * A11 "preview before publish" (spec §17): POST /admin/catalog/preview with the values on screen, before saving.
 * The API applies them to in-memory copies and answers with the public payload in Arabic and English.
 */

export type PreviewBuild = { ok: true; request: CatalogPreviewRequest } | { ok: false };

/** The service's unsaved General tab → preview request (the same fields Save would send, without the reason). */
export function buildServicePreviewRequest(serviceCode: string, values: ServiceFormValues): PreviewBuild {
  const parsed = serviceFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false };
  const service: Partial<ServicePayload> = parsed.data.payload;
  return { ok: true, request: { service_code: serviceCode, service } };
}

/**
 * One unsaved price row → preview request: an edit of row `priceId`, or a new row when `priceId` is null. The rest of
 * the service's saved prices stay as they are, so the "from" price shows the effect of this row alone.
 */
export function buildPricePreviewRequest(
  serviceCode: string,
  priceId: number | null,
  values: PriceFormValues,
): PreviewBuild {
  const parsed = priceFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false };
  const row: ServicePricePayload = parsed.data.payload;
  return {
    ok: true,
    request: { service_code: serviceCode, prices: [priceId === null ? row : { id: priceId, ...row }] },
  };
}

/** Deleting row `priceId`, previewed before the admin confirms. */
export function buildPriceDeletePreviewRequest(serviceCode: string, priceId: number): CatalogPreviewRequest {
  return { service_code: serviceCode, prices: [{ id: priceId, delete: true }] };
}
