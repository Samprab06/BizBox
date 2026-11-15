# BizBox

**Find the right storefront before you sign the lease.**

BizBox helps someone opening a **service business** (a coffee shop, quick-service food,
a salon or barber, or a fitness studio) choose a retail space to lease in **Houston** or
**Los Angeles**. Instead of gut feel and a broker's pitch, it ranks real for-lease spaces
for that founder's business and shows why each one ranks where it does.

**Live app:** https://usebizbox.app (built for HackPrinceton).

The output is a **ranking with ranges, never a sales forecast**. Every number records where
it came from: `costar`, `public`, `founder` or `default`.

## How it works

1. **Onboarding.** A short guided flow, one question per screen, captures the founder's
   concept, category, city, budget, price tier, customers, hours, staff and must-haves. The
   intake agent can also take the brief in conversation, by text or voice.
2. **Candidate spaces.** For-lease retail spaces come from the licensed CoStar dataset.
3. **Catchment.** Each space gets a catchment built from public Census, LODES workplace and
   Overture competitor data.
4. **Customer panel.** A panel of simulated local customers (TypeSafe Jev) says where they would
   go, how often and when. A Huff gravity model is the labelled fallback.
5. **Demand and simulation.** Their answers become a demand model and seeded customer arrivals,
   and a queue simulation plays out a day at the shop and its monthly economics.
6. **Decision.** Spaces are compared with ranges and sensitivity tests, station and staffing
   experiments are run, and a grounded location plan is written from the results.

## What you can do in the app

| Screen      | Route (`/projects/<projectId>/…`) | What it shows                                                                          |
| ----------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| Onboarding  | `intake`                          | Guided BizBox setup; the detailed form is at `intake?mode=form`.                       |
| Workspace   | `workspace`                       | City and budget header, the selected space, and the Text/Voice assistant.              |
| Map         | `map`                             | Candidate spaces that fit the brief.                                                   |
| Site detail | `sites/<siteId>`                  | One space: listing facts, catchment, customer insights and provenance.                 |
| Comparison  | `comparison`                      | The decision-first ranking with ranges, robustness and the consultant's investigation. |
| Replay      | `replay`                          | A simulated day at one space, customer by customer.                                    |
| Simulator   | `simulator`                       | The 3D city view (Vexcel tiles) with customer trips, live stats and experiments.       |
| Plan        | `plan`                            | A printable location plan built only from the stored comparison.                       |

The seeded example project is `houston-coffee`. A first visit to `/start` creates a project of its own (`POST /api/projects`, an ID like `p-0123456789abcdef0123`) and opens its onboarding; the device remembers that ID so a returning founder resumes it.

## Landing design checkpoint

The **BizBox** homepage at `/` presents the café decision story: business setup, two Houston locations, the modeled morning, consultant tradeoffs, an interior preview and the one/two-counter experiment. **Open BizBox** goes through `/start` to create or resume the visitor’s own project.

`/landing-story` mirrors the story for review; `/landing-demo` and the earlier `/landing-preview/index.html` remain available. See the [current landing handoff](design/landing/guided-demo/location-story.md) for motion behavior, illustrative data assumptions and verification.

## Stack

- **Next.js** (App Router) in **TypeScript** `strict` mode, styled with **Tailwind CSS**,
  hosted on **Vercel**. One app: route handlers under `app/api/`, no separate backend, no Python.
- **Postgres with PostGIS** on **Neon**, accessed with **Drizzle**.
- **`deepagents`** with an OpenAI model for the intake agent and the consultant.
- **TypeSafe Jev** for the simulated customer panel; **Capital One Nessie** (sandbox) for the
  consultant's simulated cash-buffer check.
- **Cesium + Vexcel** 3D tiles for the city simulator; **Three.js** for the replay floor plan.
- **Zod** contracts in `lib/contracts/`, **Vitest** and **Playwright** for tests, **pnpm**.

All simulation code is pure TypeScript and uses the seeded generator in `lib/sim/random.ts`,
never `Math.random`, so the same inputs always give the same results.

## Quick start

**Prerequisites:** Node.js 22 or 24, and pnpm 11.25.0 (`npm install -g pnpm@11.25.0`).

```bash
git clone https://github.com/Samprab06/BizBox.git
cd BizBox
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. The example screens, offline tests and the production build all run
without any credentials or database.

### Environment variables

Put values in `.env.local`, which is gitignored. Never commit secrets. `.env.example` lists every name.

| Variable                                                    | Needed for                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                              | Postgres with PostGIS: live listings, comparisons, investigations, scenarios. `/api/health` checks it. |
| `OPENAI_API_KEY`                                            | The intake agent, consultant and voice. Structured form edits work without it.                         |
| `OPENAI_MODEL`                                              | Optional model override (default `gpt-6-luna`).                                                        |
| `OPENAI_REALTIME_MODEL`, `OPENAI_VOICE_TRANSCRIPTION_MODEL` | Optional voice model overrides.                                                                        |
| `JEV_API_KEY`, `JEV_BASE_URL`, `JEV_MODEL`                  | Live Jev customer panel. Without a key, comparisons use the labelled Huff fallback.                    |
| `JEV_CONCURRENCY`, `JEV_BUNDLE_ORDERS`                      | Jev request ceiling (default 32, adaptive on 429). `JEV_BUNDLE_ORDERS=1` bundles the option orders (off).  |
| `VEXCEL_API_KEY`                                            | 3D city tiles in the simulator (served through a CDN-cached proxy).                                    |
| `NESSIE_API_KEY`, `NESSIE_BASE_URL`                         | The consultant's read-only simulated cash-buffer tool ([details](docs/integrations/nessie.md)).        |
| `MATTERPORT_SDK_KEY`, `MATTERPORT_API_TOKEN`                | Interior scans (fixture-first; licensed display stays off until data terms are cleared).               |
| `SCENARIO_RUN_BUDGET_UNITS`                                 | Per-project scenario run budget per rolling 24 h (default 1200).                                       |
| `CENSUS_API_KEY`, `DUCKDB_BIN`                              | Data-loading scripts only.                                                                             |
| `POSTGRES_*`, `CONTAINER_*`                                 | The local Docker/Podman PostGIS setup.                                                                 |

All keys are server-only; none are exposed to the browser.

### Database

Set `DATABASE_URL`, then run `pnpm db:migrate`. `pnpm db:generate` creates a migration after a
schema change. Migrations change the target database, so confirm the target first.

### Run locally with Docker

The checked-in `compose.yaml` supports native ARM64 and amd64 PostGIS 16/3.x.
Configure ignored `.env.local` with the local database settings, install DuckDB
for the one-off public-data conversion, and place the licensed kit at
`costar-hackathon-kit/`. Then:

```sh
pnpm db:up
pnpm db:load
docker compose --profile app up -d --build --wait
pnpm db:verify
```

The loader includes migrations and prints actual SQL counts. A second run reuses
download caches and replaces rows. Ports bind to localhost, and no env files or
datasets enter app images. `pnpm db:down` preserves the named volume; destructive
`pnpm db:reset --confirm` requires explicit confirmation. Full setup, Podman
support and native alternatives: [Local PostGIS](docs/local-postgis.md).

To create the fictional Nessie demo account (one customer, $50,000 of simulated cash), run
`pnpm nessie:seed --dry-run` and then `pnpm nessie:seed --confirm`. It refuses to run in CI and
reuses its records on later runs.
Add `--with-activity` (`pnpm nessie:seed --confirm --with-activity`) to also create fixed fictional
deposits, purchases and bills, so the consultant's cash card shows non-zero flows. It writes only to
a demo account with no existing activity.

The consultant's planner is also told to state a recommended site's customer-panel result together
with its Nessie cash scenario (coverage and interval) in one finding.

## Scripts

| Command                          | What it does                                                         |
| -------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev` / `pnpm start`        | Dev server with hot reload / serve the production build.             |
| `pnpm build`                     | Production build, the same one Vercel runs.                          |
| `pnpm lint`, `pnpm typecheck`    | ESLint; Next.js route types plus `tsc --noEmit`.                     |
| `pnpm test`                      | Vitest, offline by default.                                          |
| `pnpm test:e2e`                  | Playwright (chromium, webkit, mobile-chrome and API projects).       |
| `pnpm format` / `format:check`   | Prettier.                                                            |
| `pnpm db:*`                      | Migrations, local PostGIS up/down/reset, data load and verification. |
| `pnpm jev:record`, `nessie:seed` | Key-gated helpers for recording Jev examples and seeding Nessie.     |

Every PR must pass `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.

## Deployment

Vercel deploys **production from `main` only**; PR branches don't deploy. Functions run in
`iad1`, next to the Neon database. A push to `main` that only changes docs or tests skips the
build. See [CI and deployment](docs/ci.md) for required checks and secret scanning.

## Repo layout

```
app/
  (pages)/projects/[projectId]/  intake, workspace, map, sites, comparison, replay, simulator, plan
  api/                            route handlers: sites, comparisons, investigations, projects
                                  (intake, scenarios, station experiments), voice, vexcel, integrations
components/                      screens: onboarding, intake, workspace-screen, map, site,
                                  comparison, decision, insights, replay, simulator, city, plan, voice
lib/
  contracts/     shared Zod schemas
  agent/         intake agent, consultant planner and tools
  data/          CoStar and public-data loaders
  panel/         personas and the Jev client (with a Postgres cache)
  demand/        Jev behaviour table or Huff fallback, seeded arrivals
  sim/           queue engine, economics, seeded RNG
  evaluation/    comparison, sensitivity and robustness
  scenario/      immutable scenarios and budgeted runs
  insights/, layout/, interior/, nessie/, voice/, export/, db/, client/
drizzle/         migrations
docs/            design notes and integration specs
tests/           Playwright specs (tests/e2e) and manual computer-use scripts (tests/manual)
AGENTS.md        rules for every contributor, human or agent
```

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. Work is planned in **Linear** (team **HAC**), one ticket per
task, and agents coordinate on the Agent Board (ticket **HAC-6**). Branch from a fresh `main`
using the ticket's branch name, and open a PR titled `[HAC-n] <ticket title>` with `Fixes HAC-n`
in the body. Never force-push to `main`.

CoStar data comes from the licensed hackathon kit and is never committed; only aggregate
counts appear in docs.
