# Copilot mutation tools: local HAC-82 slice

`createCopilotMutationTools` is re-exported beside the HAC-23 tools in
`lib/agent/tools.ts`. It is an injectable registry for a future BizBox copilot;
it is not connected to the investigation planner, HTTP routes or a chat runtime.
HAC-82 remains partial. This slice makes no provider, simulation or paid calls.

The caller supplies trusted `projectId`, `evidenceId` and `AbortSignal` context.
Every tool has a strict Zod schema in `lib/contracts/copilot-tools.ts`; a model
cannot override the project or author. Supported mutations call the existing
`ScenarioService.create` exactly once with `author: "agent"`, the required
rationale and a full replacement patch. Failed validation and unavailable adapters
create no scenario version. This is per-invocation behavior, not durable retry
idempotency or budget enforcement; the eventual runtime must provide those.

| Tool            | Current behavior                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `fork_scenario` | Fork with the supplied label                                                                                                        |
| `set_hours`     | Same-day integer minutes for weekday or weekend                                                                                     |
| `set_staffing`  | Constant headcount; `by_hour` returns unsupported                                                                                   |
| `set_stations`  | Requires a trusted, scoped capacity adapter for every selected site; checks listing ceiling and exact selected-layout station count |
| `add_sites`     | Requires a scoped inventory adapter confirming every added ID; at most eight sites                                                  |
| `remove_sites`  | Keeps at least one selected site                                                                                                    |
| `set_price`     | Unsupported until cached price-acceptance integration is available; no price change is stored                                       |
| `edit_layout`   | Unsupported until durable layout persistence/linkage is integrated                                                                  |
| `run_scenario`  | Unsupported until checkpointed execution and project-budget enforcement are integrated                                              |

`buildScenarioPatch(parent, change, source)` in `lib/scenario/patch.ts` is the
shared pure boundary for future UI levers and tools. It merges the selected day
and field into a detached full overrides object, preserving untouched values,
origins and evidence byte-for-byte. It performs no storage, capacity lookup or
simulation. Callers must supply capacity validation for stations. Source is
explicit: founder edits can declare `founder`; agent proposals use `default` with
an evidence reference. Matching provenance inputs produce matching patches;
this does not claim an implemented UI lever integration.

The current scenario service rejects an agent child that inherits founder-origin
wrappers. Until its owner lands the approved parent-aware validation, the tool
reports `PROVENANCE_CONFLICT` and preserves those wrappers. This slice neither
relaxes the invariant nor relabels founder values. Its inheritance regression must
be updated when that owner change is integrated.

Mutation summaries return IDs, changed paths and typed `scenario_value` references
(`scenarioId`, `path`) for before/after override values. They contain no raw numeric
metrics or event lists. A future client reference resolver must load the scoped
scenario and resolve that path. Station and candidate adapters must use trusted
source evidence; neither has a production adapter in this slice.

Remaining HAC-82 work includes price acceptance, layout/run adapters, durable
mutation retry identity, the copilot runtime/client reference resolver and the
`find_sites`, `compare_scenarios`, `explain_hour`, `diagnose` and `focus_view` tools.
HAC-60's per-site catchment independence is not established by changing a shortlist.
The existing seven HAC-23 tools and their budgeted planner remain unchanged.

Offline checks use the real compiled deepagents graph with a scripted model for
each exposed tool, and the real scenario service/model over an in-memory repository.
They cover one version per supported call, explicit unsupported results, patch
parity, scoping, preserved provenance, capacity, candidate identity, cancellation
and sanitized failures. No model credentials or database are required.
