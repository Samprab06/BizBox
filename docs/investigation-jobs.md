# Investigation jobs (HAC-52)

`createInvestigationService(repository, options?)` in `lib/agent/jobs.ts` provides
`create`, `load`, `advance`, `markInterrupted` and `retry`. State is stored through
`InvestigationRepository`; production uses `jobs-postgres.ts`, while offline tests
use the matching memory adapter. No tools or model providers are called by this
ticket.

## HTTP contract

- `POST /api/investigations`: `{projectId, profileId, question, limits?}` creates a
  queued job and returns 201. The profile must exist in the same project.
- `GET /api/investigations/[id]`: returns `{job, milestones}` with summaries for
  all attempts. Reading a stale active job records its interrupted status.
- `POST /api/investigations/[id]/advance`: empty body or `{action:"advance"}`
  advances; `{action:"retry"}` starts a new attempt on a failed/interrupted job.

Responses expose status, counters, findings, reason, timestamps, server revision
and milestone summaries. They never expose lease tokens or raw tool inputs.
Requests cannot set status, attempt, counters or checkpoints. Limits may only be
lowered from 25 tool calls, 3 `poll_customers`, and 3 `evaluate_sites`; zero disables
that budget. Every tool consumes the general tool-call budget.

`maxDuration` on the advance route is 30 seconds; execution uses 80% (24 seconds)
for planning/tool work, leaving time to checkpoint and return. JSON bodies are
limited to 64 KiB. Errors use `{code,message,field_errors}`: malformed values 422,
missing job/project/profile 404, concurrent ownership or invalid state 409, and
unavailable storage 503. Responses disable caching.

**HAC-23 integration:** inject its trusted `InvestigationStepPlanner` in
`app/api/investigations/runtime.ts`. Until then, unfinished production jobs return
503 `INVESTIGATION_EXECUTOR_UNAVAILABLE` on advance, without fake progress.
Create/status/retry still use the real Postgres store. The handler factory accepts
a fake planner only for tests.

## Checkpoints, limits and recovery

The planner receives a cloned job, completed current-attempt milestones, next
sequence and abort signal. It returns null when finished, or
`{tool,inputHash,execute}`. Execution returns `{summary,findings?,done?}`.
`inputHash` must identify the actual tool input; summaries must be JSON values.

Counters are reserved durably **before** executing a tool. Each completed tool's
milestone and findings are committed atomically before another step begins. A
normal cutoff queues the job; the next advance starts after its completed
milestones. No advance for five minutes marks an active, previously started job
interrupted. A new queued job with no prior advance does not expire immediately.

Tool timeout marks interrupted, since its outcome may be ambiguous. Other tool
failures become failed with sanitized reasons. Reserved capacity remains spent.
On a limit, existing findings are preserved: useful findings yield succeeded with
a limit reason, otherwise failed. Retry increments attempt and resets counters;
older milestones and findings remain available.

Postgres uses short transactions, durable lease tokens/expiry and revision/attempt
fencing. No database transaction spans model/tool execution. Late/expired owners
cannot checkpoint, and duplicate milestones roll the whole checkpoint transaction
back. The unique key is `(investigation_id, attempt, seq)`.

Completed checkpoints prevent replay within an attempt. A process can still die
after a tool side effect but before its checkpoint; HAC-23 tools must honor
`idempotencyKey = jobId:attempt:seq:inputHash` for this window. Tools must also
respect the abort signal. This is not an exactly-once guarantee for external side
effects from an uncooperative tool.

## Migration and verification

The migration retains existing `profileId`, `question`, checkpoint data and scoped
profile foreign key. The old `completed` enum label is renamed to `succeeded`
without losing rows; `interrupted` is added. New job fields have compatible
defaults. `investigation_milestones` is new; lease fields remain internal.

`drizzle.config.ts` generates platform migrations through
`lib/db/migration-schema.ts`. CoStar/public source tables continue to use their
existing idempotent loader DDL, so this migration does not recreate them. Runtime
`getDb()` still exposes the complete schema.

Unit/API tests use fake planners and the memory repository. Optional real local
Postgres tests require `RUN_JOB_DB_TESTS=1` and private `HAC52_TEST_DATABASE_URL`.
They reject non-loopback targets and database names without the `hac52_test_`
prefix, create/drop only a fresh owned test database, and verify legacy migration,
idempotent rerun, durable checkpoints, JSON null, lease fencing, atomic rollback
and foreign keys. They were exercised against disposable local PostGIS, not the
hosted database. No hosted migration or deployment is included in this PR.
