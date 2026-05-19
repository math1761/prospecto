# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Structure

Monorepo — microservice architecture on Cloudflare:

- `frontend/` — Next.js 16 App Router + OpenNext Cloudflare adapter
- `services/api/` — Hono API gateway · Drizzle ORM · PostgreSQL via Hyperdrive
- `services/ai/` — Hono · OpenRouter calls · email generation + scoring
- `services/mailer/` — Hono · Resend email dispatch · open tracking pixel
- `docker-compose.yml` — local PostgreSQL (port 5436)

## Commands

```bash
# Monorepo (repo root) — pnpm workspaces
pnpm install                     # install all packages

# Full stack dev (PostgreSQL + API/AI/mailer workers + Next.js)
pnpm dev                         # docker compose + workers + frontend
pnpm dev:app                     # workers + frontend only (DB must already run)

# Database (repo root)
docker compose up -d             # PostgreSQL on localhost:5436
docker compose down

# Frontend
pnpm dev:frontend                # Next.js dev server (Turbopack)
pnpm lint:frontend               # ESLint — NOT next lint (removed in v16)
pnpm cf:build                    # build with OpenNext for Cloudflare
pnpm cf:preview                  # local wrangler preview
pnpm cf:deploy                   # deploy to Cloudflare

# API service (services/api/)
pnpm dev:api                     # wrangler dev — Hyperdrive uses localConnectionString
pnpm deploy:api
pnpm db:generate                 # generate Drizzle migrations from schema
pnpm db:migrate                  # apply migrations to local PostgreSQL
pnpm db:push                     # push schema without migration file (dev only)
pnpm db:studio                   # Drizzle Studio UI

# AI service (services/ai/)
pnpm dev:ai                      # set OPENROUTER_API_KEY in .dev.vars

# Mailer service (services/mailer/)
pnpm dev:mailer                  # set RESEND_API_KEY, FROM_EMAIL, FROM_NAME in .dev.vars
```

## Next.js 16 — Breaking Changes

**This is Next.js 16, not the version in your training data.** Before writing any frontend code, read the relevant guide in `frontend/node_modules/next/dist/docs/`.

Critical differences from Next.js 15:

### Async Request APIs (fully breaking)
`cookies`, `headers`, `draftMode`, `params`, and `searchParams` are async-only — no sync fallback:

```tsx
// Required in Next.js 16
export default async function Page(props: PageProps<'/blog/[slug]'>) {
  const { slug } = await props.params
  const query = await props.searchParams
}
```

Run `npx next typegen` to generate `PageProps`, `LayoutProps`, `RouteContext` helpers.

### `middleware` → `proxy`
`middleware.ts` is deprecated; rename to `proxy.ts`. Export `proxy`, not `middleware`. The `edge` runtime is NOT supported in `proxy` (Node.js only). Config flag `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`.

### Linting
`next lint` is removed. Use `eslint` directly (already in `package.json` scripts). ESLint Flat Config format is now the default (`eslint.config.mjs`).

### Turbopack default
Both `next dev` and `next build` use Turbopack. Dev output goes to `.next/dev`. Custom `webpack` config breaks builds — migrate to Turbopack config or pass `--webpack` flag.

### Caching APIs
- `revalidateTag('tag')` → `revalidateTag('tag', 'max')` (second arg required)
- `unstable_cacheLife` / `unstable_cacheTag` → `cacheLife` / `cacheTag`
- `experimental.dynamicIO` → top-level `cacheComponents: true`
- PPR: `experimental.ppr` → `cacheComponents: true`
- New: `updateTag()` for read-your-writes semantics in Server Actions
- New: `refresh()` from `next/cache` to refresh client router from Server Actions

### Parallel Routes
All parallel route slots (`@slot`) require an explicit `default.js`. Builds fail without them.

### Other removals
- AMP support fully removed
- `serverRuntimeConfig` / `publicRuntimeConfig` removed — use `process.env` + `NEXT_PUBLIC_` prefix
- `next/legacy/image` deprecated — use `next/image`
- `images.domains` deprecated — use `images.remotePatterns`
- `devIndicators.appIsrStatus`, `buildActivity`, `buildActivityPosition` removed

### React Compiler
Stable but not default. Enable with `reactCompiler: true` in `next.config.ts`.

## Architecture

### Frontend
App Router with `(dashboard)` route group. Sidebar layout at `app/(dashboard)/layout.tsx`. Pages: `/` (overview), `/prospects`, `/campaigns`, `/templates`. Shared UI components in `components/ui/`. Tailwind v4. `@/` alias resolves from `frontend/`. OpenNext Cloudflare adapter: `open-next.config.ts` + `frontend/wrangler.jsonc`.

### Services (microservices)
Each service is a standalone Cloudflare Worker. They communicate via **Service Bindings** (zero-latency, private — no HTTP overhead).

| Service | Binds to | Role |
|---|---|---|
| `services/api` | `AI_SERVICE`, `MAILER_SERVICE`, `HYPERDRIVE` | REST API gateway + DB |
| `services/ai` | — | OpenRouter AI generation + scoring |
| `services/mailer` | — | Resend email sending + tracking pixel |
| `frontend` | `API_SERVICE`, `WORKER_SELF_REFERENCE` | Next.js SSR |

API entry: `services/api/src/index.ts`. Routes in `services/api/src/routes/`. DB schema: `services/api/src/db/schema.ts`. Client factory: `createDb(env)` in `services/api/src/db/client.ts` — always pass `prepare: false` to `postgres()` for Hyperdrive.

### Database — local vs production

| Environment | Connection |
|---|---|
| Local | Docker PostgreSQL via `localConnectionString` in `services/api/wrangler.jsonc` |
| Production | Cloudflare Hyperdrive — replace `REPLACE_WITH_HYPERDRIVE_ID` after `wrangler hyperdrive create` |

Local DB: `postgresql://prospecto:prospecto@localhost:5436/prospecto`

### Secrets (`.dev.vars` per service, never committed)
- `services/ai/.dev.vars`: `OPENROUTER_API_KEY`
- `services/mailer/.dev.vars`: `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `API_BASE_URL`
