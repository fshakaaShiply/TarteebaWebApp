import type { CustomerDetail, CustomerListItem, CustomerNote, PrivacyRequest } from "@/lib/admin/customers/types";
import type { ContentPage, FaqItem } from "@/lib/admin/legal/types";

/*
 * Fixtures of A07 and A11 in the shapes of contracts A4a §3 and A4b §3 (keep them in the API's shapes: a status label is
 * {ar, en}, a customer is addressed by ULID, a list link is {list, path, params}).
 */

export const CUSTOMER_ULID = "01JC0000000000000000000001";

const link = <L extends string, P extends string>(list: L, path: P, params: Record<string, string> = { customer_id: CUSTOMER_ULID }) => ({ list, path, params });

export function customerDetail(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: CUSTOMER_ULID,
    name: "Sara Ahmed",
    phone: "+971559871234",
    email: "sara@example.com",
    email_verified: false,
    locale: "ar",
    status: "active",
    status_label: { ar: "نشط", en: "Active" },
    version: 2,
    blocked: null,
    deletion: null,
    created_at: "2026-05-02T08:00:00+00:00",
    last_login_at: "2026-10-22T09:30:00+00:00",
    stats: {
      bookings_total: 14,
      bookings_cancelled: 1,
      bookings_open: 1,
      subscriptions_open: 1,
      subscriptions_total: 2,
      paid_total_fils: 312000,
      currency: "AED",
      avg_rating_given: { average: 4.8, count: 12 },
      complaints_open: 0,
      last_booking_on: "2026-10-24",
    },
    preferred_workers: [
      { id: "01JW0000000000000000000001", display_name: "Maria", times: 3 },
      { id: "01JW0000000000000000000002", display_name: "Joy", times: 2 },
    ],
    consents: {
      marketing: { accepted: false, updated_at: "2026-09-01T08:00:00+00:00" },
      analytics: { accepted: true, updated_at: "2026-09-01T08:00:00+00:00" },
      terms: { accepted_version: "2026-10", current_version: "2026-10", up_to_date: true },
      privacy: { accepted_version: "2026-09", current_version: "2026-10", up_to_date: false },
      card_on_file_count: 2,
    },
    addresses: [
      {
        id: "01JA0000000000000000000001",
        label: "Home",
        property_type: "villa",
        building: null,
        unit_number: "Villa 7",
        street: "Street 12",
        area_text: "Jumeirah 1",
        zone: { id: 3, name: { ar: "جميرا", en: "Jumeirah" } },
        is_default: true,
        is_blocked: false,
        blocked_reason: null,
        blocked_at: null,
        deleted: false,
        version: 4,
      },
      {
        id: "01JA0000000000000000000002",
        label: "Office",
        property_type: "office",
        building: "Tower B",
        unit_number: "12",
        street: null,
        area_text: "Business Bay",
        zone: null,
        is_default: false,
        is_blocked: true,
        blocked_reason: "Aggressive guard",
        blocked_at: "2026-10-01T08:00:00+00:00",
        deleted: false,
        version: 2,
      },
    ],
    privacy_requests: [
      { id: 12, type: "export", status: "completed", status_label: { ar: "مكتمل", en: "Completed" }, created_at: "2026-09-10T08:00:00+00:00", scheduled_for: null, completed_at: "2026-09-10T08:05:00+00:00" },
    ],
    notes_count: 2,
    links: {
      bookings: link("bookings", "/api/v1/admin/bookings"),
      subscriptions: link("subscriptions", "/api/v1/admin/subscriptions"),
      payments: link("payments", "/api/v1/admin/payments"),
      complaints: link("complaints", "/api/v1/admin/complaints"),
      ratings: link("ratings", "/api/v1/admin/ratings"),
      waitlist: link("waitlist", "/api/v1/admin/waitlist"),
      wallet: link("wallet", `/api/v1/admin/customers/${CUSTOMER_ULID}/wallet`, {}),
      privacy_requests: link("privacy_requests", "/api/v1/admin/privacy-requests", { q: CUSTOMER_ULID }),
    },
    actions: { block: true, unblock: false, add_note: true, block_address: true, privacy_request: true, marketing_opt_out: true },
    ...overrides,
  };
}

export function blockedCustomer(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return customerDetail({
    status: "blocked",
    status_label: { ar: "موقوف", en: "Blocked" },
    blocked: { reason: "Abuse towards a cleaner", at: "2026-10-20T05:00:00+00:00", by: { id: 7, name: "Huda" } },
    actions: { block: true, unblock: true, add_note: true, block_address: true, privacy_request: true, marketing_opt_out: true },
    ...overrides,
  });
}

export function customerRow(overrides: Partial<CustomerListItem> = {}): CustomerListItem {
  return {
    id: CUSTOMER_ULID,
    name: "Sara Ahmed",
    phone: "+971559871234",
    email: "sara@example.com",
    status: "active",
    status_label: { ar: "نشط", en: "Active" },
    created_at: "2026-05-02T08:00:00+00:00",
    last_booking_on: "2026-10-24",
    bookings_total: 14,
    open_bookings: 1,
    open_subscriptions: 1,
    privacy_pending: null,
    deletion_on: null,
    ...overrides,
  };
}

export function customerNote(overrides: Partial<CustomerNote> = {}): CustomerNote {
  return {
    id: 5,
    body: "Prefers a call after 4 pm. Side gate of the villa.",
    author: { id: 3, name: "Lina", roles: [{ key: "booking_coordinator", label: { ar: "منسقة الحجوزات", en: "Booking coordinator" } }] },
    created_at: "2026-10-12T06:14:00+00:00",
    ...overrides,
  };
}

export function privacyRequest(overrides: Partial<PrivacyRequest> = {}): PrivacyRequest {
  return {
    id: 21,
    ulid: "01JP0000000000000000000021",
    type: "delete",
    type_label: { ar: "حذف الحساب", en: "Account deletion" },
    status: "scheduled",
    status_label: { ar: "مجدول", en: "Scheduled" },
    source: "app",
    verification: "in_app_otp",
    verification_label: { ar: "رمز في التطبيق", en: "Code in the app" },
    verification_note: null,
    otp_verified_at: "2026-11-16T05:00:00+00:00",
    customer: { id: CUSTOMER_ULID, name: "Sara Ahmed", phone: "+971559871234", status: "pending_deletion", status_label: { ar: "الحذف قيد الانتظار", en: "Deletion pending" } },
    previous_customer_status: "active",
    impact_snapshot: {
      bookings: [{ ulid: "01JB0000000000000000000001", reference: "TRB-FZTVY8", fee_fils: 12000, refund_fils: 12000, payment: "refund" }],
      subscriptions: [{ ulid: "01JS0000000000000000000001", reference: "TRS-7K2M9Q", fee_fils: 0, clawback_fils: 0, refund_fils: 60000 }],
      refunds_in_flight: [],
      waitlist_closed: 0,
    },
    scheduled_for: "2026-11-23T05:00:00+00:00",
    waiting_on: [{ code: "refund_processing", label: { ar: "استرداد قيد المعالجة", en: "a refund in progress" } }],
    next_check_at: "2026-11-23T06:00:00+00:00",
    processing_started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    handled_by: null,
    handled_at: null,
    export: null,
    attempts: 0,
    failure_code: null,
    failure_label: null,
    failure_detail: null,
    erasure_log: null,
    version: 3,
    created_at: "2026-11-16T05:00:00+00:00",
    updated_at: "2026-11-16T05:00:00+00:00",
    actions: { cancel: true, retry: false },
    ...overrides,
  };
}

export function contentPage(overrides: Partial<ContentPage> = {}): ContentPage {
  return {
    id: 1,
    slug: "terms",
    version_label: "2026-10",
    effective_date: "2026-10-01",
    title: { ar: "الشروط والأحكام", en: "Terms and conditions" },
    body: { ar: "# القبول\nباستخدام التطبيق توافق على هذه الشروط.", en: "# Acceptance\nBy using the app you agree to these terms." },
    status: "published",
    status_label: { ar: "منشور", en: "Published" },
    published_at: "2026-10-01T05:00:00+00:00",
    published_by: { id: 2, name: "Omar" },
    version: 2,
    created_at: "2026-09-20T05:00:00+00:00",
    updated_at: "2026-10-01T05:00:00+00:00",
    ...overrides,
  };
}

export function faqItem(overrides: Partial<FaqItem> = {}): FaqItem {
  return {
    id: 1,
    question: { ar: "متى يتم تأكيد حجزي؟", en: "When is my booking confirmed?" },
    answer: { ar: "يؤكد فريقنا الحجز خلال {{confirmation_sla}}.", en: "Our team confirms within {{confirmation_sla}}." },
    sort_order: 10,
    is_active: true,
    version: 1,
    updated_at: "2026-10-01T05:00:00+00:00",
    ...overrides,
  };
}
