# Copilot business tools (HAC-82)

This extends the intentionally partial mutation foundation in merged PR #87.
`createCopilotTools` composes mutations, reads and checkpointed runs, with exactly
one definition per tool. It is re-exported from `lib/agent/tools.ts` beside the
unchanged HAC-23 investigation tools. `createPostgresCopilotTools` supplies lazy
production adapters over the existing stores/services. It does not mount a chat
endpoint, create another conversation, or dispatch client actions.

## Trusted context and proposals

The runtime supplies `projectId`, `evidenceId`, `signal`, and the selected immutable
`scenarioId`/`profileVersion`. Supply one stable `idempotencyKey` per accepted
logical action; a retry must retain it, while a new action must get a new key.
Keys and author/project/confirmation fields are not model arguments. Scope changes
reject stale actions instead of silently applying them to another scenario.

Mutations use `buildScenarioPatch` and `ScenarioService.create`, the same shared
service available to manual UI actions. Each accepted action creates one immutable
agent child with rationale. No mutation runs a simulation or selects/keeps the
proposal. Humans choose Run, Keep or Revert; HAC-88 owns client dispatch.

`ScenarioService.create(project, request, { idempotencyKey })` hashes the scoped
key into a stable ID, reads an existing result before writing, checks semantic
request equality, and recovers concurrent uniqueness races. This survives process
restart without a second history/cache store. Reusing a key for another request
rejects. Without a key the existing manual/service behavior is unchanged.

## Tool behavior

| Tool                         | Behavior                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fork_scenario`              | Immutable child with a supplied label/rationale.                                                                                                                                                                                                                                          |
| `set_hours`                  | Same-day integer minutes for weekday/weekend.                                                                                                                                                                                                                                             |
| `set_staffing`               | Constant headcount; `by_hour` is explicitly unsupported.                                                                                                                                                                                                                                  |
| `set_stations`               | Checks every selected site's modeled area; a selected layout must agree exactly. Uses the existing layout derivation, not invented geometry.                                                                                                                                              |
| `add_sites` / `remove_sites` | Existing profile-scoped candidate search/inventory; one to eight unique sites. No catchment reassembly during the mutation.                                                                                                                                                               |
| `set_price`                  | Dollar ticket converted to whole cents, or a tier override. Saved price-acceptance curves use the existing sensitivity interpolation; never another paid panel call. Missing curves are explicit `unavailable`; tier changes are `tier_requires_run`, with no invented dollar conversion. |
| `find_sites`                 | Saved profile plus size/limit/rent/must-have preferences, through existing search. Area/near geocoding is explicitly unsupported rather than guessed. Returns IDs/evidence only.                                                                                                          |
| `run_scenario`               | Existing durable runner and rolling project budget. Requires trusted `runConfirmed`; over-budget work additionally requires `budgetConfirmed`. Strict model schemas reject self-authored confirmations.                                                                                   |
| `compare_scenarios`          | Completed, same-profile/version evaluations, ranking-change flag and typed interval/delta references; unmatched sites disclosed.                                                                                                                                                          |
| `explain_hour`               | Verified saved representative run/day/hour, not all-seed data. Missing/out-of-hours traces are unsupported, never fabricated zeroes.                                                                                                                                                      |
| `diagnose` / `focus_view`    | Scoped, injectable HAC-89/HAC-88 delegation hooks; explicit unsupported when absent. They do not duplicate classification/client features.                                                                                                                                                |
| `edit_layout`                | Advanced layout persistence/linkage remains explicitly unsupported.                                                                                                                                                                                                                       |

The composed registry routes `run_scenario` to the run adapter, not PR #87's
legacy unsupported mutation-only entry. `start` performs the runner's existing
single advancement; a resume invokes at most one additional slice. There is no
polling loop or alternate budget/cache. Cancellation gates before/after awaits;
the existing runner cannot interrupt an already executing slice.

## References and display

Strict Zod arguments/results live in `lib/contracts/copilot-*.ts`. Tool summaries
contain IDs, status/warning codes and typed references, never raw metrics,
listing prose or event arrays. Before/after mutation values use `scenario_value`;
reads use `comparison_metric`, `comparison_delta`, `hour_metric` and `candidate`.
Cached pricing uses `price_acceptance_shift` pointing at saved curves and the
proposal, not a fabricated new panel response.

`resolveCopilotReference` is a display helper, not a model tool. The caller supplies
the exact issued references and scoped saved artifacts. It rejects unissued
references, foreign projects/profile versions, arbitrary paths and missing
artifacts. Delta bounds are B.low−A.high / B.high−A.low, explicitly **not paired-seed
confidence**. Hour data stays representative-run-only; cached acceptance resolves
per persona with its limitation. No model-authored number is accepted as a value.

`fixtures/copilot.ts` provides deterministic invented example artifacts for
HAC-83/88 integration. It is never a production fallback. HAC-83 must carry the
existing investigation/Jev/Nessie tool surface into the durable conversation
runtime; this ticket does not replace those tools or the shared playback clock.

## Provenance and migration 0007

Unchanged inherited founder wrappers remain founder-attributed; agent changes
are `default` with action evidence. Agent roots and newly introduced/modified
founder-attributed leaves are rejected by parent-aware model validation.

Migration `0007_scenario-provenance.sql` replaces 0003's blanket ban with the same
parent-aware rule at the database: a BEFORE INSERT trigger compares each founder
leaf with the exact same path in the scoped immutable parent. The root check,
immutable history, rationale and foreign-key constraints remain in force.
**Deploying this code requires migration 0007 before agent proposals may inherit
founder inputs.** This work does not apply hosted migrations.

## Verification

Offline scripted deepagents tests cover every tool. Shared-service tests cover
manual/tool parity, durable retries, concurrent conflicts, stale scope, inherited
and spoofed provenance, capacity, unsupported operations, aborts and sanitized
errors. Production-composition tests mock only data/provider boundaries, ensuring
price proposals make no panel/evaluation calls and run uses the confirmation gate.
Loopback-only Postgres tests migrate a new disposable database, verify raw SQL
inheritance guards and concurrent durable retries, then remove only that database.
No paid calls, source recordings or hosted data changes are required.
