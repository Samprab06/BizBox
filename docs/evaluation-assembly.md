# Evaluation assembly (HAC-56)

`lib/evaluation/assemble.ts` bridges the canonical founder profile, current
listing inventory, catchment data and customer panel into HAC-22's
`EvaluationRequest`. It performs no model calls unless Jev is explicitly requested
and a client is configured.

## HTTP workflow

1. `POST /api/profiles` with `{ projectId, profile: BusinessProfile }` saves an
   immutable snapshot and returns `201 { profile, persisted: true }`. Use the
   returned profile ID/version. The server assigns both; a project-row lock
   serializes project-wide versions, and old snapshots remain unchanged.
2. `POST /api/comparisons` with
   `{ projectId, profileId, candidateIds, demandSource?, seeds? }` loads that exact
   project-scoped snapshot, assembles, evaluates and stores the comparison.
   Candidate IDs are unique `listingId:spaceId` strings, maximum eight.
3. The response and stored evaluation include `assembly.findings` and
   `assembly.assumptions`, mapping numeric input paths to value, origin and
   evidence IDs. Read and rerun responses retain that metadata. Reruns use the
   stored request without another assembly or Jev call. JSONB object-key ordering
   does not affect the metric reproduction check.

The shortcut defaults to Huff. Explicit `demandSource: "jev"` uses the configured
`JEV_API_KEY`, optional `JEV_BASE_URL` and `JEV_MODEL`; absent credentials or
incomplete behavior tables lead to labelled Huff fallback. Full evaluation
requests and `{ projectId, rerunComparisonId }` payloads remain supported. Intake
continues to return `persisted: false`; saving is a separate explicit operation.

Validation failures return 422, missing project/profile snapshots return 404, and
storage/source failures return a safe 503. When all sites lack required inputs,
the 422 response includes exclusion findings. Unknown rent, size, operating
expenses or coordinates never become invented site facts.

## Scenario assumptions

The first eligible requested site supplies one shared seeded persona population;
request order therefore determines the shared catchment. Competitors are merged
across candidate catchments, using actual source venue coordinates. Vehicle
pass-by is excluded because it cannot be interpreted as people without a
calibrated conversion. Workplace jobs are a demand proxy rather than unique people.

Lead-approved authored defaults are scenario inputs, not market benchmarks:

| Input | Default when absent |
| --- | --- |
| Staff | 2 |
| Lease term | 60 months |
| Usable area | Marketed square feet as an explicit default-origin proxy |
| Candidate frontage | 20 feet; known building frontage is a labelled suite proxy |
| Competitor attributes | 1,500 square feet, 20 feet frontage, inline, zero anchors |
| Coffee ticket: budget / mid / premium | $5 / $6.50 / $9 |
| Quick food ticket | $9 / $12 / $18 |
| Salon/barber ticket | $25 / $35 / $55 |
| Fitness ticket | $15 / $20 / $30 |
| Median age / households with children | 40 / 0.35 |
| Commute: drive / walk / transit / bike | 0.78 / 0.10 / 0.08 / 0.04 |
| Median household income, only if unknown | $60,000 |
| Missing LODES age/earnings bands | Equal scenario weights |

Known founder values take precedence. Category fixtures provide service time,
station area, wages and COGS. Every default is retained in assumptions/findings;
unknown buildout is rejected rather than silently made zero. Actual LODES age
and earnings bands take precedence over missing-band scenario weights.
The comparison's demographic-default finding discloses that the persona
population is partly default, so downstream plans can state that limitation.

## Verification

Unit tests inject source and panel dependencies. Local PostGIS checks are gated
by `RUN_ASSEMBLY_DB_TESTS=1` and a dedicated loopback
`HAC56_TEST_DATABASE_URL` whose database name begins `hac56_test_`; they never use
the normal application `DATABASE_URL` as their test target. The assembly/route
tests expect a prepared `houston-coffee` snapshot (`hac56-local-coffee-v1`, or
`HAC56_TEST_PROFILE_ID`) and three known real space IDs (override with
`HAC56_TEST_CANDIDATE_IDS`). The profile-store test creates and drops its own
temporary database to exercise concurrent versions on multiple connections.

The local acceptance run loaded 3,339 actual CoStar properties, 3,955 spaces and
11,179 tenancies. It used three explicitly synthetic public block groups, job
points and places because no public cache was present. Its profile/comparison
were marked synthetic. This verifies real listing wiring and database behavior;
it does not validate population accuracy. Jev calls were mocked, including
Postgres cache reuse. No hosted database or live paid API was used for these tests.
