# HackPrinceton

HackPrinceton project. Work is planned in Linear (team HAC) and built by humans and coding agents; see AGENTS.md.

## Local platform setup

Requires Node.js 22 or 24 and pnpm 11.25.0. The app uses the Next.js App Router, strict TypeScript, Tailwind, Zod and Drizzle/Postgres. Dependency versions and the lockfile are pinned; pnpm permits installation scripts only for esbuild.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

These offline checks must work without provider credentials. The product UI already merged on main is preserved; this change adds the shared platform foundation. ESLint 9.39.5 is pinned to satisfy the current Next.js lint plugins' peer ranges; npm reports its upstream support deprecation. Upgrade the plugin set together before moving to ESLint 10. Drizzle Kit also brings deprecated esbuild-kit transitive dependencies; no peer conflicts are being suppressed.

## Database and hosted setup

The intended hosted stack is a Vercel project with Neon Postgres through the Vercel Marketplace and PostGIS enabled. Creating/linking resources, remote migrations, deployments and publishing require Akshar's approval. No matching Vercel project was returned during the bootstrap lookup, so the actual project plan and preview deployment are not yet verified.

After approval, select the correct Vercel team/project, provision or connect Neon, verify the required environment variable names, and pull the environment privately. Keep secrets in ignored `.env.local` or provider environment settings; `.env.example` lists keys only. The Census key is reserved for data-loading scripts. Model keys are not used by the bootstrap, and the later agent ticket must choose its provider explicitly.

```sh
# Once the approved project/database linkage and environment are verified:
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Inspect the generated SQL before applying a migration. The first migration enables PostGIS, which requires an appropriately privileged database role. Migrations are an explicit setup operation, never executed automatically by the web app. Do not aim these commands at an unapproved or production database.

`GET /api/health` returns an uncached 200 only when PostgreSQL responds and PostGIS is enabled. Missing configuration, missing PostGIS or a connection failure returns sanitized 503 JSON with `code`, `message` and `field_errors`, plus dependency status. It never returns connection strings or raw provider errors. The client is server-only and uses a bounded single-connection pool, a five-second connection/query timeout, and no persistent runtime files.

## Function duration

The health route exports `maxDuration = 10` seconds. The actual Vercel project's plan/configuration remains unverified. The [published Fluid Compute limits](https://vercel.com/docs/functions/configuring-functions/duration), checked November 13, 2026, list Hobby at 300 seconds maximum and Pro/Enterprise at 800 seconds, with a conditional extended-duration beta. These are reference limits, not evidence of this project's entitlement. Verify deployed timeouts with `vercel inspect <deployment-url> --json` after an approved deployment. Long-running feature work must checkpoint into Postgres.

## Shared data and ownership

Shared Zod contracts live in `lib/contracts/`, database tables in `lib/db/schema.ts`, and explicitly synthetic examples in `fixtures/`. See `docs/tickets/HAC-9/contracts.md` for schema choices and fixture usage. Assumed values retain units, origin and evidence links; missing values are explicit unknowns, not zero. Synthetic defaults do not establish actual property availability or a revenue forecast.

Keep package/config and contract changes coordinated with Akshar. Yasser owns product pages/components, Samridh owns property/public data, and Frank owns panel/demand/simulation work under their respective tickets. See [the HAC-9 spec](docs/tickets/HAC-9/spec.md) and [implementation plan](docs/tickets/HAC-9/plan.md) for bootstrap boundaries and checks.
