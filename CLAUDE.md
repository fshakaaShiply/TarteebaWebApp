# Tarteeba Web (Next.js 16)

One Next.js app with three areas on `tarteeba.shiplytechnologies.com` (decision R-03):
- `/` customer web pages shown in the app's WebView: policies, help, invoices, payment return (spec §3.2, D-16)
- `/admin` admin and operations panel, screens A01–A13 (spec §17)
- `/driver` optional fallback for the driver interface (the main driver UI is in the mobile app, R-04)

**Read first:** the build spec `TARTEEBA_BUILD_SPEC.md` in the docs workspace
(`/mnt/c/Users/firas/workspace/Tarteebah`), then `docs/decisions.md` in `TarteebaBackendApp` (owner rulings win).
Screen designs: `/mnt/c/Users/firas/workspace/Tarteebah/docs/design/screens/` (Admin*.dc.html). Rebuild with our
components and tokens; don't copy inline styles.

This is Next.js 16: read `node_modules/next/dist/docs/` before using an API you're unsure of
(e.g. `middleware` is now `proxy`; Cache Components is off in this app).

## Commands (WSL)
```
pnpm dev            # http://localhost:3000 (API at http://localhost:8000)
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm gen:api        # regenerate src/lib/api/schema.d.ts from ../TarteebaBackendApp/openapi.json
pnpm sync:design    # regenerate src/theme/tokens.{css,ts} from the design tokens.json
scripts/deploy-web.sh   # build + upload + PM2 reload on staging
```

## Conventions
- Arabic first, RTL default. Locale from the `NEXT_LOCALE` cookie (no URL prefix). Every string in
  `src/messages/ar.json` and `en.json` (test enforces parity).
- Logical Tailwind utilities only: `ms-/me-/ps-/pe-/start-/end-`, never `ml-/mr-/left-/right-`.
- Colours, radius, shadows and type styles come from tokens (`bg-petrol-700`, `rounded-lg`, `shadow-card`,
  `text-ar-title`). Don't hard-code hex values.
- Data via the typed `api` client (`src/lib/api/client.ts`) + React Query. Forms: react-hook-form + zod.
- The API is the security gate: hide what a role can't do, but never rely on hidden UI.
- Every data screen handles loading, empty, error, offline and permission-denied states.
- Money arrives as integer fils; format with the shared helpers, never float math.

## Admin panel (`/admin`)
- **API proxy:** the browser only calls this web origin: `/backend/api/*` and `/backend/sanctum/csrf-cookie`. The
  Route Handler `src/app/backend/[...path]/route.ts` (logic and tests in `src/lib/server/apiProxy.ts`) streams them to
  **`API_INTERNAL_URL`** (server-side env read at request time, API origin without a path; local
  `http://localhost:8000`, staging `https://tarteeba-api.shiplytechnologies.com`); every other `/backend/*` path is a
  404. It forwards cookies and the admin client's headers, sets `X-Forwarded-For` to the admin's own address
  (CF-Connecting-IP, X-Real-IP, then the last X-Forwarded-For hop) and `X-Forwarded-Host/Proto/Port` to the web
  origin, and returns every `Set-Cookie`. A production server without `API_INTERNAL_URL` refuses to start
  (`src/instrumentation.ts`); on staging it comes from `shared/.env.production`, which `scripts/deploy-web.sh` checks,
  copies in and verifies after deploy (`/backend/api/v1/public/health`). The API must list the web host in
  `SANCTUM_STATEFUL_DOMAINS`, and must trust the hop from this server for `X-Forwarded-For` (behind Cloudflare it
  otherwise sees the web server's address).
- **Client:** `adminApi` + `unwrap()` + `AdminApiError` in `src/lib/admin/client.ts` (CSRF cookie, X-XSRF-TOKEN,
  Accept-Language, 419 retry, 401/2FA redirects). One function per endpoint in `src/lib/admin/endpoints.ts`; response
  types in `src/lib/admin/types.ts` (the generated schema types some admin payloads loosely). Query keys start with
  `"admin"` (`src/lib/admin/keys.ts`). Versioned edits always send `If-Match` (decision P1-04).
- **Session:** `useAdminSession()` gives `me`, `can()`, `canAny()`, `logout()`. Pages wrap their content in
  `<RequirePermission anyOf={[...]}>`; the nav (`src/lib/admin/nav.ts`) hides what the user lacks.
- **Routes:** `src/app/admin/(auth)` (login, forgot/reset password) and `src/app/admin/(panel)` (signed-in shell).
- **UI kit:** `src/components/admin` (Button, TextField, Select, Switch, Dialog/ConfirmDialog, Drawer, DataTable,
  FilterBar, Tabs, Toast, states, StatusBadge, MoneyField, ChipsInput, LtrText, UnsavedChanges). Error copy:
  `useAdminErrorMessage()`; API field messages go through `useServerFieldMessage()` (falls back to our copy while the
  API answers in another language). Small controls carry the `touch-target` utility (44px hit area).
- **Unsaved edits:** full-page forms call `useUnsavedChanges(isDirty)`; links then ask before leaving and the browser
  warns on reload/close (`UnsavedChangesProvider` in the admin shell).
- **Money routes (Phase 3):** confirm, reject, reschedule, cancel, reschedule-request approval and the manual booking
  send an `Idempotency-Key` from `useIdempotencyKeys()` (`src/lib/admin/idempotency.ts`: one UUID per request body,
  kept for a retry after a 5xx or lost answer, new after any stored 2xx/4xx answer). The proxy forwards that header.
  The manual booking (no If-Match) uses `holdAfterUnknown`: after an unknown outcome the key stays even if the form
  changes. Booking-page dialogs work on a snapshot of the booking taken when they open (its version is the If-Match).
- **Timed refresh only as background polls:** every timer-driven read sends `X-Background-Poll: 1` (`backgroundPoll()`
  in `src/lib/admin/client.ts`, forwarded by the proxy), so the API checks the idle timeout but does not count it as
  staff activity and an idle tab still signs out after spec §13.2's time; a 401 SESSION_EXPIRED from a poll goes to
  sign-in like any other. Loads the user starts (opening a page, a filter, Refresh, window focus, after actions) never
  carry it. `useBackgroundRefresh()` (`src/lib/admin/backgroundRefresh.ts`) re-reads one loaded query on a timer, stops
  while the tab is hidden, never runs under a user's load, keeps the page on a failed poll and only replaces the
  cached data (dialogs keep their snapshot). A poll that changes the data also makes the reads that change sets off
  passive until the user next acts (pointer, key, click, coming back to the tab): such a query passes
  `{ background: isPollDriven(queryClient) }` (the booking page's visit candidates and refunds). Polled today: the bell (`GET /admin/alerts`, 20 s, D-11), the overview's
  summary and alerts (`OVERVIEW_REFRESH_MS`, 60 s) and the booking page (`BOOKING_REFRESH_MS`, 30 s); the spec names no
  interval for the last two. Any new timer uses the same header, never a plain `refetchInterval`.
- **Shared zone filter:** the top bar's zone (`useAdminZone()`, `src/lib/admin/zone.tsx`) is the zone of the overview,
  the bookings list, the capacity view, the schedule and the trip planner; a `zone_id` in a link is adopted into it. The
  schedule and the trip planner also keep it in their URL (`_ops/zoneParam.ts` `useZoneInUrl`: a change of the shared
  zone is written back as `zone_id`, so a copied link opens the same zone). The alerts bell polls
  `GET /admin/alerts` every 20 s (D-11, `src/lib/admin/alerts.ts`) and announces new alerts in a live region. The top
  bar's search (from md) opens `/admin/bookings?search=`.
- **Bookings (A02/A03):** `src/app/admin/(panel)/overview`, `bookings` (list, `[id]` page with actions and the
  assignment panel, `new` manual wizard); shared bits in `bookings/_components`. List filters live in the URL
  (`src/lib/admin/bookings/filters.ts`, the API's own parameter names, slot/worker/driver included), changed with
  `history.replaceState`. Slot pickers use the slot pick-list by service kind (`_components/SlotSelect.tsx`); whether
  a time fits is the dry runs' answer: the wizard's summary (`POST /admin/bookings/preview`, debounced, the customer
  found by `GET /admin/customers?phone=` once the number is complete, a non-UAE one once the field is left; Next waits
  while 429s keep it from answering), the alternatives check (Send only on `can_send`) and the reschedule preview. The
  dry runs' keys sit outside `["admin", "bookings"]`, so an action's refresh never sends them again (the customer
  lookups are only marked stale). Cancel and reschedule send the amounts their preview showed (`expected_*`);
  409 TERMS_CHANGED shows the new terms with the changes marked and needs a fresh confirm (new body, new key). Finance
  (refunds.create without bookings.cancel) resolves a cancellation review with a refund; A09's nav and the overview
  link the review queue (`?cancel_review=1`; the nav marks one entry as the page, by path and the query an entry
  names: `activeNavHref`). The wizard offers "company brings the materials" only with materials included or the
  MATERIALS add-on offered (D-02b), and marks the preview's 422 field errors on their fields.
- **Schedule (A04):** `src/app/admin/(panel)/schedule` (view, date, filters and zone in the URL,
  `src/lib/admin/schedule/board.ts`). A card dropped on another cleaner's cell at its own time, or moved with its Move
  dialog (the keyboard way), runs `POST /admin/schedule/validate-move` first and `POST /admin/schedule/move` (visit
  version as If-Match) only on `ok` or with an override reason (`schedule/moveFlow.ts`); a STALE_VERSION closes the
  dialog and reloads the board. A drop on another date or slot, in any row (its own too) or the unassigned lane, is a
  reschedule (the API answers 422 USE_RESCHEDULE to such a move): the booking's own `RescheduleBookingDialog` opens with
  the drop's date and time (`RescheduleHandoff.tsx`), saying that a cleaner it was dropped on is not added. A card's
  Review button opens the design's review panel (`ReviewDrawer.tsx`: the booking page's actions, assignment panel and
  notes, bookings.view). Booking links need bookings.view (HR reads the board without it). Focus follows a moved card to
  its new row (`useFocusRescue` with a function target; dialogs take a `returnFocusTo` getter).
- **Trip planner (A06):** `src/app/admin/(panel)/trips` (date, slot and zone in the URL; a draft's result and refusal
  show only on the date, slot and zone they ran for) and `trips/reports` (driver reports).
  Round dialogs work on a snapshot of the round (its version is the If-Match); a changed round answers the recomputed
  round, which replaces the cached one (`useRoundSaved()`). Seat limits are never overridable; team rules need an
  override. No maps key yet: stops show as an ordered list with an SVG sketch of the order. Slot and driver pickers
  outside A11 and fleet read the pick-lists (`_ops/options.ts` `useSlotPickList`, `useDriverPickList`: GET
  /admin/slot-templates/options and /admin/drivers/options, active ones offered, a chosen inactive one kept and
  marked), so trips.manage alone can draft and pick a driver; adding a stop still lists the day board's visits
  (`_ops/daySlots.ts` `useDayVisits`, schedule.view) and the van list needs fleet.manage or schedule.view. The draft
  result names each extra round the API added because a van's round had already left (`follows_round_id`: on the same
  van or another free one, R-19; still a draft to check and publish). Departure times become instants through the zone
  (`zonedDateTimeIso` in `src/lib/admin/format.ts`, spec §4.1), never a fixed offset.
- **Finance (A09):** `src/app/admin/(panel)/finance` — the landing page (`FinanceSummaryScreen`: the design's KPI
  cards from `GET /admin/finance/summary`, period in the URL, month to date by default, the API's 422 messages on the
  date fields, the shared zone for users who see the zone picker), payments (`payments/[id]` with the booking's
  reference, amounts, provider details, refunds with their credit note numbers, `payment.invoice` and the scrubbed event
  log; review/release reasons are the API's labels), refunds, tax invoices (`invoices/[id]`: supplier block with the R-16
  placeholders marked, lines, VAT, totals, credit notes, Download PDF, Resend; the list takes `payment_id`), credit notes
  and the documents Billing refused to issue (`billing-refusals`, retry with invoices.manage). List filters live in the
  URL (`src/lib/admin/finance/filters.ts` specs, `_components/useUrlFilters.ts`). Payment and refund states are always
  the provider's (API labels); a refund is "processing" until the provider says otherwise. Refund reasons come from
  `GET /admin/refund-reasons` (`_components/useRefundReasons.ts`): the dialog offers the `selectable` ones and needs a
  note when `requires_text`; the refunds list filters by all of them. Only the credit note pages still use our own
  reason labels (their resources carry the code alone). The refund dialog (`payments/[id]/RefundDialog.tsx`) checks the
  AED amount against `refundable_fils` and the reason against that list (`lib/admin/finance/refund.ts`), then confirms
  the exact amount; its Idempotency-Key uses `holdAfterUnknown` (no If-Match on
  refunds). The key store (`lib/admin/finance/refundKeys.ts`) lives above the page's loading/error switch and keeps the
  attempt being sent in this tab's sessionStorage, so a failed refresh or a reload never starts a second refund. The
  confirm step can't be passed by a repeated "Continue" (keyed buttons, focus on the summary, a click with detail > 1
  ignored, no close on an outside click). A refund the provider declines at once (201, failed) keeps the dialog open.
  A09 money always has two decimals (`formatAed(…, { fixed: true })`, P2-35), like the printed documents; narrow side
  cards use `<Facts columns={1}>` and long references `<Code wrap>`. PDFs come as 15-minute signed URLs, offered as a
  link once fetched.
- **Notification templates (A11):** `src/app/admin/(panel)/settings/notifications` (list grouped by event, Arabic and
  English side by side) and `[id]` (editor: placeholders as chips inserted at the caret, on/off, optional reason, a
  preview of the draft with sample values in both languages; only changed fields are sent, version as If-Match). The
  rules mirror the API (`lib/admin/notifications/templates.ts`). Phase 3 settings: `reminder.day_before_time` has a time
  editor, `refund.estimated_arrival_text` an Arabic + English pair (`lib/admin/settings.ts`).
- **Tests:** `renderWithProviders()` in `src/test/render.tsx` for component tests.
