import type { PublicConfig } from "@/lib/admin/types";
import { apiOrigin } from "./apiProxy";

/*
 * GET /api/v1/public/config on the server (customer web pages, D-16): support contacts and defaults. Fetched from
 * API_INTERNAL_URL like the admin proxy; cached for five minutes. A page renders without it (null) when the API is
 * unreachable.
 */

type Fetcher = (input: string, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The support contacts the API publishes (each may be unset). */
export function readPublicConfig(body: unknown): PublicConfig | null {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") return null;
  const support = (data as { support?: unknown }).support;
  const s = support && typeof support === "object" ? (support as Record<string, unknown>) : {};
  return {
    support: { phone: text(s.phone), whatsapp: text(s.whatsapp), email: text(s.email) },
    default_locale: text((data as { default_locale?: unknown }).default_locale) ?? undefined,
  };
}

export async function getPublicConfig(fetcher: Fetcher = fetch): Promise<PublicConfig | null> {
  try {
    const res = await fetcher(`${apiOrigin()}/api/v1/public/config`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return readPublicConfig(await res.json());
  } catch {
    return null;
  }
}
