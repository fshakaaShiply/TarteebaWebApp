// Public "from" prices for the landing page. Prices are business settings (spec §0.1 rule 4), so they
// come from the API catalog (GET /api/v1/public/services, Phase 1), never from this repo.
// Until that endpoint exists the request fails and the page simply hides price lines.

export type ServiceKind = "standard_visit" | "recurring" | "live_out";

export type PublicPrice = {
  kind: ServiceKind;
  from_fils: number;
  unit: "per_worker_visit" | "per_month";
};

type ServicesResponse = { data: { kind: string; price_from_fils?: number | null; price_unit?: string }[] };

export async function getFromPrices(): Promise<Partial<Record<ServiceKind, PublicPrice>>> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
  try {
    const res = await fetch(`${base}/v1/public/services`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as ServicesResponse;
    const prices: Partial<Record<ServiceKind, PublicPrice>> = {};
    for (const s of body.data ?? []) {
      if (typeof s.price_from_fils !== "number") continue;
      const kind = s.kind as ServiceKind;
      if (kind !== "standard_visit" && kind !== "recurring" && kind !== "live_out") continue;
      prices[kind] = {
        kind,
        from_fils: s.price_from_fils,
        unit: s.price_unit === "per_month" ? "per_month" : "per_worker_visit",
      };
    }
    return prices;
  } catch {
    return {};
  }
}
