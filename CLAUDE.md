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
