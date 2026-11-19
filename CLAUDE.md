# Tarteeba Web (Next.js 16)

One Next.js app with three areas on `tarteeba.shiplytechnologies.com` (decision R-03):
- `/` customer web pages shown in the app's WebView: policies, help, account deletion, e-mail verified, data copy download, payment return (spec §3.2, D-16)
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
  (refunds.create without bookings.cancel) resolves a cancellation review with a refund, capped by the booking's
  `refundable_fils` (null: nothing taken, no amount asked); A09's nav and the overview link the review queue
  (`?cancel_review=1`; the overview's card is the summary's `cards.cancellation_reviews`, null = hidden; the nav marks
  one entry as the page, by path and the query an entry names: `activeNavHref`). The wizard offers "company brings the materials" only with materials included or the
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
  override. No maps key yet: stops show as an ordered list with an SVG sketch of the order. Slot, driver and van pickers
  outside A11 and fleet read the pick-lists (`_ops/options.ts` `useSlotPickList`, `useDriverPickList`,
  `useVehiclePickList`: GET /admin/slot-templates/options, /admin/drivers/options and /admin/vehicles/options, active
  ones offered, a chosen inactive one kept and marked), so trips.manage alone can draft, pick a driver and change a van;
  adding a stop still lists the day board's visits (`_ops/daySlots.ts` `useDayVisits`, schedule.view). The draft result
  names each extra round the API added because a van's round had already left (`follows_round {id, plate_no}`: on the
  same van or another free one, R-19; still a draft to check and publish), and the round's panel names it from the
  stored link after a reload. Departure times become instants through the zone
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
  note when `requires_text`; the refunds list filters by all of them. Every reason shown is the API's label (refund
  rows, and credit notes' `reason_label`): the web has none of its own. The refund dialog (`payments/[id]/RefundDialog.tsx`) checks the
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
- **Subscriptions touch points (Phase 4, W2):** the nav entry A08 (`SUBSCRIPTIONS_READ`: subscriptions.view or .manage; its pages are W1's `/admin/subscriptions`, addressed by the numeric id like the API). A02: the summary's `cards.subscription_requests` (`overview/SubscriptionRequestsCard.tsx`, null = hidden), `quick_stats.subscriptions_cancelled`, four subscription alert types whose links (`list: subscription|subscriptions`) and entities open A08 (`lib/admin/dashboard.ts`, `alerts.ts`). A failed payment or refund alert (`list: payment`, sent to payments.view only) opens A09's `/admin/finance/payments/{id}`, else the A08 page its `details.subscription` names, and the row links that subscription too (`dashboardAlertHref`, `alertSubscription`). The bell (`alertHref`) rewrites the API's `/admin/payments/{id}` to `/admin/finance/payments/{id}` for payments.view and `/admin/invoices/{id}` to `/admin/finance/invoices/{id}` for `DOCUMENTS_READ`, from the session's `canAny`. A03: the `kind` filter (`series` = every subscription visit), `SeriesLabel` ("Subscription TRS-… · visit 3 of 8") from the booking's `subscription` block, and no cancel or reschedule on a series visit (`isSeriesVisit`, a link to A08 instead). A04: a `live_out` marker names the customer (null without a customer-reading permission: the reference instead, P4-256) and window and links to A08. A series visit dropped on another date or slot is moved from A08: `RescheduleHandoff.tsx` links to `seriesMoveHref` (`lib/admin/subscriptions/handoff.ts`: `/admin/subscriptions/{id}?move={booking id}&on={date served now}&date={drop date}&slot={drop slot}`); A08's `page.tsx` reads it with `parseSeriesMove`, opens on the Visits tab, and `_components/MoveHandoff.tsx` finds the visit by booking among that day's visits, opens "Edit this visit" once filled with the drop (`MoveVisitDialog` `initial`), then drops the parameters from the address; a visit not found or not movable gets a notice and no dialog. Nothing moves until staff confirm. A09: a `subscription_period` payable links to A08 by `payable.subscription.id`; period invoices and their credit notes show `subscription` (reference and supply period) and link to A08 by `subscription.id` (`SubscriptionRef` in `finance/_components/FinanceParts.tsx`, P4-248, P4-254); the A08 list searched by the reference (`?q=`) is only the fallback for `id: null`. A credit note without `booking_reference` names its subscription, and the credit note search takes TRS-/TRL- references. Cache: A08 writes also refresh A09 (`useSubscriptionRefresh`), and A09 refunds and the booking refresh of A03/A04 (`useBookingRefresh`) refresh A08 (`subscriptionKeys.all`). A11: the notification templates' `subscriptions` group (`TEMPLATE_GROUPS`, after payments); plans show `active_contracts` / cap, the cap-reached badge and the window-vs-slot warning, packages the `subscription_sellable` warning; settings editors for the design 8.3 keys (`int_list`, `weekdays`, quarter-hour time, int ranges in `lib/admin/settings.ts`).
- **Finance Phase 5 (W1):** all calls are in `src/lib/admin/finance/endpoints.ts` (the older A09 ones stay in `endpoints.ts`),
  their error codes in `finance/errors.ts` (`useFinanceError()`: our words with the API's figures, then `admin.errors`).
  Reconciliation (`finance/reconciliation`, `[id]`): runs list (background poll every 5 s while one is in flight), fetch
  and upload dialogs (replace + reason offered on 409 RECONCILIATION_RUN_EXISTS), run page (facts, `RunTotals` in three
  columns with the server's differences, five item tabs in the URL, `ResolveItemDialog`, `ReopenItemDialog`, recheck,
  replace). A resolution sends the item's version (If-Match) and an Idempotency-Key per body; the three that move money
  (`allowed_resolutions[].moves_money`) confirm the provider line's exact amount first and send it as
  `expected_amount_fils`, 409 TERMS_CHANGED puts the API's amount on screen and asks again. Refund operations
  (`refunds/_components/RefundOpsDialogs.tsx`: record the provider's answer, "Provider paid after all"; `ClearReviewDialog`
  for payment and refund flags) follow the same rules; a refund to the customer's balance offers none of them. Those
  dialogs act on a copy of their record (`_components/useSeenRecord.ts`): the page passes the row it holds now, and only
  after the API says the record moved (409 STALE_VERSION, NOT_FLAGGED, REFUND_NOT_OPEN/NOT_FAILED/OPEN) and the page read
  it again does the copy take the new facts and version (`RecordMovedNotice`: check and confirm again, or "no longer
  needs this action"); a refused version is never resent. The refund
  dialog offers card or balance only while `/public/config` says `wallet.enabled`. Exports: `src/components/admin/ExportButton.tsx`
  + `src/lib/admin/exports.ts` (POST, poll as a background read every 2 s up to 3 min, then the signed link; hidden without
  `reports.export`) and `finance/exports`. `finance/_components/WalletPanel.tsx` is the A07 "Balance" tab W3 mounts
  (`showWalletPanel()` says when). The balance adjustment has no If-Match, so its Idempotency-Key store belongs to the
  panel, not the dialog (`lib/admin/finance/walletKeys.ts`: one per customer and type, `holdAfterUnknown`, kept in this
  tab's sessionStorage like the refund key, `heldAttempts.ts`): a reopened dialog offers "Send the earlier … again". A
  timestamp shown as a day (a credit's expiry) goes through `text.instantDate` (its Dubai date), never `text.date`. Messages `admin.finance.{reconciliation,exports,wallet,errors,refundOps,clearReview}`;
  enum coverage in `finance-messages.test.ts`. Test fixtures: `src/test/financeFixtures.ts`.
- **Quality Phase 5 (W2, A10):** `src/app/admin/(panel)/quality` — the inbox (`QualityInboxScreen`: complaints, support requests and low-rating follow-ups in one list, counts as shortcut buttons, filters in the URL through `lib/admin/quality/filters.ts` and the finance `useUrlFilters`, read again every 20 s as a background poll; from 1280 px a row opens the case in a side pane, below it the row links `/admin/quality/{id}`; "Take" reads the case and assigns it only while nobody holds it, the row has no version), the case page (`ComplaintCaseScreen` / `CaseView`: thread with public replies and internal notes apart, timeline toggle, `ReplyComposer`, handling controls with If-Match, `ResolveDialog`, close, reopen, withdraw), the accountant's queue (`quality/compensations`) and the ratings (`quality/ratings`, drawer, exclusion). Calls are in `lib/admin/quality/endpoints.ts`, shapes in `quality/types.ts` (the generated schema types these answers loosely), error words in `quality/errors.ts` (`useQualityError()`), form checks in `quality/forms.ts`, the SLA chip model in `quality/sla.ts` (`components/admin/SlaChip` counts down with `useNow`; `ThreadBubble` is the message bubble). Money: a refund or a credit is only PROPOSED in `ResolveDialog` (the accountant approves; the second step shows the exact money, each type is offered only as the case's `compensation_options` say, the amount is capped by `max_fils`); a free visit is booked at once (needs bookings.create_manual) from the case's own `free-visit/availability`. `ApproveCompensationDialog` sends `expected_amount_fils` + the version + a key and shows 409 TERMS_CHANGED as a new amount to confirm; the quality dialogs act on a copy of their record (`useSeenRecord` from finance) and never resend a refused version (STALE_VERSION). Files go up first through `adminUpload` (`uploadCaseFile`), stay attached across a retry, a PDF only on an internal note; their signed links are shown only while valid (`AttachmentLink`) and `onRefresh` reads the case again. A03: `bookings/[id]/QualityCard` (the booking's `quality` block) and `OpenComplaintDialog` ("Open complaint", staff-logged case, window override reason offered after 422 COMPLAINT_NOT_ALLOWED window_closed). Nav: A10 has Inbox, Ratings and Compensation (`QUALITY_READ`), and `/admin/quality` left `PAGES_NOT_BUILT_YET`. Messages `admin.quality.*`; enum coverage in `quality-messages.test.ts`; fixtures `src/test/qualityFixtures.ts` (keep them in the API's shapes: a slot's `name` is `{ar, en}`, shown with `text.name`). The side pane renders `CaseView key={id}` (and `CaseBody` is keyed by the case), so a draft or a dialog never moves to another case; a row click the unsaved-changes guard already held (`defaultPrevented`) is left to the guard, closing the pane over a draft asks (`ReplyComposer onDraftChange`), opening moves focus to the pane (an h2 under the page's h1) and closing gives it back to the row. All three timed reads (inbox, case, compensation queue) pass `{ background: true }`. Lists of names use `text.list` (the `admin.ui.listSeparator`), never a literal "، ". The payment link opens A09's list on the payment's ULID taken from the API's `link` (A09's `reference` filter matches a payment ULID or the provider's reference, not a booking reference).
- **Customers Phase 5 (W3, A07 and the customer web):** `src/app/admin/(panel)/customers` — the list (`CustomersScreen`: GET /admin/customers by `q`, `status`, `sort` in the URL, never a `phone` parameter: the API answers 422 USE_LOOKUP_ENDPOINT, the exact-phone lookup is the manual booking's; a deleted row is «Deleted customer» with no contact, a pending deletion shows `deletion_on`), the profile (`[id]/CustomerDetailScreen`, addressed by ULID: profile card, recent bookings and subscriptions merged by date, notes, addresses; tabs Payments (`links.payments`), Quality (`links.complaints`), Balance (W1's `WalletPanel` while `showWalletPanel()` of the wallet read says so, same query key), Privacy) and the privacy queue (`privacy-requests`). Other modules' lists are read through the profile's `links` (`fetchLinked`: the link's own path and params, so the customer id is in the form each list takes; a link is null without that list's permission, which is what hides a tab). Calls are in `lib/admin/customers/endpoints.ts`, error words in `customers/errors.ts` (`useCustomerError()`), form checks in `customers/forms.ts` (`FormProblem` carries a field error out of a mutation so nothing is sent), statuses in `customers/status.ts`. Block, unblock and the address block send the record's version as If-Match and need customers.view besides customers.block (P5-C95); the dialogs act on a copy (`useSeenRecord`) and never resend a refused version; the answer of a block is the whole profile and replaces the cached one (`useCustomerRefresh`). The block dialog says what a block does and does not do (P5-C10) and lists the open bookings and subscriptions it finds among the activity table's rows (`isOpenBooking`: held is not open; `isOpenSubscription`: pending_payment is not, P5-C92). A staff-filed privacy request (`CreatePrivacyRequestDialog`): the registered-phone proof is the code staff send (`POST …/privacy-requests/otp` with `type`) and the caller reads back, a visit or letter needs a document reference of 10 to 500 characters; a deletion first reads `deletion-impact` and is refused while items are open, with links (`DeletionItems`), and 409 DELETION_BLOCKED shows its items. The queue cancels with a reason and the request's version, lists the `impact_snapshot` as «cancelled, not restored» (P5-C15), hides cancel once the API's `actions.cancel` is false (erasure started, P5-C51) and retries failed ones. `CustomerLink` is used in A03 (list, detail), A08 (detail), A09 (payments list and page, refunds list; the API's `ulid`, a numeric id stays text); `CustomerBlockedBanner` shows on A03 and A08 from `customer.status`. The A08 history words `customer_blocked` / `address_blocked` (`history.values.autoRenewReason`). The top bar's search also opens `/admin/customers?q=` for customers.view. Nav: A07 has the list and the queue, A11 gained the legal pages and the FAQ; `/admin/customers` left `PAGES_NOT_BUILT_YET`. **A11 content:** `settings/pages` (per slug the published version, drafts and history; "New version" copies the published text; `[id]` editor with Arabic and English tabs and a live preview through `renderLegalText`, only changed fields are sent with If-Match, publish needs a reason and says that terms and privacy ask everyone to accept again, the cancellation page may quote no percentage: `quotesFigures` stops it before the API's 422 PAGE_FIGURES_NOT_ALLOWED, a published or superseded version is read-only) and `settings/faq` (active switch, move up/down sends the whole order, placeholders `{{confirmation_sla}}` and `{{refund_estimated_arrival}}` checked first, limit 100); calls in `lib/admin/legal/endpoints.ts`. **Customer web** (`src/app/(customer)`, the app's WebView, D-16): `policies/[slug]`, `help`, `account-deletion`, `email-verified`, `privacy-export`. Each speaks `?lang=ar|en` (Arabic by default, not the cookie: the app and the SMS / e-mail links carry no cookie) in a `CustomerPageShell` that sets `lang` and `dir` on its wrapper and links the other language with the other parameters kept. The server reads (`lib/server/legal.ts`: `getLegalPage`, `getFaq`, revalidate 300, an unknown slug is a 404 without calling the API) go to a presentational `*View` taking its translator, so tests render them without the server. Legal text is plain text (`# ` heading, `- ` bullet, blank line = paragraph) rendered by `lib/legal/renderLegalText.tsx`, shared with the A11 preview, never as HTML. `privacy-export/PrivacyExportFlow` (client): posts the link's `expires` and `signature` to `/backend/api/v1/public/privacy-exports/{id}/otp`, then with the code to `/download`, without cookies, and follows the signed URL once; the URL is never shown or kept. `getPublicConfig()` also reads `privacy.deletion_grace_days`. Messages `admin.customers.*`, `admin.privacy.*`, `admin.legal.*`, `admin.faq.*`, `customerWeb.*`; enum and error coverage in `customers-messages.test.ts`; fixtures `src/test/customerFixtures.ts`.
- **Tests:** `renderWithProviders()` in `src/test/render.tsx` for component tests.
