# HackPrinceton: where should my shop go?

People opening a new **service business** (a coffee shop, quick food, a salon or barber, a
fitness studio) have to pick a retail space to lease, usually from gut feel and a broker's
pitch. This app ranks real for-lease spaces in **Houston** and **Los Angeles** for one
founder's business, and shows why each one ranks where it does.

For each candidate space, the app:

1. collects the founder's plan in an intake conversation (category, price, stations, budget);
2. pulls for-lease retail spaces from CoStar;
3. builds the space's catchment from public census, workplace and competitor data;
4. polls a panel of simulated local customers (TypeSafe Jev) on where they'd go, how often and when;
5. turns their answers into a demand model and seeded customer arrivals;
6. runs a queue simulation of a day at the shop, then works out monthly economics;
7. compares the spaces, tests how sensitive the ranking is to each assumption, and writes a
   location plan grounded in those results.

The output is a **ranking with ranges, never a sales forecast**. Every number records where it
came from: `costar`, `public`, `founder` or `default`.

**Demo flow:** Intake → Map of candidate spaces → Site detail → Comparison → Replay of a
simulated day. Today the screens run on a fixture project, `houston-coffee`. The full design is
in the mega doc, `final/MEGADOC.md`.

## Stack

- **Next.js** (App Router) in **TypeScript** `strict` mode, styled with **Tailwind CSS**,
  hosted on **Vercel**. One app; no separate backend and no Python.
- **Postgres with PostGIS** (Neon through Vercel), accessed with **Drizzle**.
- **`deepagents`** (JavaScript) for the orchestrator agent.
- **TypeSafe Jev** over its REST API for the simulated customer panel.
- **Zod** for shared request and response types, **Vitest** for tests, **pnpm** for packages.

## Quick start

### Prerequisites

- **Node.js 20.9 or newer** (Next.js 16 needs it).
- **pnpm 9**. The lockfile is pnpm 9 format. If you don't have it:

  ```bash
  npm install -g pnpm@9
  ```

### Install and run

```bash
git clone https://github.com/Samprab06/HackPrinceton.git
```

```bash
cd HackPrinceton
```

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm dev
```

Open http://localhost:3000. It redirects to the intake screen of the `houston-coffee` fixture
project.

### Environment variables

Put values in `.env.local`. It's gitignored; never commit secrets. `.env.example` lists the names.

| Variable | Used by | Needed for |
|---|---|---|
| `JEV_API_KEY` | `lib/panel/jev-client.ts` | Live calls to the Jev customer panel. Without it, the panel runs on recorded responses and the live test is skipped. |
| `JEV_BASE_URL` | `lib/panel/jev-client.ts` | The Jev endpoint (to be confirmed in HAC-14). |

The app and the full test suite run with neither set.

### Database

**There's no database step yet.** The current app runs entirely on fixtures. The Postgres
schema, Drizzle migrations and the `DATABASE_URL` variable arrive with HAC-9 (app foundation);
this section will then gain the setup command.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Starts the Next.js dev server with hot reload, on port 3000 by default. |
| `pnpm lint` | Runs ESLint over the repo with the Next.js config (`eslint.config.mjs`). |
| `pnpm typecheck` | Generates Next.js route types (`next typegen`), then type-checks everything with `tsc --noEmit`. |
| `pnpm test` | Runs every Vitest test (`*.test.ts`) once. All of them run offline. |
| `pnpm build` | Builds the production app, the same build Vercel runs. |
| `pnpm start` | Serves the production build from `pnpm build`. |

Every PR must pass `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.

## Repo layout

```
app/                  Next.js routes (App Router)
  (pages)/projects/[projectId]/
                      intake, map, sites/[siteId], comparison, replay screens
  api/                route handlers (not yet created; the API lands with later tickets)
components/           React components (intake screen, workspace view)
lib/
  contracts/          shared Zod schemas for requests and responses
  sim/                queue engine, monthly economics, the shared seeded RNG (random.ts)
  demand/             demand model: Jev behaviour table or Huff fallback, then seeded arrivals
  panel/              persona builder and the Jev customer panel client
  client/             browser-side API client and workspace routes
final/                the project mega doc (MEGADOC.md)
AGENTS.md             rules for every contributor, human or agent
```

All simulation code in `lib/` is pure TypeScript and uses the seeded generator in
`lib/sim/random.ts`, never `Math.random`, so the same inputs always give the same results.

## Contributing

Read [`AGENTS.md`](AGENTS.md) before you start. In short:

- Work is planned in **Linear**, team **HAC**. Each ticket is labelled `agent:<name>` for its owner.
- Agents coordinate on the **Agent Board**, the comments on Linear ticket **HAC-6**.
- Branch from a fresh `main` using the ticket's branch name, which contains the ticket ID
  (for example `hac-12-...`).
- Open a PR titled `[HAC-12] <ticket title>` with `Fixes HAC-12` in the body. Keep PRs small, and
  never force-push to `main`.
