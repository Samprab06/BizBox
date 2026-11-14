# Checkpointed investigation orchestrator (HAC-23)

The trusted investigation runtime now supplies one deepagents/OpenAI planner to
the existing Postgres job service. It uses `OPENAI_MODEL` or `gpt-6-luna`, with
temperature zero, no provider retries, a 2,000-token decision cap and a 10-second
provider timeout. Missing model configuration preserves the existing safe 503
executor-unavailable response; importing/building routes makes no provider calls.

Each graph invocation chooses one structured next action. Business tools,
filesystem access and delegation do not execute inside the graph. The job service
validates and reserves capacity before invoking the selected tool. Completed
milestones rebuild the next model context across function invocations; there is
no process-local workflow state or filesystem checkpoint.

## Tools and durable state

The seven Zod-validated tools are `save_profile`, `search_sites`, `get_catchment`,
`poll_customers`, `evaluate_sites`, `run_sensitivity` and `get_site_run`. They use
the same intake, inventory, catchment, panel, evaluation and storage functions as
the HTTP APIs. Project identity comes from the job, and site/comparison/run inputs
are constrained to that investigation's reviewed artifacts. Tool outputs are
bounded summaries, numeric origins, findings and IDs; raw event lists do not enter
the model context. Run summaries expose at most 100 event IDs plus their total.

Milestone `summary` is `{ input, output, modelFindings }`. Consumers such as the
grounded-plan step should read `output` for verified tool results; the latest
successful `save_profile` supplies the effective immutable profile snapshot ID.
The final control milestone is `finish_investigation`, carrying the findings and
HAC-24 handoff. Missing required inputs instead finish with explicit questions and
source exclusion findings, rather than invented values or a paused conversation.

Profile and comparison IDs are deterministic hashes of the step idempotency key.
If a database commit succeeds before a checkpoint is lost, executing that same
step key loads/reuses the artifact, including concurrent snapshot conflicts.
Sensitivity updates lock the comparison and merge against its latest stored
assumptions to preserve other completed sweeps.

Only `poll_customers` permits new Jev requests. Answers persist in the existing
project-scoped Postgres cache; behavior table IDs are content-addressed outputs
reconstructed from the saved poll context and cached responses. Evaluation uses
a cache-only Jev client and falls back to Huff with a reason on cache misses.
Cancellation reaches provider fetches and retry backoff. This prevents hidden
paid polling during evaluation; it does not promise provider-side exactly-once
delivery if an external request finishes before its response is durably cached.

## Advancement and limits

Create through `POST /api/investigations` with `{ projectId, profileId, question }`.
Call `POST /api/investigations/<id>/advance` while active, and read status and
milestones through `GET /api/investigations/<id>`. An explicit
`{ action: "retry" }` starts a new attempt for failed/interrupted jobs.

The trusted runtime opts into same-attempt `running` recovery after its 24-second
work budget inside the route's 30-second maximum. It aborts unfinished work,
preserves completed milestones and releases its fenced lease. The next advance
uses the same sequence number for the unfinished step. Model choices for an
unfinished step can differ after a cutoff; canonical input hashes and deterministic
artifact keys protect matching executions, while completed identical actions are
not executed again. Legacy callers without this opt-in retain their old timeout
behavior.

Reservations are durable before execution and are never refunded after a cutoff.
Limits remain 25 total tool/control actions, three polls and three evaluations.
Started active jobs without an advance for five minutes become interrupted.
`INVESTIGATION_WALL_TIME_MS`, beside `INVESTIGATION_LIMITS`, caps total wall time
from job creation at 15 minutes, including retries; expiry finishes with a finding.
The loop plans intake, shortlist, catchments, panel, evaluation, top-site diagnosis,
two weak-assumption sweeps plus the Huff check, then hands evidence to HAC-24.

## Verification

Scripted tests cover all seven tool services, the real compiled deepagents
decision graph, milestone reconstruction, scope, missing inputs, duplicates,
timeouts, stale jobs and limits. Runtime tests prove lazy configuration and
durable HTTP advancement. The actual local PostGIS tests use a dedicated loopback
`HAC23_TEST_DATABASE_URL` with a `hac23_test_` database and
`RUN_ORCHESTRATOR_DB_TESTS=1`; they verify concurrent idempotent snapshots,
comparison recovery and checkpoint/lease resume. All data and panel/model results
in these tests are synthetic; no hosted database or paid provider is needed.

The optional `RUN_INVESTIGATION_LIVE=1` smoke test uses a private
`OPENAI_API_KEY` for one provider decision without business tools or database
execution. A key alone does not enable it in ordinary tests. Live verification
must be explicitly authorized separately.
