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
- **No timed polling** of ordinary admin routes: they count as staff activity (StaffIdleTimeout) and would keep an idle
  tab signed in past spec §13.2. Only the bell's `GET /admin/alerts` is passive; other data refreshes on window focus,
  after actions and with a Refresh button.
- **Shared zone filter:** the top bar's zone (`useAdminZone()`, `src/lib/admin/zone.tsx`) is the zone of the overview,
  the bookings list and the capacity view; a `zone_id` in a link is adopted into it. The alerts bell polls
  `GET /admin/alerts` every 20 s (D-11, `src/lib/admin/alerts.ts`) and announces new alerts in a live region. The top
  bar's search (from md) opens `/admin/bookings?search=`.
- **Bookings (A02/A03):** `src/app/admin/(panel)/overview`, `bookings` (list, `[id]` page with actions and the
  assignment panel, `new` manual wizard); shared bits in `bookings/_components`. List filters live in the URL
  (`src/lib/admin/bookings/filters.ts`, the API's own parameter names), changed with `history.replaceState`.
- **Tests:** `renderWithProviders()` in `src/test/render.tsx` for component tests.
