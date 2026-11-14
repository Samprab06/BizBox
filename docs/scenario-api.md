# Scenario history and execution API (HAC-81)

History operations use the immutable HAC-80 repository. Executions use HAC-22's
resumable evaluator, with durable checkpoints and budget reservations in
`scenario_runs`. No new runtime dependency or authentication policy is introduced.

## History

- `POST /api/projects/:projectId/scenarios`: create a root with `siteIds`,
  `profileVersion`, `label`, optional `overrides` and `layoutId`; or fork with
  `{ fromId, patch }`. Author defaults to founder. Agent changes require a
  rationale and preserve the scenario model's provenance validation.
- `GET /api/projects/:projectId/scenarios`: `{ tree: [{ scenario, children }] }`.
- `GET /api/projects/:projectId/scenarios/:id`: `{ scenario }`; `?against=:id`
  adds the diff from that version to this one, including a scoped layout diff.
- `POST .../scenarios/:id/revert-to`: `{ targetId, author?, rationale? }` creates a
  new child with the target's contents. Both previous versions remain intact.

IDs and timestamps are server generated. Forks, diffs, layout lookup and reverts
cannot cross projects. Patch fields are allowlisted and replace the whole overrides
object. There is no PATCH or DELETE route. Database foreign keys enforce project,
profile-version and selected-layout scope.

## Runs

`POST /api/projects/:projectId/scenarios/:id/run` accepts an optional JSON body:

```json
{
  "confirm": false,
  "demandSource": "huff",
  "idempotencyKey": "optional-client-request-id"
}
```

Huff is the default and makes no Jev call. Jev is an explicit opt-in through the
existing provider/cache path; missing Jev inputs retain the honest Huff fallback.
The exact saved profile version is loaded, not the latest profile. Hours, staffing,
average ticket, price tier, stations, demand scale and exact seed sets retain their
provenance. A selected layout controls station/queue capacity only at its own
shortlisted site. Wrong-category, wrong-site, missing layouts and conflicting
explicit station overrides are rejected. The stored assembly includes the immutable
scenario/layout snapshots; derived capacity is a model assumption with layout evidence.

Completed responses (201) include status succeeded, runId, scenarioId, comparisonId,
representative runIds, cached, costUnits and completedSiteIds. Metrics and events
remain on the existing comparison/site-run endpoints. Partial responses are 202.

- `GET .../scenarios/:id/runs/:runId` returns status.
- `POST .../scenarios/:id/runs/:runId/advance` resumes, with no body or `{}`.

Advancement uses a fenced lease and revision, checkpoints each completed site and
starts no new site after its 45-second work deadline. Routes have maxDuration 60.
A later advancement skips finished sites. A deterministic comparison ID lets a
retry after a comparison commit reuse it rather than write it twice.

Without an explicit idempotency key, immutable effective inputs supply a stable
key, so a transient failure can retry the same reservation. Equivalent active
repeats return the current run's status. Explicit keys distinguish client requests.
An equivalent completed parent/fork reuses its comparison at zero additional cost.
Labels, author, rationale and lineage do not invalidate an otherwise identical
execution; project, profile version, sites, overrides, layout and demand source do.

## Approved work budget

The lead's HAC-6 decision on 2026-11-14 sets these rules:

- Default 1,200 units per project, overridable by server environment variable
  `SCENARIO_RUN_BUDGET_UNITS` (nonnegative decimal integer, at most 10,000,000).
- Cost = sites × seeds × two day types. Default seed count is 30.
- Count reservations for non-cached scenario_runs in the rolling past 24 hours.
  Cache hits cost zero. Legacy rows default to zero; no historical cost is inferred.
- Before assembly or simulation, a transaction locks the project, deduplicates the
  request, checks the cache and atomically reserves the work units.
- Over-budget requests return 200 with
  `{ status: "needs_confirmation", costUnits, remainingUnits }` and do no work.
- Resending with confirm true permits execution and records its full cost. It does
  not change the budget. Reservations, including failed attempts, stay in the rolling
  count. Resuming a run is not charged again. Equivalent pending forks cannot start
  duplicate work.

Bodies are limited to 64 KiB. Invalid values/JSON return 422, missing scoped
resources 404, ownership conflicts 409 and unavailable dependencies a sanitized 503.
Status never returns credentials or raw checkpoints. Responses are private/no-store.

## Database and verification

Migration order: 0004_matterport_models → 0005_layouts → 0006_scenario-executions.
Migration 0006 adds reservation, cache, request, checkpoint and lease fields and
constraints/indexes. The lead applies hosted migrations after merge.

Offline tests cover immutability, scope, overrides/layouts, provenance, exact seeds,
cache reuse, confirmation/no-work behavior, retry and completed-site resume. SQL
integration tests cover concurrent reservations, rolling counts, revisions, leases
and scoped reads. Use an explicitly disposable loopback PostgreSQL with PostGIS:

```sh
RUN_SCENARIO_EXECUTION_DB_TESTS=1 \
SCENARIO_EXECUTION_TEST_DATABASE_URL=postgres://role:synthetic@127.0.0.1:5432/hac96_test \
pnpm exec vitest run lib/scenario/run-store-postgres.test.ts --maxWorkers=1
```

The role needs CREATEDB. Tests create/drop only their own random hac81_test database.
The Scenario database checks workflow supplies a fresh PostGIS 17 service and runs
scenario/layout/interior SQL tests without production secrets or data. The ordinary
lint, typecheck, full Vitest, build and client-bundle gates still apply.

Explicit seed identities also remain stable during bounded sensitivity sweeps: a smaller caller seed limit uses the original seed-set prefix, avoiding an accidental full-seed automatic robustness sweep.
