# Budgeted station experiments (HAC-102)

`GET /api/projects/:projectId/station-experiments?comparisonId=…&siteId=…&dayType=weekday`
reads the immutable source comparison, plans configurations, and reads existing jobs.
It never inserts scenarios, reserves units, evaluates, requests providers, or backfills
old helper observations. `dayType` defaults to weekday and controls the displayed
walk-away metric; every execution models **both** day types.

`POST` accepts the same source fields, `configurationId` (`baseline`, `plus-one`, or
`plus-two`), and `confirm` (default false). Each request executes or continues exactly
one configuration through the existing scenario runner (45-second slice, 60-second
route). There is no automatic sweep or atomic batch reservation. Baseline may finish
before an alternative needs budget confirmation. UI must show completed work and
ask before sending `confirm: true` for the named configuration.

The plan shows whole-operating-day planned/effective stations, staff headcount, exact
weekday/weekend hours, and normal execution units (one site × saved seeds × two day
types). Alternatives add one or two stations and the same number of staff. Candidates
that exceed area capacity or add no effective station are excluded before any run.
If none remain, no baseline work is performed. A selected site's immutable layout
suppresses the plan: edit the layout first. A layout with unknown ownership also
suppresses it. This is a bounded comparison, not a global optimum or hourly schedule.

## Snapshot and identity

Inputs come solely from `StoredComparison.evaluation.request`. The newly evaluated
baseline and alternatives contain only the selected site, preserve all prices,
hours, demand inputs, competitors, persona panel and overrides, and use the exact
original seed list. Only planned stations and staff counts change. The source's
validated **actual resolved demand source** is explicit in all derived requests; a
global Jev-to-Huff fallback stays Huff even when the selected site has a cached Jev
table. `sourceNotice` then says `Uses saved Huff fallback`. No live assembly or paid
provider call is needed. Tests check baseline parity against the selected site's
original multi-site result.

Recorded input badges retain validated origins from selected-site and global
assembly assumptions. Proposed station/staff assumptions add `default`; missing
input provenance is never inferred, and unrelated sites do not contribute badges.

Scenario/run IDs are SHA-256 identities of the original comparison, site,
configuration and `hac102-v1` artifact version. Day type is absent because one job
models both days. Agent-authored scenarios carry default-origin wrappers and the
source comparison ID plus source-request digest as evidence. Reused scenarios must
match all immutable content except creation time. Reused jobs must match reserved
identity, effective key and exact prepared request; completed cached comparisons
must also match that request. Insert races reload and validate the winning row.

The generic scenario runtime uses `withStationExperimentSnapshots`, recognizing
typed source/configuration evidence markers and validating the deterministic plan.
A failed snapshot load propagates; it never falls through to fresh assembly. This
also protects generic advance calls while a job has no saved request yet. Ordinary
scenarios retain the existing assembler.

## Response and limits

`lib/contracts/station-experiment-run.ts` defines the strict source request, POST,
and response contracts. Status is `planned`, `running`, `needs_confirmation`, `ready`
or `unavailable`. The envelope includes configurations and individual job statuses,
next configuration ID, real runner confirmation units, original source identity,
and the core producer result after all eligible configurations complete. The result's
baseline comparison ID is the new evaluated baseline; `source.comparisonId` remains
the original saved comparison. Cached work has zero charged units. Failed terminal
jobs are unavailable; transient errors return 503 and can be continued explicitly.

Freshness reads use the existing comparison store. `currentProfileVersion` and
`outdated` are null when unknown or when that read fails. A stale comparison is
still an explicit saved snapshot, never silently updated.

At least two saved seeds are required. Historical results without paired helper
observations stay unavailable on GET. Explicit POST may create new budgeted runs.
The selected callout and variants come directly from
`stationExperimentsFromComparisons`, with its empirical paired-seed ranges, exact
helper values, provenance and limitations. No chart reconstructs helper observations.

The endpoint follows existing project-scoped repository access and adds no auth
policy. Responses are `private, no-store`; bodies are bounded to 32 KiB. Malformed
input is 422, missing source/site 404, execution ownership conflicts 409, and transient
dependencies 503. Errors omit internal dependency details. No schema, dependency,
provider, budget table or environment-variable change is introduced.

## Verification

The service tests use the real in-memory comparison and execution stores and the
existing scenario runner/evaluator. They cover read-only plans, exact producer
output, per-configuration budget confirmation, saved-input parity and immutability,
fallback demand parity, transient resume (including generic request-null advance),
zero-cost cache reuse, insert races, tampered identities, capacity suppression,
freshness and missing-artifact reads. HTTP tests cover validation, privacy, body
limits and safe errors. Full repository checks are coordinated on the final shared
candidate after frontend/core integration.
