import type {
  CapacityView,
  DriverOption,
  DriverReport,
  PlanResult,
  Round,
  RoundStop,
  ScheduleGrid,
  ScheduleMonth,
  ScheduleRow,
  SlotTemplateOption,
  VehicleOption,
  VisitSummary,
} from "@/lib/admin/types";

// A04 schedule board and A06 trip planner shapes as the local API answers them (ScheduleBoard, RoundPresenter,
// DriverReportResource), on the seeded demo data: zone DEMO_BB, Morning (1) and Evening (2) slots, van DEMO-VAN-1.

const both = (en: string, ar = en) => ({ ar, en });

export const slots = [
  { id: 1, code: "MORNING", name: both("Morning", "الفترة الصباحية"), start: "10:00", end: "14:00", service_kind: "standard_visit" as const },
  { id: 2, code: "EVENING", name: both("Evening", "الفترة المسائية"), start: "15:00", end: "19:00", service_kind: "standard_visit" as const },
];

/** GET /admin/slot-templates/options: the two demo slots and a retired one (listed with is_active false). */
export const slotPickList = (): SlotTemplateOption[] => [
  ...slots.map((s) => ({ id: s.id, code: s.code, name: s.name, start_time: s.start, end_time: s.end, service_kind: s.service_kind, is_active: true })),
  { id: 3, code: "NIGHT", name: both("Night", "الفترة الليلية"), start_time: "20:00", end_time: "23:00", service_kind: "standard_visit", is_active: false },
];

/** GET /admin/vehicles/options: by plate; a van out of service is listed with is_active false. */
export const vehiclePickList = (): VehicleOption[] => [
  {
    id: 1,
    plate_no: "DEMO-VAN-1",
    seats: 7,
    status: "active",
    is_active: true,
    zone_id: 1,
    zone: { id: 1, code: "DEMO_BB", name: both("Business Bay & Downtown", "الخليج التجاري وداون تاون") },
    default_driver: { id: 1, name: "Test Driver" },
  },
  { id: 2, plate_no: "DEMO-VAN-2", seats: 7, status: "active", is_active: true, zone_id: null, zone: null, default_driver: { id: 2, name: "Test Driver 2" } },
  { id: 3, plate_no: "DEMO-VAN-3", seats: 10, status: "maintenance", is_active: false, zone_id: null, zone: null, default_driver: null },
];

/** GET /admin/drivers/options: by name, never contact data; a driver who can't take a round has is_active false. */
export const driverPickList = (): DriverOption[] => [
  { id: 3, name: "Retired Driver", status: "inactive", is_active: false, vehicle: null },
  { id: 1, name: "Test Driver", status: "active", is_active: true, vehicle: { id: 1, plate_no: "DEMO-VAN-1" } },
  { id: 2, name: "Test Driver 2", status: "active", is_active: true, vehicle: { id: 2, plate_no: "DEMO-VAN-2" } },
];

const worker = (id: number, name: string, zone = 1) => ({
  id,
  ulid: `01W${id}`,
  employee_no: `DEMO-W0${id}`,
  display_name: name,
  full_name: both(name),
  home_zone_id: zone,
  employment_status: "active" as const,
});

export const workers = {
  maria: worker(1, "Maria S."),
  siti: worker(2, "Siti R."),
  nirmala: worker(4, "Nirmala P."),
  tigist: worker(5, "Tigist B."),
  grace: worker(6, "Grace N."),
};

/** A visit card (VisitSummary). Default: TRB-R4RYSD, pending confirmation, morning, two cleaners missing. */
export const card = (over: Partial<VisitSummary> = {}): VisitSummary => ({
  id: 4,
  ulid: "01m5jxahxst3kdzw3s4ew8f7r7",
  version: 1,
  booking: {
    id: 4,
    ulid: "01m5jxahxpamqgkzzygcxp2vjr",
    reference: "TRB-R4RYSD",
    status: "pending_confirmation",
    status_label: both("Pending confirmation", "بانتظار التأكيد"),
    service_id: 1,
    preferred_worker_id: null,
  },
  service_date: "2026-10-24",
  slot_template_id: 1,
  start: "10:00",
  end: "14:00",
  zone_id: 1,
  area: "Business Bay",
  status: "scheduled",
  status_label: both("Scheduled", "مجدولة"),
  workers_count: 2,
  assigned_count: 0,
  missing: 2,
  vehicle_id: 1,
  workers: [],
  arrived_at: null,
  started_at: null,
  completed_at: null,
  late_minutes: null,
  ...over,
});

/** TRB-K2M9QX: confirmed, evening, Maria and Nirmala assigned (version 3). */
export const confirmedCard = (): VisitSummary =>
  card({
    id: 7,
    version: 3,
    booking: {
      id: 9,
      ulid: "01BK9",
      reference: "TRB-K2M9QX",
      status: "confirmed",
      status_label: both("Confirmed", "مؤكد"),
      service_id: 1,
      preferred_worker_id: null,
    },
    slot_template_id: 2,
    start: "15:00",
    end: "19:00",
    area: "Downtown",
    status: "worker_assigned",
    status_label: both("Cleaners assigned", "تم تعيين العاملات"),
    assigned_count: 2,
    missing: 0,
    workers: [
      { id: 1, display_name: "Maria S.", full_name: both("Maria Santos"), assigned_at: "2026-10-23T08:00:00+00:00" },
      { id: 4, display_name: "Nirmala P.", full_name: both("Nirmala Perera"), assigned_at: "2026-10-23T08:00:00+00:00" },
    ],
  });

const row = (w: ReturnType<typeof worker>, dates: string[], per: (date: string) => Partial<ScheduleRow["days"][number]>): ScheduleRow => ({
  worker: w,
  days: dates.map((date) => ({ date, markers: [], cards: [], ...per(date) })),
});

const head = (view: "day" | "week" | "month", date: string, from: string, to: string) => ({
  view,
  date,
  from,
  to,
  timezone: "Asia/Dubai",
  filters: { zone_id: null, service_id: null, slot_template_id: null, worker_id: null, status: [] },
});

function gridRows(dates: string[]): ScheduleRow[] {
  const on = (date: string) => date === "2026-10-24";
  return [
    row(workers.maria, dates, (d) => ({ cards: on(d) ? [confirmedCard()] : [] })),
    row(workers.nirmala, dates, (d) => ({ cards: on(d) ? [confirmedCard()] : [] })),
    row(workers.siti, dates, (d) => ({ markers: on(d) ? [{ code: "rest_day", label: both("Rest day", "يوم راحة") }] : [] })),
    row(workers.tigist, dates, () => ({})),
    row(workers.grace, dates, (d) => ({ markers: on(d) ? [{ code: "live_out", label: both("Live-out (whole day)") }] : [] })),
  ];
}

export const dayBoard = (over: Partial<ScheduleGrid> = {}): ScheduleGrid => ({
  ...head("day", "2026-10-24", "2026-10-24", "2026-10-24"),
  view: "day",
  dates: ["2026-10-24"],
  slots,
  rows: gridRows(["2026-10-24"]),
  unassigned: [card()],
  ...over,
});

const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

export const weekBoard = (): ScheduleGrid => ({
  ...head("week", "2026-10-24", "2026-10-19", "2026-10-25"),
  view: "week",
  dates: WEEK,
  slots,
  rows: gridRows(WEEK),
  unassigned: [card()],
});

export const monthBoard = (): ScheduleMonth => ({
  ...head("month", "2026-10-24", "2026-10-01", "2026-10-31"),
  view: "month",
  days: Array.from({ length: 31 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
    const busy = date === "2026-10-24";
    return {
      date,
      bookings: busy ? 2 : 0,
      visits: busy ? 2 : 0,
      unassigned: busy ? 1 : 0,
      capacity: [
        { slot_template_id: 1, code: "MORNING", booked_units: busy ? 4 : 0, assigned_units: 0, pool_units: 0, remaining_units: 6, used_percent: busy ? 40 : 0 },
        { slot_template_id: 2, code: "EVENING", booked_units: 0, assigned_units: 0, pool_units: 0, remaining_units: 0, used_percent: null },
      ],
    };
  }),
});

/** The capacity view the reschedule dialog's slot picker reads (both slots open). */
export const capacityView = (date: string): CapacityView => ({
  date,
  zone: { id: 1, code: "DEMO_BB", name: both("Business Bay & Downtown") },
  timezone: "Asia/Dubai",
  travel_buffer_minutes: 30,
  live_out_block_scope: "whole_day",
  slots: slots.map((s) => ({
    slot_template_id: s.id,
    code: s.code,
    name: s.name,
    start: s.start,
    end: s.end,
    service_kind: "standard_visit",
    is_active: true,
    service: { id: 1, code: "STANDARD_VISIT" },
    status: "available",
    reason: null,
    available_workers: 5,
    reserved_workers: 0,
    reserved_competing: 0,
    remaining_workers: 5,
    vehicles: [],
    max_single_vehicle_free: 7,
    total_free_seats: 7,
    bookings_count: 0,
    max_bookings: null,
    rule: null,
    max_workers_fit: 5,
    holds: { active: 0, converted: 0 },
    zone_workers: 6,
    excluded: {},
  })),
});

// ---- A06 trip planner -----------------------------------------------------------------------------------------------

const stop = (over: Partial<RoundStop> = {}): RoundStop => ({
  id: 101,
  sequence: 1,
  status: "pending",
  status_label: both("Waiting"),
  visit_id: 7,
  visit_status: "worker_assigned",
  booking: { id: 9, reference: "TRB-K2M9QX", status: "confirmed", workers_count: 2 },
  address: { area: "Downtown", building: "Tower 1", unit_number: "1203" },
  slot_start: "10:00",
  slot_end: "14:00",
  planned_eta: "2026-10-24T05:40:00+00:00",
  eta_local: "09:40",
  late_by_minutes: 0,
  wait_minutes: null,
  arrived_at: null,
  completed_at: null,
  failure_reason: null,
  done: false,
  workers: [
    { id: 1, display_name: "Maria S." },
    { id: 4, display_name: "Nirmala P." },
  ],
  ...over,
});

/** A planned drop-off on DEMO-VAN-1 (7 seats, version 5): stop 2 arrives 22 minutes after its start (late). */
export const round = (over: Partial<Round> = {}): Round => ({
  id: 11,
  ulid: "01RND11",
  date: "2026-10-24",
  kind: "dropoff",
  kind_label: both("Drop-off", "توصيل"),
  status: "planned",
  status_label: both("Planned", "مخطط لها"),
  slot: { id: 1, code: "MORNING", name: both("Morning", "الفترة الصباحية"), start: "10:00", end: "14:00" },
  zone: { id: 1, code: "DEMO_BB", name: both("Business Bay & Downtown", "الخليج التجاري وداون تاون") },
  vehicle: { id: 1, plate_no: "DEMO-VAN-1", model: "Toyota Hiace", seats: 7, status: "active" },
  driver: { id: 1, name: "Test Driver", phone: "+971500000009", status: "active" },
  follows_round_id: null,
  follows_round: null,
  planned_depart_at: "2026-10-24T05:15:00+00:00",
  depart_local: "09:15",
  planned_end_at: "2026-10-24T07:00:00+00:00",
  end_local: "11:00",
  published: false,
  published_at: null,
  departed_at: null,
  completed_at: null,
  cancelled_at: null,
  cancel_reason: null,
  seats: { total: 7, used: 2, free: 5 },
  stops: [
    stop(),
    stop({
      id: 102,
      sequence: 2,
      visit_id: 8,
      booking: { id: 12, reference: "TRB-P7Q1ZZ", status: "confirmed", workers_count: 1 },
      address: { area: "Business Bay", building: "Villa 22" },
      planned_eta: "2026-10-24T06:22:00+00:00",
      eta_local: "10:22",
      late_by_minutes: 22,
      workers: [{ id: 5, display_name: "Tigist B." }],
    }),
  ],
  passengers: [
    { seat_no: 1, worker_id: 1, display_name: "Maria S.", full_name: both("Maria Santos"), visit_id: 7 },
    { seat_no: 2, worker_id: 4, display_name: "Nirmala P.", full_name: both("Nirmala Perera"), visit_id: 7 },
  ],
  last_action: null,
  warnings: [
    {
      type: "late_stop",
      stop_id: 102,
      sequence: 2,
      visit_id: 8,
      eta_local: "10:22",
      late_by_minutes: 22,
      allowed_late_minutes: 15,
      message: both(
        "Stop 2 arrives at 10:22, 22 minutes after the start of the slot; the allowed delay is 15 minutes. Reorder the stops or move the booking to another vehicle.",
        "تصل المحطة 2 في 10:22، أي بعد بداية الفترة بـ 22 دقيقة، والتأخير المسموح به 15 دقيقة. أعد ترتيب المحطات أو انقل الحجز إلى سيارة أخرى.",
      ),
    },
    {
      type: "team_not_aboard",
      stop_id: 102,
      sequence: 2,
      visit_id: 8,
      worker_ids: [5],
      message: both("Stop 2: 1 worker(s) of the team have no seat.", "المحطة 2: عدد عاملات الفريق بلا مقعد 1."),
    },
  ],
  version: 5,
  created_at: "2026-10-23T10:00:00+00:00",
  updated_at: "2026-10-23T10:00:00+00:00",
  ...over,
});

export const planResult = (): PlanResult => ({
  date: "2026-10-24",
  slot_template_id: 1,
  rounds: [{ ...round(), plan: "created" }],
  unplanned: [
    {
      visit_id: 4,
      booking_id: 4,
      booking_reference: "TRB-R4RYSD",
      kind: null,
      reason: "booking_not_confirmed",
      details: { booking_status: "pending_confirmation" },
      message: both("The booking is not confirmed yet.", "الحجز لم يُؤكَّد بعد."),
    },
  ],
  already_planned: [],
});

export const driverReport = (over: Partial<DriverReport> = {}): DriverReport => ({
  id: 31,
  type: "delay",
  type_label: both("Delay", "تأخير"),
  status: "open",
  status_label: both("Open", "مفتوح"),
  reason: "Traffic on Al Khail Road",
  eta_delay_min: 15,
  round: { id: 11, date: "2026-10-24", kind: "dropoff", slot_template_id: 1, slot_code: "MORNING", vehicle: { id: 1, plate_no: "DEMO-VAN-1" } },
  stop: { id: 102, sequence: 2, visit_id: 8, area: "Business Bay" },
  driver: { id: 1, name: "Test Driver" },
  handled_by: null,
  handled_at: null,
  handled_note: null,
  created_at: "2026-10-24T05:50:00+00:00",
  updated_at: "2026-10-24T05:50:00+00:00",
  ...over,
});
