# Agentic business-plan workflow: ticket plan

Draft tickets for the HAC team. They are not in Linear yet, and owners are unassigned. They
belong in a new Linear project, **Agentic copilot**, and follow the same format as the
Linear tickets. When importing them, add the standard "Product context" and "Stack" blocks
to each one. Companion files:
- [`city-sim-and-insights.md`](./city-sim-and-insights.md): the SIM-* tickets, project "City
  simulation & insights"
- [`sitework-design-system.md`](./sitework-design-system.md): the DS-* tickets, project
  "Sitework shell & design system"

**Links** become Linear relations on import:
- **Blocked by**: can't start until that ticket is done.
- **Blocks**: the reverse relation. Set it on one side only; Linear mirrors it.
- **Related**: coordinate with or read; there's no hard dependency.

HAC tickets marked ✓ were already Done on 2026-11-14.

## Why

Today the founder goes through intake once. `lib/agent/intake.ts` and `lib/agent/runner.ts`
expose a single `save_profile` tool. After intake, the founder gets a fixed comparison of
**two hardcoded sites** from `components/comparison/example-comparison.ts`. They can't add
locations they like, run another simulation, or ask for changes such as "open at 6am", "add
a third chair" or "move the counter".

HAC-23 (orchestrator) and HAC-24 (grounded plan) describe a **one-shot investigation**. This
ticket set turns that into a **copilot that stays with the founder from intake to plan**.
Every step can be done by asking the agent:

- **Explore locations.** The founder can heart sites on the map or describe what they want
  ("something near Rice Village under $45/sf"). The agent searches CoStar, builds a new
  shortlist and runs it.
- **Spin up simulations.** Any change creates a new **scenario version**. The agent runs it
  and compares it with the previous version.
- **Change the business.** Hours, staffing, price, stations and the **interior layout**,
  shown in 3D inside the Matterport scan when one exists.
- **Explain and show.** The agent moves the city and interior views to the moment it is
  talking about, for example "here's 8:05, watch this customer walk away".
- **Keep the plan current.** The grounded business plan is regenerated for whichever
  scenario is active, along with a log of every decision.

### Decisions already made

- **Act, then show diffs.** The agent makes changes and runs simulations itself. Every
  change is a new, immutable scenario version, shown to the founder as a before/after
  **diff card** with Keep / Revert. The agent asks first only before batch runs that go
  over budget.
- **The layout is a real, typed model.** It is rendered inside the Matterport scan through
  the Showcase SDK, with a modeled interior as fallback. It also feeds the simulation:
  capacity, queue space and seating.
- **Grounding.** HAC-24's rule extends to chat: the model never writes numbers. Claims
  cite scenario, run or evidence IDs, and the server fills in the values.
- **Model.** The app uses **OpenAI**, following Sam's decision in HAC-53 ✓. There is no
  `ANTHROPIC_API_KEY`.
  - The copilot uses `ChatOpenAI` from `@langchain/openai`, the same as `lib/agent/runner.ts`.
  - The default model comes from `OPENAI_MODEL`.
  - An optional `OPENAI_PLANNING_MODEL` sets a stronger model for planning and diagnosis
    turns. When it is unset, those turns fall back to `OPENAI_MODEL`.
  - Keep the runner's settings: temperature 0, the token cap and no automatic retries.
  - Adding `OPENAI_PLANNING_MODEL` is an env var change, so it needs a `[CONTRACT]` post.

## How this relates to existing tickets

| Existing | Relationship |
|---|---|
| HAC-9 bootstrap (In Review) | AGT-1 needs its database and contracts. **It blocks the whole AGT chain.** |
| HAC-19 intake | AGT-4 reuses `save_profile` as a copilot tool. The intake becomes the first phase of the same conversation thread. |
| HAC-66 intake screen wiring (Todo) | AGT-4's thread must start from the live intake API that HAC-66 wires up. Build on it; don't run a second intake flow beside it. |
| HAC-53 OpenAI switch ✓ | Sets the model provider for AGT-4 and AGT-12. |
| HAC-52, HAC-56 checkpoints and evaluation assembly ✓ | AGT-2 and AGT-4 reuse the `advance` and checkpoint store. AGT-3 builds evaluation requests through HAC-56. |
| HAC-60 catchment order (Todo) | Shortlist changes in AGT-6 must not change other sites' catchments. |
| HAC-62 robustness headline (Todo) | AGT-10 and AGT-11 build on its robustness summary instead of computing their own. |
| HAC-22 evaluation | `evaluate_sites(site_ids, overrides?)` is the engine behind `run_scenario`. AGT-1 adds `scenarioId` to comparisons. |
| HAC-23 orchestrator | AGT-3 **extends** its tool set and loop. The `advance` checkpoint pattern is reused for long runs. |
| HAC-24 grounded plan | AGT-11 regenerates it for each scenario, and AGT-12 extends the no-invented-numbers check to chat. |
| HAC-26 export | AGT-11 exports through it. |
| SIM-2 hourly series | Used by `explain_hour` and `diagnose` (AGT-3, AGT-10). |
| SIM-6, SIM-13 city and interior views | AGT-9 lets the agent drive them, and AGT-8 renders the layout in them. SIM-6 builds on the Cesium/Vexcel scene in `components/simulator/`. |
| DS-2 context bar | Shows the active scenario that AGT-5's switcher sets. |
| SIM-8 experiment levers | The **same mutation functions** as the agent tools. A founder's lever change and an agent's change both produce scenario versions. |
| SIM-12, SIM-14 Matterport and scan capacity | Room bounds for AGT-7, and the scene for AGT-8. |

## Dependency order

```
HAC-9 ─► AGT-1 (HAC-9 is In Review)

AGT-1 ─┬─► AGT-2 ─┐
       └─► AGT-7 ─┼─► AGT-3 (+SIM-2) ─┬─► AGT-4 ─┬─► AGT-5 (+DS-2) ─┬─► AGT-6
                  │                    │           │                   └─► AGT-11
                  │                    │           └─► AGT-9 (+SIM-6, SIM-13)
                  │                    ├─► AGT-10
                  │                    └─► AGT-12 (grows with each tool)
                  └─► AGT-8 (+SIM-13)
AGT-13 last
```

---

## AGT-1 Scenario model and versioning

**Context.** Every "what if" needs a durable, comparable identity. Today there is one
implicit configuration.

**Scope.**
- `Scenario` is immutable and has these fields:
  - `id`, `projectId`, `parentId` (null for the root)
  - `siteIds` (1–8)
  - `profileVersion`
  - `overrides`: hours per day type, staff headcount, avg ticket or price tier, planned
    stations, demand multiplier, seed set
  - `layoutId` (AGT-7)
  - `label`
  - `author: "founder" | "agent"`
  - `rationale` (required when `author` is `agent`)
  - `createdAt`
- Every override value keeps its origin wrapper (`founder` when the founder asked for it,
  `default` otherwise). The agent never labels its own suggestion as `founder`.
- A pure function `diffScenarios(a, b)` returns field-level changes: added and removed
  sites, changed overrides, and the layout diff summary from AGT-7.
- Tables:
  - `scenarios`
  - `scenario_runs`: `scenarioId`, the HAC-22 `comparisonId` and run IDs, status
  - `project_active_scenario`

**Files.** `lib/contracts/scenario.ts`, `lib/scenario/model.ts` (+ test), a Drizzle schema
and migration.

**Acceptance.**
- [ ] Scenarios cannot be updated in place. Any change creates a new row whose `parentId`
      points to the previous version.
- [ ] `diffScenarios` covers every field and is symmetric (the reverse diff inverts the
      forward diff).
- [ ] `[CONTRACT]` has been posted on the board, mentioning the HAC-22, HAC-23 and SIM-8
      owners.

**Links.**
- Blocked by: **HAC-9** (database; In Review)
- Blocks: AGT-2, AGT-3, AGT-7, AGT-11
- Related: HAC-22 ✓, HAC-23 ✓, SIM-8 (lever changes become versions), DS-2 (shows the
  active scenario)

**Suggested owner.** Backend lane.

---

## AGT-2 Scenario API

**Scope.**
- `POST /api/projects/[projectId]/scenarios`: create a scenario, or fork one when the body
  has `{ fromId, patch }`.
- `GET` routes: list (tree), get, and diff (`?against=`).
- `POST .../scenarios/[id]/revert-to`: creates a new version whose contents equal the
  target version. History is never deleted.
- `POST .../scenarios/[id]/run`:
  - calls HAC-22 with the scenario's sites and overrides
  - stores a `scenario_runs` row
  - reuses HAC-23's checkpointed `advance` pattern when the run would exceed `maxDuration`
- A **per-project run budget** in site × seed × day-type units. A response that would go
  over budget returns `needs_confirmation` instead of running.

**Files.** `app/api/projects/[projectId]/scenarios/**`, `lib/scenario/service.ts` (+ test).

**Acceptance.**
- [ ] Forking and then running a scenario with unchanged overrides gives the same metrics
      as its parent, from the cache.
- [ ] Revert creates a new version and leaves history intact.
- [ ] Requests over budget return `needs_confirmation` and run nothing.

**Links.**
- Blocked by: AGT-1, HAC-22 ✓
- Blocks: AGT-3
- Related: HAC-52 ✓ (checkpoint store and `advance`), HAC-56 ✓ (evaluation assembly)

---

## AGT-3 Copilot tool set (extends HAC-23)

**Context.** The copilot needs tools for every change a founder might ask for. Each tool
must go through the same code path the UI levers use.

**Scope.** Add these tools next to HAC-23's tools: `search_sites`, `get_catchment`,
`poll_customers`, `evaluate_sites`, `run_sensitivity` and `get_site_run`.

| Tool | Does | Returns |
|---|---|---|
| `fork_scenario(from_id, label, rationale)` | Creates a new version | Scenario ID and diff |
| `set_hours(scenario_id, day_type, open, close)` | Version with new hours | Scenario ID and diff |
| `set_staffing(scenario_id, by_hour?)` | Headcount, optionally per hour block | Scenario ID and diff |
| `set_price(scenario_id, avg_ticket \| tier)` | Sets the price; re-asks the panel's `price_ok` (HAC-22 sensitivity) | Scenario ID, diff, price-acceptance shift |
| `set_stations(scenario_id, n)` | Station count, checked against the layout and SF | Scenario ID, diff, warnings |
| `edit_layout(scenario_id, ops[])` | Typed layout operations (AGT-7) | Layout ID, validation result, derived simulation parameters |
| `find_sites(preferences)` | Free-text area, "near X", rent ceiling, size, must-haves → HAC-16 search | Candidate IDs with evidence |
| `add_sites` / `remove_sites` | Changes the shortlist (at most 8) | Scenario ID and diff |
| `run_scenario(scenario_id)` | AGT-2 run | Run status and comparison ID |
| `compare_scenarios(a, b)` | Metric deltas with intervals, plus whether the ranking changed | Comparison references |
| `explain_hour(run_id, hour)` | SIM-2 bucket: arrivals versus capacity, waits, walk-aways | References |
| `diagnose(run_id)` | Bottleneck classification (AGT-10) | Findings with references |
| `focus_view(...)` | UI action (AGT-9) | Acknowledgement |

Rules:
- Schemas are Zod, defined in `lib/contracts/`.
- Tools return summaries with IDs, never raw event lists.
- Every mutation goes through `lib/scenario/service.ts`, the same function SIM-8's levers
  call.
- Numbers in tool results are typed references the client resolves. The model's text cites
  them.

**Files.** `lib/agent/tools.ts` (HAC-23 creates it, this ticket extends it),
`lib/agent/tools.test.ts`.

**Acceptance.**
- [ ] Every tool has a scripted-model test, using the pattern in `lib/agent/runner.test.ts`.
- [ ] Every mutating tool creates exactly one scenario version, with `author: "agent"` and a
      rationale.
- [ ] A lever change in SIM-8 and the equivalent tool call produce identical scenarios
      (apart from `author`). If SIM-8 hasn't merged yet, test this against
      `lib/scenario/service.ts` directly, and SIM-8 adds the UI-side test when it lands.

**Links.**
- Blocked by: AGT-1, AGT-2, AGT-7 (`edit_layout`), SIM-2 (`explain_hour`), HAC-23 ✓
- Blocks: AGT-4, AGT-10, AGT-12
- Related:
  - HAC-56 ✓
  - SIM-8 (shared mutation path; a soft dependency, see Acceptance)
  - HAC-60 (`add_sites` must not change other sites' catchments)

---

## AGT-4 Copilot runtime

**Scope.**
- One **durable conversation thread per project**, stored in Postgres: messages, tool
  calls and the agent's todo plan.
- Intake (HAC-19's `save_profile`) is the first phase of the same thread, not a separate
  agent.
- Built on `deepagents` with planning (todos) enabled. The todos are streamed to the client.
- Filesystem and sub-agent middleware stay disabled, as in `runner.ts`, unless a ticket
  needs them.
- **UI context on every turn:** current page, selected site, selected customer, sim minute,
  active scenario and visible chart. "Make this cheaper" then resolves to what the founder
  is looking at.
- Streaming responses through a route handler (SSE).
- **Limits:**
  - tool calls and wall time per turn
  - a per-project cost cap
  - when a turn nears `maxDuration`, a checkpoint is saved and the turn resumes through
    HAC-23's `advance`
- Models: OpenAI through `ChatOpenAI`, as in HAC-53.
  - Default turns use `OPENAI_MODEL`.
  - `diagnose` and plan turns use `OPENAI_PLANNING_MODEL`, falling back to `OPENAI_MODEL`.
- With `OPENAI_API_KEY` unset, the copilot returns the same "not configured" error as
  intake. Tests and the build still pass.

**Files.** `lib/agent/copilot.ts` (+ test), `lib/agent/thread-store.ts`,
`app/api/projects/[projectId]/copilot/route.ts` (stream),
`app/api/projects/[projectId]/copilot/[turnId]/advance/route.ts`.

**Acceptance.**
- [ ] A turn cut off by the time limit resumes without repeating completed tool calls.
- [ ] Reloading the page restores the thread, todos and pending diff cards.
- [ ] Reaching a limit ends the turn with the findings so far and a clear message.
- [ ] No provider keys reach the client bundle, as checked by
      `scripts/check-client-bundle.ts`.

**Links.**
- Blocked by: AGT-3, HAC-23 ✓
- Blocks: AGT-5, AGT-9
- Related:
  - **HAC-53 ✓** (OpenAI runner)
  - **HAC-66** (intake screen wiring: the thread starts from it)
  - HAC-19 ✓ (`save_profile`)
  - HAC-52 ✓ (checkpoints)
  - HAC-47 (the client-bundle and secret checks)

---

## AGT-5 Copilot dock UI

**Scope.**
- A persistent dock on **every workspace page**: intake, map, site, city, comparison and
  plan. It can collapse, and on phones it becomes a bottom sheet.
- Contents:
  - chat
  - the agent's **todo plan** with live status
  - a **tool activity feed**, evolved from `components/ConsultantPanel.tsx`
  - **Diff cards** for each agent change, showing a scenario diff and metric deltas once the
    run finishes, with **Keep** / **Revert** / **Open in city view** buttons
  - a confirmation card when `needs_confirmation` is returned (over budget)
  - suggested-next-action chips generated by the agent, for example "Try opening at 6am" or
    "Compare with a Heights site"
- A scenario switcher (tree or breadcrumb) that sets the active scenario for every page.
  DS-2's context bar shows the result.
- Follow DS-1's tokens, and use glass only if the dock floats over the 3D view (DS-1 rule).

**Files.** `components/copilot/*`, workspace layout wiring in
`app/(pages)/projects/[projectId]/layout.tsx`.

**Acceptance.**
- [ ] Every agent mutation produces exactly one diff card, and Revert creates a revert
      version.
- [ ] The dock keeps its state across page navigation.
- [ ] Passes axe checks, including keyboard-operable diff cards.

**Links.**
- Blocked by: AGT-4, DS-2 (where the scenario appears)
- Blocks: AGT-6, AGT-11
- Related: HAC-10 ✓ (page shell), HAC-35 ✓ (ConsultantPanel contract), DS-1, DS-3

---

## AGT-6 Agentic location exploration

**Context.** The founder should be able to keep exploring places they like instead of being
stuck with two sites.

**Scope.**
- A heart / "add to shortlist" button on map markers and on the site detail page. It sends
  a `shortlist_intent` to the copilot. The agent forks a scenario and runs it.
- Free-text requests go through `find_sites`, for example "something near Rice Village",
  "cheaper than the Heights one" or "a corner with parking". The agent explains the
  tradeoffs with cited CoStar and catchment evidence, then proposes or applies a fork.
- Remove the fixed 2-site comparison so a scenario can hold up to 8 sites.
- A **multi-scenario comparison view** that compares rankings and metrics across 2–4
  scenarios, with intervals.

**Files.** `components/map/*` (heart action), `components/comparison/scenario-compare.tsx`.
Retiring `example-comparison.ts` as the data source needs coordination with HAC-25.

**Acceptance.**
- [ ] Hearting a site leads to a forked scenario, a run, and a diff card showing how the
      ranking changed.
- [ ] A free-text location request finishes with at least one cited candidate, or with
      cited findings explaining why none match.

**Links.**
- Blocked by: AGT-5, HAC-16 ✓, HAC-25 (comparison screen ownership)
- Related:
  - HAC-55 ✓ (live map and site detail)
  - **HAC-60** (adding sites must not change other sites' catchments)
  - HAC-62 (the robustness headline per scenario)
  - SIM-11

---

## AGT-7 Typed layout model

**Context.** "Change the layout" has to mean something the simulation understands, not just
a picture.

**Scope.**
- `Layout` is defined in `lib/contracts/layout.ts`:
  - room bounds, taken from the Matterport dimensions (SIM-12) when there is a scan,
    otherwise a rectangle derived from listing SF
  - entrance
  - counter or reception
  - `stations[]` (type and footprint)
  - `seating[]`
  - a queue polyline
  - a back-of-house zone
  - origin for each element (`matterport`, `costar`, `founder`, `agent-proposed`)
- Layout ops (`add_station`, `move`, `remove`, `set_queue_path`, `add_seating`, …) are
  applied immutably, and each produces a new `layoutId`.
- Validation:
  - elements fit inside the room and don't overlap
  - minimum clearances
  - an approximate accessible path from the entrance to the counter
  - the stations-per-SF ceiling from the category's `sfPerStation`
- `deriveSimParams(layout)` returns:
  - the station count
  - **queue capacity**: how many people fit along the queue path; arrivals beyond it balk
  - seating capacity and dwell
- The engine gains an optional `queueCapacity` in `SiteConfig` (`lib/sim/contracts.ts`).
  When it is absent, behavior is byte-identical to today.

**Files.** `lib/contracts/layout.ts`, `lib/layout/*` (+ tests), `lib/sim/engine.ts` (the
`queueCapacity` change).

**Acceptance.**
- [ ] Invalid ops are rejected with field errors the agent can read and fix.
- [ ] Making the queue path shorter lowers the queue capacity and increases balks on the
      fixture.
- [ ] `[CONTRACT]` has been posted for the `SiteConfig` change.

**Links.**
- Blocked by: AGT-1
- Blocks: AGT-3 (`edit_layout`), AGT-8
- Related:
  - HAC-13 ✓ (engine; the `queueCapacity` change)
  - SIM-12 (room bounds, optional)
  - SIM-14 (scan capacity: both feed `SiteConfig`, so agree on precedence)

---

## AGT-8 Layout rendered in Matterport

**Scope.**
- Extend SIM-13's Matterport view. Showcase SDK scene objects render the layout's counter,
  stations, seating and queue path **inside the scan**, in scan coordinates. They are
  registered to the room bounds.
- Agent `edit_layout` calls update the scene live, with a short highlight on what changed.
- The founder can **drag** elements. A drop validates the layout (AGT-7) and creates a
  founder-authored version. Invalid drops snap back and show the reason.
- **Simulated customers** (SIM-13) follow the new queue path and stations right away after
  a rerun.
- Fallback: the r3f modeled interior, using the CoStar floor-plan texture when there is one
  and a plain room otherwise. It is always labeled "Scanned interior", "Listing floor plan"
  or "Modeled layout".

**Files.** `components/interior/layout-objects.tsx`, `components/interior/layout-editor.tsx`.

**Acceptance.**
- [ ] Agent and founder edits round-trip: the rendered positions match the `Layout` stored
      for that version.
- [ ] The fallback renders the same layout identically, apart from the backdrop.
- [ ] Matterport display terms from HAC-14 are respected: nothing is recorded or exported
      beyond them.

**Links.**
- Blocked by: AGT-7, SIM-13
- Related: SIM-12, HAC-14 (real scans and display terms), AGT-11 (layout thumbnail)

---

## AGT-9 Agent drives the live view

**Context.** Being agentic should include showing, not just telling.

**Scope.**
- A `focus_view({ view: "city" | "interior" | "insights", siteId?, minute?, customerId?, camera?, highlight? })`
  tool. The server emits it to the client over the copilot stream, and the city and
  interior views apply it.
- Example: the founder asks "Why do people leave at 8am?" The agent runs `explain_hour`,
  picks a customer who walked away, calls `focus_view` to seek to 08:00 and follow that
  customer, and narrates with cited numbers.
- A founder interaction (drag, scrub) always takes control back from the agent.

**Files.** `lib/agent/ui-actions.ts`, plus hooks in `components/city/*` and
`components/interior/*`.

**Acceptance.**
- [ ] `focus_view` is deterministic: the same arguments always produce the same view state.
- [ ] A founder interaction cancels any pending agent camera move.

**Links.**
- Blocked by: AGT-4, SIM-6, SIM-13
- Related: SIM-9 (follow-a-customer camera), SIM-15 (city and interior transition)

---

## AGT-10 Proactive diagnosis and experiments

**Scope.**
- After every run, `diagnose(run_id)` classifies the bottleneck for each site and hour
  block, using SIM-2 and the catchment:
  - **demand-limited**: capacity sits idle
  - **capacity-limited**: walk-aways grow with line length
  - **rent-limited**: contribution is negative at the median
  - **competitor leakage**: a customer segment chooses a competitor (Jev or Huff share)
- The agent proposes 2–3 targeted experiments, for example "a 3rd station from 7–10am",
  "open 30 minutes earlier" or "a site closer to the worker cluster".
- Within the run budget, the agent **auto-runs them as forks**. It reports the winners as
  diff cards and asks before going over budget.

**Files.** `lib/agent/diagnose.ts` (+ test).

**Acceptance.**
- [ ] On a capacity-limited fixture, the diagnosis says "capacity-limited", and at least one
      auto-run experiment reduces walk-aways.
- [ ] Every finding cites run IDs and hour buckets.

**Links.**
- Blocked by: AGT-3, SIM-2
- Related: **HAC-62** (start from its robustness summary: which assumption flips the
  ranking), HAC-22 ✓ (sensitivity), SIM-10 (callouts must agree)

---

## AGT-11 Living business plan

**Scope.**
- HAC-24's `LocationPlan` is regenerated whenever the active scenario changes or a run
  finishes. Old plans stay attached to their scenario versions.
- A **decision changelog** lists each agent and founder change with its rationale, a link to
  the version and the metric deltas.
- **"Why?"** on any line of the plan opens its citations: scenario, run, evidence and hour
  bucket.
- The plan names the **layout**, hours and staffing of the chosen scenario, with a layout
  thumbnail from AGT-8.
- Export goes through HAC-26.

**Files.** `lib/agent/plan.ts` (extends HAC-24), `components/plan/*`.

**Acceptance.**
- [ ] The plan always matches the active scenario's IDs, and a mismatch fails the build.
- [ ] Every line in the changelog links to a version.

**Links.**
- Blocked by: HAC-24 ✓, AGT-1, AGT-5
- Related:
  - HAC-26 (export; In Development)
  - HAC-37 (export E2E)
  - HAC-62 (the plan leads with robustness)
  - DS-5 (decision-first layout)

---

## AGT-12 Guardrails and agent evals

**Scope.**
- Extend the HAC-24 no-invented-numbers check to copilot chat. A number in model text that
  doesn't resolve to a reference is either stripped and flagged, or the turn is retried.
- Enforce the run budget and cost cap, and test that enforcement.
- **Eval set** (`lib/agent/evals/`): about 20 scripted founder requests, each with the
  expected tool calls and scenario diffs. Examples:
  - "Open at 6am on weekdays"
  - "Add a third barber chair"
  - "Make the line shorter at lunch"
  - "Compare with something in Silver Lake"
  - "What if rent is 10% higher?"
  - "Move the counter to the back wall"
- The evals run offline with a scripted model in CI, and live on demand against
  `OPENAI_MODEL`. The live run is skipped unless `OPENAI_API_KEY` is set.

**Files.** `lib/agent/guards.ts` (+ test), `lib/agent/evals/*`.

**Acceptance.**
- [ ] The offline eval suite passes in CI.
- [ ] The live eval report is checked in as a doc, with tool-call accuracy and diff
      accuracy.

**Links.**
- Blocked by: AGT-3. The eval set grows with each tool.
- Related: HAC-24 ✓ (no-invented-numbers check), HAC-53 ✓, HAC-47 (CI)

---

## AGT-13 End-to-end tests

**Scope.** A Playwright journey on the HAC-29 harness, using a scripted copilot model:
1. Do intake by chat.
2. The agent builds a shortlist, runs it and shows a diff card.
3. The founder hearts a site on the map, and the agent forks and runs a new scenario.
4. "Open at 6am": a diff card shows the change, then Revert restores the previous version.
5. "Add a third station by the window": the layout updates in the interior view (the
   fallback is fine), and the simulation is rerun.
6. "Why do people leave at 8am?": the view seeks and follows a customer.
7. The plan updates, and its changelog lists every step.

Run it at 375 px and at desktop width.

**Files.** `tests/e2e/copilot-journey.spec.ts`.

**Acceptance.**
- [ ] The journey passes on a Vercel preview, and it is deterministic across 3 runs.

**Links.**
- Blocked by: AGT-1 to AGT-12
- Related: HAC-29 ✓ (harness), HAC-39 (full founder journey on production), HAC-30 ✓
  (intake E2E, which step 1 replaces or extends)

**Suggested owner.** frank-claude (test lane).
