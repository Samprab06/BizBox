# HAC-9 verification and remaining acceptance

## Local candidate

The platform scaffold, ten shared contracts, synthetic fixtures, ten database tables, generated first migration and sanitized health endpoint are implemented locally. No GitHub publication, Neon provisioning, hosted migration, Vercel linking or deployment is included in this result. HAC-9 remains In Development until its external acceptance and PR handoff are completed.

## Checks

| Check                            | Result                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Pass, including a clean Git source export without `.env` files or provider keys.                     |
| `pnpm peers check`               | No peer dependency conflicts. Upstream ESLint/Drizzle deprecation warnings are documented in README. |
| `pnpm lint`                      | Pass with zero warnings.                                                                             |
| `pnpm typecheck`                 | Pass; generates Next.js route types before TypeScript so a clean checkout needs no prior build.      |
| `pnpm test`                      | 20 passing tests: 16 contract/fixture cases and 4 health cases.                                      |
| `pnpm format:check`              | Pass; existing team instruction files are excluded rather than rewritten.                            |
| `pnpm build`                     | Pass with no database or model credentials; `/` is static and `/api/health` is dynamic.              |
| `pnpm db:generate`               | No schema changes after the generated migration snapshot. No hosted database accessed.               |
| `git diff --check`               | Pass for the candidate.                                                                              |

The health tests were observed failing before implementation. Independent review reproduced two fixture coherence defects, then six failing regression cases were added before fixing them. Focused re-review confirmed both findings closed: every persona has behavior/stay lookup coverage, and destinations resolve within the current site's candidate/competitor universe.

## Real local database and HTTP checks

A disposable Docker database used PostgreSQL 17/PostGIS 3.5, with the image pinned to `postgis/postgis@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6` under `linux/amd64` emulation. It was bound only to loopback, used private temporary credentials, and held synthetic test data.

- Applied the generated migration through Drizzle to a fresh database created from `template0`; PostGIS and all ten application tables were present.
- Reran the migration safely without reapplying it.
- PostgreSQL rejected duplicate profile versions, nonpositive versions and a persona set referencing another project's profile. Test inserts were rolled back.
- Started the production Next.js server against controlled local configurations and requested both `/` and `/api/health`. The root page returned 200. Health returned 200 with connected PostGIS, 503 `DATABASE_NOT_CONFIGURED` without a URL, 503 `POSTGIS_UNAVAILABLE` for a reachable database without the extension, and 503 `DATABASE_UNAVAILABLE` for a failed connection. All health responses were `Cache-Control: no-store`; errors did not expose the connection URL or password.
- Local HTTP servers were stopped after the checks. These tests establish local behavior, not a hosted Neon connection or Vercel preview result.

## Integration and ownership

The manager integrated backend commits serially in the ticket worktree and performed a successful read-only merge preview against current `origin/main`. Concurrent PRs #4 (page shell), #5 (queue engine) and #6 (demand model) carry interim scaffold/configuration files. The board contract handoff calls for rebasing/reconciling those against HAC-9's foundation and retaining Yasser's product UI. The bootstrap placeholder uses `app/page.tsx`, avoiding a second `/` route in a route group. Cross-PR integration is not claimed as verified.

An unrelated local `AGENTS.md` edit appeared during the run. It was read, preserved and excluded from the ticket's commits. The user's original checkout and `IDEAS.md` were not modified by this ticket.

## Remaining acceptance

- Obtain explicit approval for GitHub publication and any later merge.
- Select/approve the actual Vercel project and Neon resource, confirm the plan and function limits, pull secrets privately, and apply the reviewed migration to the approved database.
- Verify `pnpm dev` after the bootstrap linking/environment prerequisites, a real hosted database health response, and an approved Vercel preview deployment.
- Reconcile concurrent PR scaffold files and adapt their interim contracts to the published shared interfaces before merging those feature branches.

The first-hour foundation merge requested by the ticket cannot be performed without Akshar's explicit approval. Local work is prepared for review; the ticket is not marked Done or In Review and no preview is claimed.
