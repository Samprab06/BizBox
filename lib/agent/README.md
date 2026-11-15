# Founder intake (HAC-19)

`createIntakeSession(projectId, state?)` in `intake.ts` interviews the founder in seven
question groups. Its `saveProfile(patch)` method validates and merges answers and
returns a canonical `BusinessProfile` when the draft is complete. Until then,
`profile` is `null`; missing fields and explicit unknowns remain findings. It never
invents founder answers to make the schema pass.

Numeric values, booleans and price tiers use the shared provenance wrappers. Every
value changed through a founder patch becomes `origin: "founder"` with founder
evidence. Category defaults remain `default`, and switching category preserves
founder overrides. Unrecognized categories are stored as `unsupported`, with the
original category retained in `unsupportedCategory`.

The four [category fixtures](../../fixtures/categories/README.md) distinguish BLS
wage proxies from authored, uncalibrated scenario inputs. Supplemental assumptions
(visits, peak hours and floor area) stay in intake state instead of changing the
shared `BusinessProfile` contract.

## API

`POST /api/projects/[projectId]/intake` accepts:

```json
{
  "patch": {
    "businessName": "Morning Cup",
    "concept": "Neighborhood coffee shop",
    "category": "coffee"
  }
}
```

For the next turn, pass the previous response's `draft` and `assumptions` under
`state`, plus another `patch` and/or a natural-language `message`. An empty object
returns the first question. The project ID comes from the path; supplying identity
or version fields in a patch is rejected.

Responses contain `persisted: false`, `draft`, `assumptions`, `profile`,
`missingRequiredFields`, `findings`, `questions`, `nextQuestion`, `defaultSources`,
`assistantMessage` and `actions` (HAC-144: zero to three `UiAction`s, see below). This endpoint is **stateless**: the caller must carry the
returned state into the next request. It does not create durable profile snapshots
or update the existing browser intake UI. The [investigation orchestrator](../../docs/investigation-orchestrator.md)
uses `saveProfile` and persists validated snapshots through its database workflow.

An existing project and a configured `DATABASE_URL` are required for the read-only
project lookup. Unknown projects return 404. Invalid JSON, unsupported fields,
invalid values and bodies over 64 KiB return 422. Database/model failures return
sanitized 503 responses. Errors use `{code, message, field_errors}` and responses
disable caching.

## Conversation runner

`runner.ts` binds `save_profile` to the installed JavaScript `deepagents` graph,
plus the `ui` tool group below when the handler has trusted lookups (the route always
does). It has no filesystem or delegation tools.
Natural-language requests require `OPENAI_API_KEY` in private server environment
configuration. Structured patches do not require a model key.

The default model is [`gpt-6-luna`](https://developers.openai.com/api/docs/models/gpt-6-luna),
confirmed in official OpenAI documentation on November 14, 2026. `OPENAI_MODEL`
optionally selects another compatible tool-calling model. Reasoning is set to
`none` so temperature 0 is supported. The runner keeps a 1,500-token response cap,
no provider retries, at most two save calls per turn (one is normal), at most three UI
actions per turn and a graph recursion limit of sixteen (twelve before HAC-144; the
extra steps leave room for UI tool calls). If the limit is hit, the turn still succeeds: the draft keeps
what was saved and the reply says so and asks the next question.
Requests have a 20-second intake deadline; the route allows 30 seconds. No paid
provider fallback is selected. These bounds limit each request's work; they do not
establish a monthly spending limit.

Unknowns need the founder's words (HAC-113). The prompt says so, and `intake-guard.ts`
enforces it in the `save_profile` tool: an explicit unknown (`value: null`) is kept only
when the latest founder message has a don't-know signal ("I don't know", "not sure",
"no idea", "unknown", "TBD"...) in a clause that names that topic, or a bare "I don't
know" that answers the question just asked. Other unknowns are dropped, the field stays
undefined, and the tool result tells the model so. The model-facing tool schema omits
server-owned `origin` and `evidenceIds` (about half the size), the draft context and tool
results are compact, and each turn logs one `intake_turn` line with token counts only.

## UI-action tools (HAC-144)

The consultant moves the founder through the app with eight tools (`ui-tools.ts`):
`show_step` (a `navigate` action to any `AgentStage`), `open_site`, `focus_map`,
`show_comparison`, `open_simulator`, `open_interior`, `show_plan` and `highlight`. Their
arguments are the `UiAction` shapes in `lib/contracts/agent.ts` without `id`/`type`,
which the server sets. Each call:

1. validates the arguments against the contract (`highlight` only takes the named anchors);
2. checks every ID against trusted server data, through `IntakeUiLookups`
   (`app/api/projects/[projectId]/intake/ui-lookups.ts`): a site must be a CoStar suite
   (`listingId:spaceId`) or property in the inventory and, once the draft has a city, in
   that city; a comparison or investigation must belong to the path project. Spoofed or
   foreign IDs return a tool error and queue nothing. A failed lookup is a tool error too,
   never a failed turn;
3. pushes the action into the turn's collector and returns a short confirmation.

Duplicate actions are skipped, and a fourth action is refused. The request's optional
`view` (`AgentViewContext`) is shown to the model as the founder's screen, so it can use
the candidate IDs there. The prompt's "do not call other services" rule has one
exception: these tools. The handler returns the collected actions, including when the
step budget runs out (`GraphRecursionError`). The client parses `actions` but does not
dispatch them yet (AGT-16).

Without a model (a structured-patch request with no `message`), a rule applies: the
request that completes the profile returns `navigate` to `map` (the candidate spaces).
Later syncs of an already complete profile return no actions.

The provider runner is guarded by `server-only`. `next.config.ts` loads
`deepagents`, `@langchain/core` and `@langchain/openai` as
[server external packages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).
This keeps optional SDK sandbox imports out of Turbopack's bundle; no sandbox or
WebSocket dependency is needed by this intake tool.

The tests use scripted founder answers and a scripted chat model against the real
compiled deepagents graph and the real OpenAI SDK with a stubbed fetch transport.
They require no provider calls. Live OpenAI, hosted
Postgres and Vercel preview verification remain separate from these offline tests.

To opt into the synthetic paid smoke test, privately export `OPENAI_API_KEY`, then
run `RUN_OPENAI_LIVE=1 pnpm exec vitest run lib/agent/runner-live.test.ts`. A key
alone does not enable paid calls during the routine test suite.


## Nessie cash-buffer evidence (HAC-106)

The investigation tool registry exposes `read_nessie_cash_buffer` for cash-buffer
and site-affordability questions. Arguments contain optional `account_id` and a
paired `comparison_id`/`site_id`, never model-invented balances or costs. A site
scenario uses only a comparison generated in the active investigation attempt,
matching its current immutable profile, plus the stored evaluation's buildout
and contribution. Results remain explicitly simulated and do not change the
site ranking.

The configured server adapter uses `NESSIE_API_KEY`; credentials never enter the
model prompt or milestone. Only a sanitized, schema-validated result is saved in
`milestone.summary.output`. The planner sees the completed output on its next
step, and trusted tool findings survive the grounded-plan handoff. Normal tool
budgets, checkpoints, duplicate-step guards and transport cancellation apply.
The browser renders that saved result inside Consultant activity and makes no
separate Nessie request.

Unavailable/empty/provider-error and ambiguous-account states are optional
financial limitations, not invented zero cash and not a reason to fail an
otherwise useful location investigation. See the final consultant revision in
[the Nessie spec](../../docs/integrations/nessie.md).

## Current screen context (HAC-149)

Each typed or spoken intake turn may include the existing strict `view` contract
(`AgentViewContextSchema`). The client derives it from reports published for this
project and the active route, omitting examples, loading state IDs and URL-only IDs.
Replay joins its selected-site report with its same-route stored comparison.
Listing labels, addresses and other arbitrary display copy are never included.
Only identifiers already published by a screen are sent; scenario, investigation
and minute fields stay absent until a screen reports them.

Before a message reaches the model, the server rechecks comparison, scenario and
investigation references using project-scoped reads. Site/candidate references
must occur in those scoped comparison/scenario artifacts or the top-eight shortlist
recomputed with the existing search function and server inventory. Search uses the
canonical complete intake draft bound to the path project, falling back to the latest
saved project profile. For a completed browser form, the shared request builder reuses
`profileFromIntake` (the same normalization used by listing search) to seed only
missing draft leaves through the existing `state` contract. Explicit live values,
unknowns, origin labels and assumptions survive; pending form edits still apply last.
Incomplete forms keep their previous state. No profile/request schema is added.
This is a read-only operation; no search registry, migration,
model request or profile persistence is added. A known-invalid reference returns
422 before a model call. If neither a complete draft nor a saved profile exists,
selection IDs and minute are removed and the context reports `phase: "missing"`,
so incomplete-intake conversations can continue without asserting a selected site.
Lookup failures return sanitized 503s. Validation shares the existing 20-second
turn deadline; a lookup completing after cancellation cannot start a model call.

The runner receives one JSON context line next to the draft, capped at **1,024 UTF-8
bytes including its prefix**. This is a conservative **1,024-token upper bound** for
byte-level BPE, not a tokenizer estimate. Lower-priority fields are dropped whole;
oversized JSON-escaped selection IDs are removed, never truncated. The line contains
only schema fields and rechecked IDs. Turn logs add only `viewContextBytes`; context
content is not logged. The thread recorder receives only the resolved view.

Patch-only edits remain SDK-free and skip context lookup; their unvalidated `view`
is discarded before thread recording. Voice's `readContext` exposes the same view
and fingerprints it to discard speech captured before the screen changed. Spoken
transcripts use the same intake endpoint/validation as typing. Realtime remains a
transcription/read-aloud transport and receives no business context instructions.

The merged HAC-144 UI tools receive only the resolved view through `ui.view` and
retain their existing action collection and ID checks. The model sees only the
bounded `viewContextLine`; the previous raw screen JSON prompt append is removed.
