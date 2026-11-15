# Spatial experiment preview engine

The spatial preview is pure TypeScript under `lib/spatial/`, using the existing seeded RNG, stay-curve interpolation and percentile semantics. It is a bounded first implementation, not a replacement for the existing saved scenario evaluator. No provider, database or filesystem call happens during execution. Catalog source facts come from `lib/furniture/catalog.ts`; prices, demand and operational performance are not inferred from Poly Haven assets.

## Public API

Import from `lib/spatial/index.ts`:

- `createSpatialDraft({projectId, siteId, city, category?, widthM?, depthM?})`: returns an authored assumption-based draft, empty of proposed furniture, with explicit fixed service infrastructure. Cities are `houston` and `los_angeles`; categories are `coffee`, `quick_food`, `salon_barber`, `fitness`.
- `applySpatialCommand(draft, command)`: validates and clones atomically, increments revision, returns the new draft. Commands use `type`: `add`, `remove`, `move`, `rotate`, `clear`, `settings`. Coordinates are item centers in meters; rotations are 0/90/180/270 degrees. Clear removes proposed furniture only, preserving the explicitly assumed fixed infrastructure.
- `spatialReadiness(draft)`: returns `{runnable,reasons,source,capabilities}`. Runnable does not mean measured, calibrated, or Jev-backed.
- `getSpatialPolicyStates(draft)`: returns three synthetic persona states with state key/context hash, route distance, seat count, category, service time and average ticket. Context hash includes behavior-relevant room/furniture/settings/city fields, excluding decorative catalog items and metadata-only revisions.
- `runSpatialExperiment({baseline,variant,seeds?,policies?})`: synchronous pure paired experiment, default seeds `[11,29,47]`, maximum ten distinct uint32 seeds. Policy shape is `{baseline?:SpatialPolicy,variant?:SpatialPolicy}`. Results snapshot both drafts, supplied policy records, customer routes, engine events, decisions, category-specific stages, aggregates and paired deltas.

Contracts are in `lib/contracts/spatial.ts`. `SpatialExperimentResultSchema` checks shape only: a browser-submitted result is not server-confirmed evidence. Reports must recompute from scoped validated drafts and validated policy snapshots. The helper rejects mismatched baseline/variant draft, project, site, category or city. It does not provide authentication; existing request authorization must gate its caller.

## Spatial effects

A bounded 0.5 m grid searches a four-direction route from the authored entrance to the authored service point. Non-decorative furniture footprints block cells with 0.4 m inflation. Invalid/outside/overlapping furniture and blocked service routes are rejected. Routes use assumed 1 m/s walking; changed travel alters arrival time at the queue, near-closing completion opportunities and customer decision observations. Fitness free floor area also constrains capacity. This is not detailed multi-agent collision avoidance, dynamic crowd physics, exact polygon geometry or accessibility certification. Grid paths and authored rectangle geometry are explicitly approximate. Non-grid-aligned endpoint coordinates are preserved with checked connector segments; snapped indices are clamped within the grid and every route edge is tested against inflated obstacles. A blocked nearest-grid connector is conservatively rejected even if a finer route might exist.

Available chair/stool seats inform a synthetic seat-seeking persona. Tables do not themselves create seats; chair items do. Seat occupancy and dwell are not simulated. Household furniture does not become measured salon equipment or fitness machinery.

## Operating adapters

- Coffee: staff-constrained service positions, visible queue, join/balk choice, waiting/abandonment, service completion.
- Quick food: staffed ordering releases the order position after at most one minute; separately bounded preparation resources and pickup/walking delay determine completion and revenue. Preparation/pickup stage events are retained.
- Salon/barber: capacity is the minimum of declared fixed service chairs and assumed qualified staff. A seeded fraction of synthetic visitors takes the next modeled appointment slot; walk-ins are unscheduled. Appointment waits receive a separate tolerance. This does not implement actual booking calendars, priority reservations, lateness, skill matching or no-shows.
- Fitness: capacity is the minimum of declared resources, free area divided by assumed 4 square meters/person and eight participants per assumed instructor. Visitors enter the next available scheduled session, occupy capacity for modeled dwell, and earn revenue only on completion. Session starts align to the configured session interval. No checkout queue is substituted for session occupancy.

Adapter settings are editable assumptions: `resourceCapacity`, `appointmentFraction`, `sessionIntervalMin`, and `pickupMin`. Staff is at least one. Staff count/duration drives wages; no rent, catalog purchase costs, taxes or other overhead is included in daily contribution. Service/session durations are seeded lognormal draws around the supplied mean. Fixed infrastructure is separate from proposed catalog furniture and must be shown as assumed by consumers.

## Behavioral provenance and reproducibility

Without a supplied policy, decisions are labeled `assumed`: editable operating facts, queue length, route length and seat observations feed explicit authored probabilities. There are no hidden Jev requests. Different categories do not imply validated customer behavior.

An injected `SpatialPolicy` requires source `jev`, actual model version, evidence ID and complete states whose exact observed fields match the current layout. Each state supplies strictly ascending `stayByQueue` probabilities. Callers must establish provider authenticity and approved sharing/spend; the schema alone cannot authenticate an external response. Missing/mismatched state coverage throws, rather than relabeling defaults Jev. Model probabilities directly change join/leave engine transitions. Decisions retain state key, inputs, draw, probability, action, model and evidence ID. Snapshotted policies allow replay without another provider call. Partial baseline-only coverage is labeled `mixed`.

Arrival, per-customer service, appointment and decision random streams are independent. Identical policy versions/drafts/seeds reproduce results. Editing revision alone has no economic effect. A geometry edit can correctly have no material effect; no improvement is forced.

## Accounting and ranges

Customers arrive before close; those still walking at close are counted separately. Every generated customer is served, abandoned (balked or reneged), waiting at close, in service/preparation/pickup at close, or walking at close. Revenue is recognized only when service including supported downstream stages completes by close. Events retain local minutes; Houston uses America/Chicago and Los Angeles America/Los_Angeles.

Aggregate metrics are empirical means/p5/p95 across supplied seeds. Deltas summarize paired seed differences. These are not confidence intervals. Completed-customer waits are null when no completions occur; wait bands omit unobserved seeds, and paired wait deltas require observations on both sides. All other counts include actual zeros. Representative playback must not be presented as the aggregate result.

## Verification

`pnpm exec vitest run lib/spatial` covers immutable edits, bounds/overlap/identity errors, workload limits, scope, reproducibility, causal route/timing/state changes, external policy effects, all eight city/category combinations, explicit resource constraints, closing conservation and null wait availability. No live provider calibration or selected-unit geometry verification is established by these offline tests.

Boundary regression tests also cover 4.4 m rooms, actual endpoint preservation, out-of-room grid aliases and endpoint/obstacle intersections.

## Selected-building preparation

Room `source` is `assumed` or `matterport-bounds`. A bounds-based room records an exact `scan` binding (model/floor/room IDs and normalized native bounds); it is still an approximate rectangular envelope. Initial empty drafts can be prepared from current selected-suite dimensions, while existing edits are never silently resized or overwritten. Changes to source invalidate prior run/review. API-to-SDK geometry must carry the `showcase-y-up-v1` marker; legacy caches cannot calibrate native overlays.

The `layout` command replaces the entrance and service point together, validates reachability and increments revision just like furniture edits. This enables the same engine to use different building anchors instead of inheriting café coordinates. A furniture edit or layout change feeds the same saved spatial result used for playback and report; it does not update the independent historical café fixture.

## Jev preparation and saved evidence

Live interior preparation initially supports coffee in either city. States now include the same effective service capacity used by the engine, visible staff and an estimated per-person queue wait. Three synthetic personas answer queue buckets 0/4/10 based on route distance, proposed available-seat observation, price and service/capacity. These remain synthetic business observations, not a calibrated customer population or dynamic seat occupancy model.

The default live action prepares probabilities outside rendering; the explicit assumed-preview action makes no provider call. Saved baseline/proposal policies are attached to the scoped flow and report and are used for every recomputation, including movement/inspection and final metrics. A server-signed receipt authenticates the exact policy inputs/snapshots; a schema-valid browser label alone is not evidence that Jev issued a response. Finalization re-verifies the receipt without a new provider call. Editing furniture, anchors or settings clears policies, receipt and run/review eligibility.
