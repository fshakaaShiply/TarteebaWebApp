import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CATALOG_ERROR_KEYS } from "@/lib/admin/catalog/fields";
import {
  ADDON_PERS,
  DISCOUNT_TYPES,
  MATERIALS_MODES,
  PLAN_KINDS,
  PRICE_UNITS,
  SERVICE_KINDS,
  WEEKDAYS,
} from "@/lib/admin/catalog/forms";
import { COMPENSATIONS, POLICY_TYPES } from "@/lib/admin/catalog/policyRules";
import { POLYGON_REASONS } from "@/lib/admin/geo";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { EXCLUSION_REASONS, HOLDER_TYPES, RULE_SOURCES, SLOT_REASONS, SLOT_STATUSES } from "@/lib/admin/ops/capacity";
import { OPS_ERROR_KEYS } from "@/lib/admin/ops/fields";
import { DRIVER_STATUSES, VEHICLE_STATUSES } from "@/lib/admin/ops/fleet";
import { RULE_PRECEDENCE } from "@/lib/admin/ops/scheduling";
import { EMPLOYMENT_STATUSES, LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/admin/ops/workforce";
import type { SettingDraftError } from "@/lib/admin/settings";
import { SETTING_OPTIONS } from "@/lib/admin/settings";
import ar from "./ar.json";
import en from "./en.json";

// Operations enum labels looked up at runtime (admin.ops.enums.<group>.<value>, see _ops/opsText.ts).
const OPS_ENUMS: Record<string, readonly string[]> = {
  employmentStatus: EMPLOYMENT_STATUSES,
  leaveType: LEAVE_TYPES,
  leaveStatus: LEAVE_STATUSES,
  vehicleStatus: VEHICLE_STATUSES,
  driverStatus: DRIVER_STATUSES,
  slotStatus: SLOT_STATUSES,
  slotReason: SLOT_REASONS,
  exclusion: EXCLUSION_REASONS,
  holderType: HOLDER_TYPES,
  ruleSource: RULE_SOURCES,
};

// Enum labels looked up at runtime (admin.catalog.enums.<group>.<value>, see catalogText.ts).
const CATALOG_ENUMS: Record<string, readonly (string | number)[]> = {
  kind: SERVICE_KINDS,
  materials: MATERIALS_MODES,
  unit: PRICE_UNITS,
  per: ADDON_PERS,
  discountType: DISCOUNT_TYPES,
  planKind: PLAN_KINDS,
  policyType: POLICY_TYPES,
  compensation: COMPENSATIONS,
  weekday: WEEKDAYS,
};

/*
 * The admin panel looks up some message keys dynamically (navigation, setting labels, editor errors). These tests
 * make sure every one of them exists in both languages, so a missing key never shows up as a raw key.
 */

function get(messages: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), messages);
}

// Settings seeded by the API (app/Modules/Settings/SettingsDefaults.php) plus live_out.window from spec §21.
const SETTING_KEYS = [
  "locale.default",
  "digits.style",
  "vat.rate_percent",
  "currency",
  "timezone",
  "slots.standard",
  "live_out.block_scope",
  "live_out.window",
  "booking.hold_minutes",
  "booking.confirmation_sla_minutes",
  "booking.booking_horizon_days",
  "booking.min_lead_time_hours",
  // Phase 2 (R-13, §8.2, LeaveRules)
  "booking.working_hours",
  "calendar.public_holidays",
  "availability.limited_threshold",
  "leave.max_range_days",
  "leave.backdate_days",
  "leave.max_ahead_days",
  "travel.buffer_minutes",
  "arrival.grace_minutes",
  "reminder.before_arrival_minutes",
  "otp.ttl_seconds",
  "otp.resend_seconds",
  "otp.max_attempts",
  "otp.max_sends_per_hour",
  "otp.lockout_minutes",
  "auth.supported_country_codes",
  "auth.staff_lockout_attempts",
  "auth.staff_lockout_minutes",
  "auth.staff_lockout_account_ceiling",
  "auth.staff_lockout_account_window_minutes",
  "auth.staff_lockout_account_minutes",
  "auth.staff_trusted_network_days",
  "auth.staff_idle_timeout_minutes",
  "auth.two_factor_required_roles",
  "legal.terms_version",
  "legal.privacy_version",
  "subscription.horizon_weeks",
  "subscription.renew_days_before",
  "payments.mode",
  "payments.auth_validity_days",
  "rating.low_threshold",
  "waitlist.notify_batch",
  "coupons.allow_stacking",
  // Phase 3 (Booking, Fleet, Scheduling visits, Notification, Payment)
  "booking.alternative_proposal_hours",
  "booking.manual_payment_hold_minutes",
  "round.allowed_late_minutes",
  "round.dropoff_dwell_minutes",
  "visit.auto_start_after_min",
  "visit.auto_complete_grace_minutes",
  "reminder.day_before_time",
  "notifications.sms_on_confirm",
  "refund.estimated_arrival_text",
];

const DRAFT_ERRORS: SettingDraftError[] = [
  "required",
  "int",
  "int_min",
  "money",
  "money_precision",
  "money_negative",
  "text_required",
  "option",
  "list_empty_item",
  "list_duplicate",
  "json",
  "json_array",
  "json_object",
  "time_format",
  "time_order",
  "hours_format",
  "hours_order",
  "date_format",
  "date_duplicate",
  "time",
  "bilingual_required",
];

describe.each([
  ["ar", ar],
  ["en", en],
])("admin messages (%s)", (_, messages) => {
  it("label every navigation entry", () => {
    const keys = ADMIN_NAV.flatMap((m) => [m.labelKey, ...(m.children ?? []).map((c) => c.labelKey)]);
    for (const key of keys) expect(get(messages, `admin.nav.${key}`), key).toEqual(expect.any(String));
  });

  it("label and describe every setting", () => {
    for (const key of SETTING_KEYS) {
      expect(get(messages, `admin.settings.keys.${key}.label`), key).toEqual(expect.any(String));
      expect(get(messages, `admin.settings.keys.${key}.description`), key).toEqual(expect.any(String));
    }
  });

  it("name every option of select-type settings", () => {
    for (const { messageKey, values } of Object.values(SETTING_OPTIONS)) {
      for (const value of values) {
        expect(get(messages, `admin.settings.options.${messageKey}.${value}`), value).toEqual(expect.any(String));
      }
    }
  });

  it("explain every settings editor error", () => {
    for (const error of DRAFT_ERRORS) expect(get(messages, `admin.settings.errors.${error}`), error).toEqual(expect.any(String));
  });

  it("explain every catalog form error", () => {
    for (const key of [...CATALOG_ERROR_KEYS, "invalid"]) {
      expect(get(messages, `admin.catalog.errors.${key}`), key).toEqual(expect.any(String));
    }
  });

  it("explain every polygon problem", () => {
    for (const reason of POLYGON_REASONS) {
      expect(get(messages, `admin.zones.polygonReasons.${reason}`), reason).toEqual(expect.any(String));
    }
  });

  it("label every catalog enum value", () => {
    for (const [group, values] of Object.entries(CATALOG_ENUMS)) {
      for (const value of values) {
        expect(get(messages, `admin.catalog.enums.${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
      }
    }
  });

  it("have the customer preview copy for every unit and materials mode", () => {
    for (const unit of PRICE_UNITS) expect(get(messages, `admin.catalog.customer.unit.${unit}`), unit).toEqual(expect.any(String));
    for (const mode of MATERIALS_MODES) {
      expect(get(messages, `admin.catalog.customer.materials.${mode}`), mode).toEqual(expect.any(String));
    }
  });

  it("name every rules section the policy editor requires", () => {
    for (const type of POLICY_TYPES) expect(get(messages, `admin.catalog.common.policy.${type}`), type).toEqual(expect.any(String));
  });

  it("explain every operations form error", () => {
    for (const key of OPS_ERROR_KEYS) expect(get(messages, `admin.ops.errors.${key}`), key).toEqual(expect.any(String));
  });

  it("label every operations enum value and short weekday", () => {
    for (const [group, values] of Object.entries(OPS_ENUMS)) {
      for (const value of values) {
        expect(get(messages, `admin.ops.enums.${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
      }
    }
    for (let day = 0; day < 7; day++) expect(get(messages, `admin.ops.weekdaysShort.${day}`), String(day)).toEqual(expect.any(String));
  });

  it("explain every step of the slot rule order", () => {
    for (const step of RULE_PRECEDENCE) {
      expect(get(messages, `admin.scheduling.rules.precedence.steps.${step}`), step).toEqual(expect.any(String));
    }
  });
});

describe("Live-out day counts use plural rules", () => {
  // Seeded plans (CatalogSeeder): trial day 1 day / 0 rest days, monthly 26 days / 1 rest day a week.
  const cases = {
    en: {
      "liveOut.daysValue": ["1 day a month · no rest day a week", "26 days a month · 1 rest day a week", "2 days a month · 2 rest days a week"],
      "customer.planDays": [
        "1 service day a month · no rest day a week",
        "26 service days a month · 1 rest day a week",
        "2 service days a month · 2 rest days a week",
      ],
    },
    ar: {
      "liveOut.daysValue": ["يوم واحد شهريًا · بلا يوم راحة أسبوعيًا", "26 يومًا شهريًا · يوم راحة واحد أسبوعيًا", "يومان شهريًا · يوما راحة أسبوعيًا"],
      "customer.planDays": [
        "يوم خدمة واحد شهريًا · بلا يوم راحة أسبوعيًا",
        "26 يوم خدمة شهريًا · يوم راحة أسبوعيًا",
        "يوما خدمة شهريًا · يوما راحة أسبوعيًا",
      ],
    },
  } as const;

  it.each(["en", "ar"] as const)("%s", (locale) => {
    const t = createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.catalog" });
    const values = [
      { days: 1, rest: 0 },
      { days: 26, rest: 1 },
      { days: 2, rest: 2 },
    ];
    for (const [key, expected] of Object.entries(cases[locale])) {
      // Digits may be Latin or Arabic-Indic depending on the runtime's ICU data for "ar"; compare in Latin.
      const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
      expect(values.map((v) => latin(t(key as "liveOut.daysValue", v))), key).toEqual(expected);
    }
  });
});
