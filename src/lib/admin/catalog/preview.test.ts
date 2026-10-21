import { describe, expect, it } from "vitest";
import type { CatalogService } from "../types";
import { priceToFormValues, serviceToFormValues } from "./forms";
import { buildPriceDeletePreviewRequest, buildPricePreviewRequest, buildServicePreviewRequest } from "./preview";

const service: CatalogService = {
  id: 1,
  code: "STANDARD_VISIT",
  kind: "standard_visit",
  name: { ar: "زيارة تنظيف", en: "Cleaning visit" },
  description: { ar: "تنظيف عام", en: "General cleaning" },
  includes: [],
  excludes: [],
  duration_minutes: 240,
  min_workers: 1,
  max_workers: 4,
  team_size_default: null,
  requires_equipment: false,
  materials_mode: "customer",
  is_active: true,
  is_bookable_online: true,
  sort_order: 0,
  cancellation_policy_id: null,
  reschedule_policy_id: null,
  refund_policy_id: null,
  version: 4,
  created_at: null,
  updated_at: null,
};

describe("preview before publish: request built from unsaved form values", () => {
  it("sends the edited General tab as typed (converted to API types), without the reason", () => {
    const values = {
      ...serviceToFormValues(service),
      name: { ar: "زيارة تنظيف 4 ساعات", en: "4-hour cleaning visit" },
      includes: [{ ar: "المطبخ", en: "Kitchen" }, { ar: "", en: "" }],
      max_workers: "3",
      duration_minutes: "180",
      materials_mode: "company_addon" as const,
      reason: "Owner request",
    };
    const built = buildServicePreviewRequest("STANDARD_VISIT", values);
    expect(built).toEqual({
      ok: true,
      request: {
        service_code: "STANDARD_VISIT",
        service: {
          name: { ar: "زيارة تنظيف 4 ساعات", en: "4-hour cleaning visit" },
          description: { ar: "تنظيف عام", en: "General cleaning" },
          includes: [{ ar: "المطبخ", en: "Kitchen" }],
          excludes: [],
          duration_minutes: 180,
          min_workers: 1,
          max_workers: 3,
          team_size_default: null,
          requires_equipment: false,
          materials_mode: "company_addon",
          is_active: true,
          is_bookable_online: true,
          sort_order: 0,
          cancellation_policy_id: null,
          reschedule_policy_id: null,
          refund_policy_id: null,
        },
      },
    });
    expect(JSON.stringify(built)).not.toContain("Owner request");
  });

  it("does not build a preview from invalid values", () => {
    expect(buildServicePreviewRequest("STANDARD_VISIT", { ...serviceToFormValues(service), duration_minutes: "200" })).toEqual({ ok: false });
  });

  it("previews an edited price row by id, amounts in fils", () => {
    const values = { ...priceToFormValues(null, "standard_visit"), amount: "130.50", zone_id: "2", day_of_week: "5" };
    expect(buildPricePreviewRequest("STANDARD_VISIT", 17, values)).toEqual({
      ok: true,
      request: {
        service_code: "STANDARD_VISIT",
        prices: [
          {
            id: 17,
            zone_id: 2,
            day_of_week: 5,
            valid_from: null,
            valid_to: null,
            unit: "per_worker_visit",
            amount_fils: 13050,
            vat_inclusive: true,
            priority: 0,
          },
        ],
      },
    });
  });

  it("previews a new price row without an id", () => {
    const built = buildPricePreviewRequest("STANDARD_VISIT", null, { ...priceToFormValues(null, "standard_visit"), amount: "99" });
    expect(built.ok && built.request.prices?.[0]).toEqual({
      zone_id: null,
      day_of_week: null,
      valid_from: null,
      valid_to: null,
      unit: "per_worker_visit",
      amount_fils: 9900,
      vat_inclusive: true,
      priority: 0,
    });
  });

  it("previews deleting a row", () => {
    expect(buildPriceDeletePreviewRequest("STANDARD_VISIT", 17)).toEqual({
      service_code: "STANDARD_VISIT",
      prices: [{ id: 17, delete: true }],
    });
  });
});
