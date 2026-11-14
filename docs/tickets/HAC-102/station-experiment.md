# Station experiment recommendations (HAC-102)

The approved objective is highest **positive mean added monthly revenue**, then
fewest added station-hours, then stable variant ID. A recommendation must add
resolved effective stations. Walk-away reduction is not an eligibility condition:
extra completed services may include customers otherwise unfinished at closing.
Contribution is reported even when negative. Selection compares only the supplied
tested variants and makes no claim of a global optimum or equipment affordability.

## Completed-result contract

`lib/contracts/station-experiment.ts` exports lightweight Zod schemas and types:
`StationExperimentCallout`, `StationObservations`, and `StationExperimentResult`.
Client consumers should use type-only imports and consume completed summaries.

`summarizeStationExperiments({ baseline, alternatives, origins }, dependencies?)`
retains the original full `ExperimentResult` adapter. It validates paired arrival
inputs, uses actual helper monthly points and `experimentDelta`, and never runs a
simulation. `selectStationExperiment(variants)` applies the approved objective.

`stationExperimentsFromComparisons({ baseline, alternatives, siteId, dayType,
origins })` consumes full stored comparison records, with at most eight
alternatives. It returns either:

- `status: "available"`, `selected` (a callout or null), numeric `variants`, and
  `identity` containing project/site/profile/version/model, comparison IDs, exact
  seed IDs and the synthetic flag; or
- `status: "unavailable"`, a safe reason and `code` of `missing_observations`,
  `insufficient_seeds` or `incompatible`.

It validates complete stored request equality modulo only the selected site's
planned station count and staff headcount. Project, profile snapshot, model,
source, synthetic state, site list, seed set, geometry, hours, calendar, costs,
prices, personas, storefronts and cached behavior inputs must match. Selected
layout identity and its retained snapshot must also match. This deterministic
input equality establishes paired workloads without customer hashes or invented
empty schedules. Point metadata and monthly economics must agree with the saved
request and saved evaluation summaries. Missing legacy data is unavailable and
is never reconstructed from representative events or marginal percentile ranges.

## Retention and execution

`evaluateSite` calls the actual HAC-79 `runExperiment` once per seed for the same
two weekday/weekend engine days it previously executed. It retains optional
`SiteEvaluation.stationObservations` (`hac102-v1`) inside existing comparison and
checkpoint JSON. Configuration/settings appear once, followed by at most 100 seed
points of day counts/revenue and monthly revenue, contribution and staff-hours.
Persisted artifacts contain no additional per-seed schedules, customer records or
event streams. During evaluation, the current implementation holds the full helper
results (including schedules and hourly arrays) for at most 100 seeds of the current
site until capture, in addition to the day results previously retained. This adds
temporary memory proportional to the existing workload. There is no database migration.

The shared `runScheduledExperiment` helper composes prepared schedules with the
same engine/economics calculation. `runExperiment` delegates to it after normal
demand generation. Prepared schedules must match site, seed, day and hours.

The scenario cache key now includes the artifact version. An explicit new run can
therefore retain observations even when an older economic cache entry lacks them.
Queued legacy Jev keys remain recognized while resuming. Old completed checkpoints
may lack the optional artifact and remain honestly unavailable. GET requests do
not execute or backfill anything.

Normal live executions keep the existing reservation: site count × seed count ×
two day types for each configuration. Baseline and alternatives each require their
own explicit budgeted scenario execution, with existing rolling-budget,
confirmation, cache, idempotency and checkpoint behavior. The completed-result
producer starts no simulations, network/provider calls, workers, saves or budget
reservations. The approved orchestration uses partial/resumable per-configuration
budgeting: an allowed baseline may complete before an alternative needs explicit
confirmation. It does not claim an atomic whole-sweep reservation. API/orchestration
and UI integration are separate manager-owned surfaces; they must not hide additional variants inside one run's reservation.

## Meaning of displayed values

The label is **Modeled additional monthly revenue** and the caption is **Modeled,
not a forecast**. Revenue is the helper's total revenue difference, not revenue
attributed exclusively to recovered walk-aways. Monthly walk-away change separately
counts balked plus reneged customers, weighted once by the weekday/weekend calendar;
unfinished-at-close customers are excluded. The displayed-day walk-away delta is
separately labeled. Monthly ranking does not change when toggling the displayed day.

At least two unique paired seeds are required. Differences are computed within
seed before applying the existing nearest-rank p5/p50/p95 summaries. Single runs
and marginal range subtraction cannot establish a paired range. Unrounded values,
including negative contribution and walk-away changes, are preserved. No-op and
capacity-clamped variants are suppressed. Inputs are not mutated.

Stations and staff are whole-operating-day settings. No 7–10am staffing window is
inferred. Station-hours is an operating-capacity proxy, not equipment cost or labor
hours; actual helper staff-hours are reported separately. Staff headcount affects
cost, not station throughput. Supplied input origins remain distinct from simulated
outputs; the producer does not infer founder/source provenance from raw numbers.

## Static authored example

`fixtureInsightsExperimentInput` in `lib/insights/fixture.ts` supplies the exact
prepared schedules/configuration used by HAC-94's authored example charts.
`scripts/generate-station-experiment-fixture.ts` runs the shared actual helper
**offline**, testing whole-day counts of three and four against the two-station
baseline over the same 12 seeds for `montrose` and `heights`. Each candidate adds one staff member per added station, matching the live grid.
The original two-station/two-person chart baseline is unchanged; the selected
example retains its negative added monthly contribution.
The output is the lightweight static `lib/insights/station-experiment-fixture.ts`,
including explicit authored/synthetic labeling. Runtime rendering imports only
that data, never the generator/helper. Unknown site IDs have no substituted example.
Regenerate with `pnpm exec tsx scripts/generate-station-experiment-fixture.ts`.

## Verification and delivery status

The earlier adapter checkpoint `1a46c9a` passed 18 targeted tests, 778 full-suite
tests (19 skipped), lint, typecheck, build and diff check on its then-current base.
Those historical counts do not claim verification of this expanded implementation.

Current focused tests cover compact/full actual-helper parity, historical Jev/Huff
economics and representative-event parity with exactly two engine days per seed,
identity/source/workload rejection, legacy absence, bounded payloads, no-op/cap
suppression, ranking/ties, negative contribution, closing-time eligibility, cache
versioning/legacy Jev resume and static fixture parity with adjacent chart inputs.
The mounted API and UI are implemented. On functional checkpoint dd449b6, all
four repository checks passed across the final verification sequence: lint and
full single-worker suite1015 passed/40 gated skips; after a copy-only change,
final57cb0d0 passed typecheck, production build and env/client guards. The copy
change also passed focused SSR, owned lint and9 tests. All54 browser cases pass
across Chromium/WebKit/mobile on the functional checkpoint. Frozen-lock,
migration-chain, environment and diff guards pass. Manager inspected actual
mobile confirmation and negative-contribution screenshots. Independent review of
API/budget/snapshot/resume boundaries found no unresolved findings.

The subsequent94 dependency merge changes documentation only; runtime content
matches the verified57cb0d0. GitHub CI for HAC-102 requires publication and is not
claimed by these local results. PR publication for HAC-94 was explicitly approved;
this completion does not assume additional102 push/merge/deploy permission.
