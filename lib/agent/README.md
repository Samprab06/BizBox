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
and `assistantMessage`. This endpoint is **stateless**: the caller must carry the
returned state into the next request. It does not create durable profile snapshots
or update the existing browser intake UI. The [investigation orchestrator](../../docs/investigation-orchestrator.md)
uses `saveProfile` and persists validated snapshots through its database workflow.

An existing project and a configured `DATABASE_URL` are required for the read-only
project lookup. Unknown projects return 404. Invalid JSON, unsupported fields,
invalid values and bodies over 64 KiB return 422. Database/model failures return
sanitized 503 responses. Errors use `{code, message, field_errors}` and responses
disable caching.

## Conversation runner

`runner.ts` binds `save_profile` to the installed JavaScript `deepagents` graph.
The runner exposes only that tool, with no filesystem or delegation tools.
Natural-language requests require `OPENAI_API_KEY` in private server environment
configuration. Structured patches do not require a model key.

The default model is [`gpt-6-luna`](https://developers.openai.com/api/docs/models/gpt-6-luna),
confirmed in official OpenAI documentation on November 14, 2026. `OPENAI_MODEL`
optionally selects another compatible tool-calling model. Reasoning is set to
`none` so temperature 0 is supported. The runner keeps a 1,500-token response cap,
no provider retries, at most two save calls per turn (one is normal) and a graph
recursion limit of twelve. If the limit is hit, the turn still succeeds: the draft keeps
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
