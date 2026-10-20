# Tarteeba Web

Next.js 16 app for Tarteeba (ترتيبة): customer web pages (`/`), admin panel (`/admin`) and a driver
fallback (`/driver`). Arabic RTL by default, English LTR.

## Local setup (WSL2 Ubuntu)

Requirements: Node 24 LTS, pnpm, and the API running locally (`TarteebaBackendApp`).

```bash
cp .env.example .env.local
pnpm install
pnpm dev     # http://localhost:3000, admin login at /admin/login
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Shared code

- `src/lib/api/schema.d.ts`: generated from the API's `openapi.json` (`pnpm gen:api`).
- `src/theme/tokens.*`: generated from the design system's `tokens.json` (`pnpm sync:design`).

Deploy to staging with `scripts/deploy-web.sh`. See `CLAUDE.md` for conventions.
