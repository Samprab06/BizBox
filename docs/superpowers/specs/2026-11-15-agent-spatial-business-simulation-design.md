# BizBox: agent-controlled spatial business simulation

Status: proposed full feature specification for Akshar review. No implementation or paid/vendor activation authorized by this document.
Date: November 15, 2026.
Base: codex/bizbox-matterport-simulation, from origin/frank/scene-1-flow at 3ca12790e594917390d789208d989c9fdc090ed0.

## 1. Intent and product decisions

BizBox lets a founder work through the existing FDE/AI consultant to design a business inside a space, test operating decisions, inspect simulated customers, and add grounded findings to the business report. Interior changes must affect relevant customer decisions and operational outcomes, rather than only changing an animation.

Akshar requires generalization across buildings and business types; LA and Houston data; visible Jev-driven customers; multiple experiment types; a furniture/equipment catalog with visible additions/removals; and control through the existing FDE/AI. Preserve the current consultant conversation and project context. Direct manipulation is an optional companion input, not a separate product or required editor workflow. Both paths use the same validated commands.

Success journey: “Show this unit's interior. Add two tables and move pickup away from checkout. Compare that with another employee during lunch. Why did customers leave? Add the findings and costs to my report.” The consultant resolves objects, previews changes, identifies missing inputs, executes the requested comparison, shows saved results, and cites them in the report.

This is a project with staged delivery. Full acceptance includes multiple operating models and cities, not just a polished café demo.

## 2. Approaches and recommendation

A. Extend the current café replay alone: quickest demonstration, but insufficient for spatial decision effects and broader business operations.
B. Hybrid behavioral panel + spatial discrete-event engine: recommended. Jev produces versioned decision probabilities from structured customer observations; a seeded engine handles routing, resources, service, time and money. Results are stored and replayed. This extends existing architecture while making interior effects explicit.
C. Live model calls for every moving person on every frame: unsuitable as the default because latency, request volume and nondeterminism obstruct reproducible comparisons.

B is the manager's proposal, not an already approved architecture decision. Benchmark state coverage and provider cost before choosing decision-state resolution. No new hosted service or dependency is approved here.

## 3. Existing implementation and gaps

- `lib/panel/`: catchment personas, Jev state/questions, cached answers, retries, deadlines and resumable panel computation. Current behavior covers venue choice, visit frequency/time, queue tolerance and price acceptance. It is not a general spatial policy engine.
- `lib/sim/`: seeded arrivals, queue/service/abandonment events, hourly metrics and monthly economics. Existing illustrative interior travel does not determine business outcomes.
- `lib/layout/` and `lib/contracts/layout.ts`: immutable layouts, footprints, queues, entrances, seating records and approximate route/clearance validation. These do not establish dynamic congestion or code compliance.
- `lib/scenario/`: immutable scenarios, saved layout snapshots, reproducible seeds, resumable runs and work budgets.
- `components/interior/`: Matterport SDK scene overlays, placement calibration, camera and replay integration. `SelectedInterior` currently uses a plain selected-site embed.
- `lib/interior/`: registry, provenance, dimensions adapter and cache. Normal-site licensed access remains explicitly gated. A public reference café is not a selected Houston/LA property.
- `lib/insights/`, `lib/evaluation/`, `lib/export/plan.ts`: stored comparison metrics, hourly bands, constrained station experiments and grounded report projection.
- Category fixtures exist for coffee, quick food, salon/barber and fitness; their presence does not mean each category has a validated operating model.
- CoStar adapter/catalog inspection has not established furniture catalog availability. Do not invent an endpoint or claim catalog coverage.
- `docs/public-data-import.md` documents Census preparation for both metros; current live database coverage, LODES and Overture availability must be audited separately.

## 4. Scope and operating models

Full feature supports these declared adapters, with capability/readiness checks per scenario:

1. Counter service: coffee and quick food; entry, join/balk, order/payment, preparation, pickup, optional seating and exit.
2. Appointment/walk-in service: salon/barber; booking/arrival/no-show, waiting, compatible staff/chair assignment, service and exit.
3. Session/capacity operation: fitness; scheduled or walk-in sessions, equipment/space/staff constraints, session occupancy and exit.

Each adapter declares its process graph, resources, decisions, data needs and metrics. Do not reuse a single queue and rename its labels to claim different business models. Generic retail checkout is an extension candidate, not required by existing category support. Multi-floor geometry is represented; multi-floor pedestrian simulation must remain unavailable until connector/routing support passes acceptance.

Non-goals: observed-human digital twins, guaranteed financial forecasts, automatic building-code certification, photoreal reconstruction/remodeling of Matterport imagery, automatic furniture purchases, unlimited city/category coverage, and unbounded paid AI activity.

## 5. Canonical model and invariants

Extend existing Zod contracts and immutable repositories rather than creating a parallel scenario system. Proposed concepts:

- Space: stable city/property/unit/floor/room IDs, timezone, source mappings, geometry revision, floor polygons, obstacles, doors, entrances and floor connectors where supported.
- Spatial evidence: measured/estimated/authored status per field, units, transform, scope, timestamps, source IDs, display/export rights and limitations. Unknown geometry stays unknown.
- CatalogItem: source/vendor ID and version; category, dimensions, footprint, orientation/clearance, render asset or proxy, capacity/resource role, price/currency/date, operating costs and evidence. Missing fields have explicit availability states.
- PlacedItem: immutable instance ID, catalog version, position/orientation/floor, existing/proposed/removed status, override evidence and operational bindings.
- OperatingModel: process graph, staff skills/shifts, equipment/seats, service-time distributions, appointment/session policy, costs and demand configuration.
- Customer: synthetic stable ID, sampled persona reference, needs/preferences, arrival identity, current state, route, observations and decision references. Population weights determine arrival generation, not multiple physical customers compressed into one dot.
- DecisionPolicy: provider/model/prompt/state-schema versions, supported choices and probabilities, input snapshot/hash, source mode, coverage and failures.
- Experiment: baseline/variant IDs, hypothesis, typed edits, expected causal mechanisms, fixed inputs, seed/demand coupling, readiness, work/cost estimate and status.
- ResultBundle: immutable scenario/layout/geometry/catalog/behavior snapshots, all version IDs, seeds, events, per-seed outcomes, aggregates, limitations and report references.

Shared identity invariant: visualization, customer inspection, metrics and report read the same saved run and scenario version. No client-side rerun or silent substitution. Edits mark existing results stale. Property scans cannot silently become measured suite geometry.

## 6. FDE/AI control contract

Add bounded tools to the current consultant, with names finalized during implementation:

- Inspect space, data readiness, available experiments and catalog.
- Search/filter catalog; inspect item source, dimensions, cost and operational role.
- Propose/preview/apply typed layout and operating edits; undo by creating a version.
- Create/edit an experiment, estimate required work, run/advance/cancel supported jobs, compare saved results.
- Navigate camera/time, highlight object/queue/customer and inspect a saved decision.
- Explain findings and attach selected experiment results to the report.

The model never writes SQL, arbitrary geometry or arbitrary metric values. Server tools validate project scope, object IDs, category support, geometry and inputs. Ambiguous targets trigger clarification rather than changing a guessed object. A request such as “add two tables” authorizes reversible draft placement; the FDE previews the result and explains blocked placements. Execution follows existing user intent and run-budget confirmation policy. Page-load/events never independently initiate paid runs. Failed commands leave no partial layout mutations.

Responses include structured actions, changed IDs, new version, readiness, invalid placements and affected experiments. Chat and direct visual edits share the same command service and revision checks. Conflicting concurrent edits cannot overwrite a newer version silently.

## 7. Furniture catalog and visual editing

First inspect supplied CoStar API/kit documentation and authorized sample responses for an actual catalog, asset formats, dimensions, IDs, pricing, pagination, rate limits and permitted use. Record findings in a coverage manifest. This is a blocking discovery item for a CoStar-branded catalog, not for the provider-neutral catalog contract.

If absent, return to Akshar with the concrete gap and proposed sourced alternatives. Do not silently add a paid vendor, scrape a supplier, or label authored proxies as CoStar assets. Unknown price excludes a complete cost/payback claim until supplied or explicitly treated as an assumption.

Required interactions through FDE: add/remove/move/rotate/duplicate items; select an existing item; replace equipment; change table/seat count; edit queue and pickup zones; show baseline versus proposal. Render supported assets with matching dimensions; clearly labeled geometric proxies are allowed where assets are unavailable. Store model license/provenance and validate size/format before ingesting assets.

An item's operational role is explicit: table supplies seats, barrier blocks routes, counter supplies a service position, equipment affects a named process only when parameters exist. Decorative objects have no invented throughput or preference benefit.

Matterport overlay mode adds proposed objects and highlights removal intent. Removing a scenario item does not erase that item from scan photography. Editable modeled/cutaway mode shows the exact proposed arrangement with removed items absent. Keep an obvious mode/source indicator; do not present a ghosted scan object as physically removed. Physical furniture is distinguished from proposed overlays.

## 8. Spatial simulation and causal effects

Compile validated layout snapshots into walkable regions/routes and resource locations. Account for furniture footprints, doorways, entrance/exit reachability, floor selection and queue spill. Axis-aligned room bounds alone cannot establish accurate obstacle geometry; require authored/verified polygons when claiming spatial routing.

Use event-based arrival/service scheduling with bounded fixed-step pedestrian movement or equivalent deterministic routing updates. Choice of routing algorithm/dependency is an implementation decision requiring a benchmark and dependency approval where applicable. Walking time affects resource arrival, queue entry, pickup and departure. Crowding can delay movement and expose changed observations to customers. Staff travel affects service only in adapters explicitly modeling staff tasks. Prevent customer loss/teleportation, obstacle penetration and resource double booking.

For every operation document a causal chain: edit → route/resource/observable change → decision or timing change → event/metric change. A furniture move may legitimately produce no outcome change. Report that result rather than forcing improvement. Validate approximate clearance as model constraints, never legal/accessibility certification.

## 9. Jev decisions and visible customers

Jev-backed decisions must alter engine transitions, not merely generate explanatory text. Extend typed state/questions for supported decision points: choose venue/channel, enter or balk, join/leave observed queue, accept available seating/wait, choose eligible service option and respond to price. Booking/no-show/session decisions require their operating adapter and explicit policy inputs.

Customer observations contain only available information: displayed price, visible queue/estimated wait with its model, seat availability, observable crowding, offered services, time constraints and modeled route effort. Do not supply future outcomes or all-knowing ground truth to personas. Geometry enters decisions through meaningful observations, not a raw scene dump or screenshot by default.

Recommended mechanism: precompute/cache policies over bounded decision-state buckets, then use identity-and-decision-keyed seeded draws at runtime. Encountering uncovered states pauses/resumes policy preparation or uses an explicitly approved, labeled fallback; never silently invent Jev responses. Keep separate decision and service/demand random streams so an added decision does not perturb all unrelated draws. Provider calls are outside frame rendering. Store actual returned model version and validated probabilities. Exact replay uses saved policies/events, not fresh calls to a moving model alias.

Visible customer inspection shows persona summary, encountered state, available choices, policy probabilities, sampled action and consequences. These are synthetic decisions. No fabricated chain of thought or invented verbal quotation; any narrative is labeled as an explanation of the saved inputs/action.

Acceptance requires a controlled provider response to change a transition and downstream metrics; spatial edits must change decision inputs where relevant. Live provider evaluation measures sensitivity/repeatability; do not require every persona to change its mind or guarantee a direction for model probabilities.

## 10. Experiment matrix

- Staffing/shifts: skill-compatible resources, wages, coverage, staff task model where available.
- Stations/equipment: active capacity, process-specific service distributions, buildout/capex and operating costs.
- Furniture/layout: route length, congestion, queue capacity, pickup separation and reachable resources.
- Seating: table/seat capacities, party size, occupancy/dwell, wait/leave choices and turnover.
- Hours: demand by local time, shift coverage and day types; preserve city timezone.
- Pricing/menu/service options: acceptance and venue choice, service mix, ticket and costs; explicitly model demand response.
- Demand stress: arrival volume/mix/peaks, unchanged behavior versus re-estimated behavior explicitly distinguished.
- Location/unit comparison: each site's rent, catchment, competitors, geometry and feasible operating plan.
- Appointment/session policies: scheduling, duration, no-shows, staff/equipment contention and capacity.
- Combined changes: compare a named bundle; optionally isolate single changes for attribution. Never imply individual causation from a bundled experiment.

Each capability declares required data, supported operating adapters, decision points, metrics and readiness reasons. Unsupported requests get a concrete explanation and data/model steps, not made-up results.

## 11. LA and Houston data acquisition/readiness

Use Houston metro coverage documented in public import instructions; LA coverage is Los Angeles and Orange counties. Display coverage boundaries. Public demographic/jobs/places coverage is different from listing or interior coverage; do not claim every building has a scan.

For each city inventory and verify: source version, geographic extent, counts, retrieval time/checksum, missingness, licensing and successful database import. Existing Census preparation is evidence of prior preparation, not proof of current runtime availability. Audit CoStar units/listings and unit-level Matterport mappings separately. No hosted mutation without approval.

Required datasets:

- ACS/TIGER demographics and geometries; LODES jobs; Overture competitors/anchors with source attribution.
- Listing unit IDs, area, rent, available floor plans, entrance/address and listing vintage.
- Approved scans or floor plans, verified unit identity, measured geometry where available, transforms and authored obstacles/zones with provenance.
- Catalog assets/dimensions and operational specifications, cost dates and permitted display/export.
- Founder/business hours, ticket/service mix, shifts/wages, COGS, capex and recurring expenses.
- Calibration where available: aggregate POS arrivals/transactions by time/day, service and dwell samples, observed queue/abandonment, booking/no-show/session occupancy. Synthetic/assumed cases remain usable but labeled uncalibrated.

Readiness levels: visual-only; assumption-based runnable; spatially runnable; Jev-ready; calibrated. These are explicit independent checks, not a single misleading completeness score. Show missing fields and which experiment they block. Distinguish unavailable inputs from actual zeros. Broad city demographics cannot establish storefront traffic. Match local timezone, units, currency, geographic scope and vintage.

Minimum full-release demonstration coverage proposed: one coffee, one quick-food, one salon/barber and one fitness space in each city (8 curated spaces total). At least one approved, correctly mapped scan per city; all remaining cases need honestly identified floorplan/modeled alternatives. This is a proposed acceptance target, not a claim that these assets exist. Broader catalog/listing coverage is inventory-driven. Approval and acquisition of these assets is a dependency.

Use aggregate, authorized business data; avoid customer identities in persona construction. Keep proprietary kit/scan material inside approved storage/services and transmit only approved minimum structured facts to providers. Asset ingestion and rights review precede copying vendor material.

## 12. Results, reports and comparison validity

Report per-seed paired differences where comparable; retain day types and denominators. Common random numbers apply to comparable exogenous arrival identities and service needs; report actual differences when pricing/hours/venue choice changes demand. Fix persona cohorts and competitor study scope for within-site comparisons to avoid unrelated panel drift. Cross-site comparisons use a declared shared study population where meaningful, not an asserted identical customer stream.

Metrics include arrivals, entrants, balks, reneges, served, unfinished-at-close, waits, travel, congestion exposure, seat/session utilization, resource utilization, revenue, labor/COGS/operating costs, contribution and supported capex/payback. Separate representative replay from aggregate distributions; never sum marginal percentile endpoints or describe empirical bands as confidence intervals. Preserve current monthly assumptions and make new ones explicit.

Add a grounded operations/experiment section to the existing plan/export pipeline: hypothesis, baseline/variant, changed furniture/settings, causal interpretation, modeled deltas/ranges, costs, decision-source coverage, data readiness, limitations and immutable references. Findings can affect recommendation only through an explicit reviewed ranking policy; never silently change site ranking semantics. Missing costs prevent complete ROI claims. Export only permitted facts/assets; default scan imagery/geometry export remains gated. Stale results are identified and rerun is offered.

## 13. Execution, reliability and budgets

Remain within the current Next.js/TypeScript/Postgres architecture unless measurements justify an approved change. Reuse resumable scenario execution and durable checkpoints; benchmark longer spatial runs against existing route deadlines. Evaluate a worker architecture only if necessary, as a reserved architecture/cost decision.

Separate simulation work units from provider monetary usage. Estimate calls, state buckets, seeds, durations and assets before work; Akshar sets provider spend limits, project quotas and concurrency. No dollar limit is inferred from current scenario units. Cache policies by full behavior-relevant state/version, deduplicate in-flight work, enforce cancellation/deadlines, retry boundedly and persist partial progress. Preview costs before optional paid work. Offline modes remain explicitly labeled. No new external provider is enabled by this spec.

Validate scoped access to every scenario/object/result. Follow existing project authorization policy without inventing a new one. Sanitize errors and preserve server-only tokens. Untrusted catalog descriptions/provider responses are data, not instructions. No arbitrary remote asset URLs or executable model content; use an approved ingestion/allowlist policy and bounded downloads.

## 14. UX states and performance

Keep FDE visible while switching map/interior/layout/results/report. Show proposed changes immediately, mark simulations out of date, and allow inspect/undo/version comparison. Modes include loading geometry, missing scan, modeled fallback, invalid placement, preparing behavior, running, partial/resumable, failed and complete. Never substitute a public reference scan for the selected unit.

Playback supports shared-clock baseline/variant comparison, pause/scrub/reset, customer/resource selection and highlighted experiment changes. Rendering does not call Jev or determine metrics. Cap visible detail with honest aggregation/selection, retaining engine identities and counts. Preserve keyboard operation, textual results and WebGL fallback. Desktop is the initial workspace QA focus under current scope; retain existing responsive behavior.

Before shipping, propose and approve measurable workload targets for customer count, catalog asset size, policy-state count, run latency and replay frame time. Record reference hardware/browser and benchmark traces. Do not call unmeasured performance acceptable.

## 15. Delivery sequence and ownership

Manager owns architecture/contracts, cross-role decisions, evidence definitions, integration, validation and approval tracking. Delegate substantial bounded work to frontend/backend specialists once scope is approved and ticketed; shared files have one owner at a time.

P0 Discovery: audit actual city data, supplied CoStar catalog/API, scan inventory/rights, Jev capabilities and baseline runtime; produce coverage manifest, gaps, request/cost estimates and approved release targets. No implementation claim until these dependencies are resolved.
P1 Domain foundation: versioned space/catalog/operating/experiment/result extensions; readiness matrix; explicit mapping to existing layouts/scenarios; migrations only as needed.
P2 Vertical slice: FDE request → catalog edit/preview → run → inspect customer → attach report finding, using one mapped space, counter service, catalog placement, changed routing, two meaningful Jev decision points, saved baseline/variant and report evidence. Prove causal chain end to end before expanding.
P3 Spatial fidelity: furniture obstacles, seating and pickup, congestion effects, geometry validation and robust scan/model views.
P4 Agent experiments: full FDE tool workflow, multi-variable comparisons, undo, explanation and report integration.
P5 Generalization: all declared adapters, LA/Houston curated cases, city/category readiness and data/calibration import paths.
P6 Hardening: reproducibility, failure/resume/cancel, budgets, asset rights/export boundaries, accessibility, benchmarks and complete acceptance review.

Create Linear tasks only after approval; do not claim unrelated agent tickets or publish this document externally. Each phase gets concrete acceptance criteria and source references. Estimate delivery after P0, not from unverified access assumptions.

## 16. Acceptance and verification

1. User asks FDE to add/remove/move catalog furniture; scoped immutable edits appear in both the exact modeled proposal and permitted Matterport overlay. Undo restores a version; original scan content is not falsely erased.
2. Furniture blocks/lengthens a route in a controlled fixture, changes movement/observations and affects downstream events. A neutral/decorative edit produces no forced economic improvement.
3. Known Jev probability changes alter sampled customer transitions under controlled draws. Saved inspection identifies source inputs/probabilities/action. Layout effects reach relevant provider/cache inputs.
4. Same saved versions/policies/seeds reproduce results and replay without provider access. Cache invalidates when behavior-relevant facts change and does not rerun on camera-only changes.
5. Resource limits, nonnegative counts, no duplicated customers, legal transitions and arrival/completion/abandonment/unfinished conservation hold. Furniture/route validation rejects blocked or out-of-bounds edits.
6. Baseline/variant use declared random coupling; aggregations reconcile with per-seed records. Report values equal saved results and include limitations/uncertainty.
7. Two cities and multiple buildings do not share leaked transforms, timezones, identities or scan mappings. All curated adapters demonstrate genuinely distinct process behavior.
8. Missing scan/data/provider, unknown catalog prices, invalid outputs, deadlines, cancellation, concurrent edits and partial jobs remain explicit and recoverable without false completion.
9. Existing scenario/comparison/export paths remain compatible. Required lint, typecheck, Vitest and build pass; targeted integration and browser tests cover FDE → edit → run → customer inspection → report. Actual authorized Matterport and Jev smoke tests are required before claiming live integration, with spend approved beforehand.
10. Coverage manifest and documentation distinguish verified live data, recorded data, fixtures, assumptions and unavailable sources.

## 17. Decisions requiring Akshar review

- Approve hybrid behavioral-policy + spatial-engine approach and full operating-model scope.
- Confirm initial adapter ordering and proposed 8-space city/category acceptance set.
- Confirm available CoStar API/kit catalog documentation, scan inventory, display/geometry/export permissions and approved data-sharing destinations.
- Set Jev/AI spend limits and acceptable run/preview latency; approve any necessary vendor access or dependencies separately.
- Approve performance workloads after P0; decide whether operating findings may alter the existing location ranking policy.

No implementation, push, merge, deployment, purchase, production mutation or new vendor activation is implied by this specification.

## 18. Builder-review clarifications

- Baseline furniture requires an authored/verified inventory with stable object IDs, footprints, operational bindings and scan alignment. Automatic object recognition from Matterport is not assumed. Removing an item updates its obstacle/resource binding; photographed content remains under the visual limitations above.
- Before behavior implementation, P0 defines a small approved live Jev evaluation over paired interior-derived states. Record valid response coverage, state sensitivity and repeatability, with evaluation thresholds agreed before testing. If Jev is insensitive or unreliable for a decision, report the limitation and revise that capability rather than claiming validated behavior.
- Each adapter specifies event timing: arrival at property, entry, walking to queue, queue join, service start/end, preparation, pickup, seating start/end and exit. Define exclusive versus concurrent stages, which resources are occupied, when revenue is recognized, and how abandonment/closing affects unfinished work. Preserve completed-service revenue semantics unless an explicit versioned adapter policy changes it; no double-counted walking/service time or silently completed customers at close.
- Report attachments are versioned findings. The FDE marks a finding as appended evidence or an explicit supersession of an earlier finding; old evidence remains accessible. The founder selects the active scenario for the final operating recommendation. Contradictory results are surfaced and explained, not silently merged or overwritten. Attaching an experiment does not independently change location ranking.
- Four categories/eight curated spaces remain a proposed full-release acceptance set. Initial models, actual scan coverage and acquisition feasibility require review before scope estimates or ticket creation.

Builder review: read-only independent review completed; the clarifications above address its material gaps. Remaining approvals are listed in section 17.
