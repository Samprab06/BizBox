# City-scale simulation, scanned interiors and customer insights: ticket plan

Draft tickets for the HAC team. They are not yet in Linear and have no owners. They belong
in a new Linear project, **City simulation & insights**. Companion files:
[`agentic-business-plan.md`](./agentic-business-plan.md) (AGT-*, project "Agentic copilot")
and [`sitework-design-system.md`](./sitework-design-system.md) (DS-*, project "Sitework shell
& design system").

Each ticket has the same sections as the Linear tickets: Context, Scope, Files, Acceptance,
Links and Suggested owner. When a ticket is imported, prepend the standard "Product
context" and "Stack" blocks.

**Links** become Linear relations on import:
- **Blocked by**: can't start until that ticket is done.
- **Blocks**: the reverse relation. Set it on one side only; Linear mirrors it.
- **Related**: coordinate with or read; there's no hard dependency.

HAC tickets marked ✓ were already Done on 2026-11-14.

## Why

The replay we have today is an abstract three.js room (`components/replay/floor-plan.tsx`).
It shows a green plane, boxes for stations and spheres in a line. It is fed by a fixture
(`components/comparison/example-comparison.ts`) whose arrival times follow a made-up
`random^1.6` curve. HAC-57 has since connected the comparison and replay screens to stored
runs. The app has no charts and no peak-hour or time-of-day views.

### State of the `simulator-visualization` branch (2026-11-14)

The branch is visual work only. It doesn't change anything under `lib/`.
- `/simulator-demo`: a standalone, full-screen Cesium view of the Vexcel Houston 3D mesh
  around the Montrose fixture, through a server-side proxy at `app/api/vexcel/3d/`.
- OpenFreeMap road geometry. The "traffic" coloring is an invented time-of-day formula
  (`components/simulator/day-cycle.ts`), not measured traffic.
- Three invented demand anchors ("Apartments", "Offices", "Transit") with hand-picked
  peaks.
- Sun, sky and volumetric clouds tied to the timeline, and a frosted-glass UI.
- A 1-station vs 2-station café comparison (`components/simulator/fixture.ts`). It calls the
  real `simulateDay` and `computeMonthlyEconomics`, but with 110 hand-built customers on the
  same fake `random^1.55` curve and a fixed 2–6 minute service time, which bypasses HAC-64.

Existing tickets on this code:
- **HAC-65** (In Development): rendering performance only, on the toy data.
- **HAC-63** (Todo): opens the view from a stored comparison and run.

SIM-6 builds on this scene rather than replacing it.

We want to show a founder this:

1. **Their street.** A pitched 3D view of the neighborhood around the CoStar space they picked
   in Houston or LA. The candidate building is highlighted, along with nearby CoStar properties
   and competitors, and customer agents walk in from where they live and work.
2. **Inside the space.** Clicking the building flies into its **Matterport scan**, and the
   simulated line and service play out inside the real interior. When a space has no scan,
   the CoStar listing floor plan is used, then a modeled layout.
3. **Levers.** An Experiment panel with price, stations, staff, hours and demand. Changing them
   reruns the simulation deterministically, with a baseline-vs-current comparison.
4. **One customer.** An Inspect panel to find a customer, follow them and see why they
   stayed or left.
5. **Insights.** Peak hours, demand vs capacity, wait by hour, walk-aways by hour, revenue by
   hour, customer mix and an origin heatmap, with auto-generated callouts.

Every number keeps its origin label (`costar`, `public`, `founder`, `default`, and
`matterport` after SIM-14). Every view is labeled "modeled, not a forecast".

## What the data gives us (constraints)

- **CoStar** (`lib/db/costar-schema.ts`) has property **points only**, with no footprints or
  heights in columns. It also has type and subtype, a JSONB `data` field (height or stories
  fields are not yet verified, see SIM-1), spaces with rent, current tenancies, and
  attachments. `normalizeAttachments` in `lib/data/costar.ts` keeps `primaryPhoto`,
  `floorPlan` and `attachments[n]` URIs.
- **Building shapes** therefore come from the Vexcel 3D mesh already used on the
  `simulator-visualization` branch (Houston only, collection `us-tx-houstonr2-2023`). Where
  there is no Vexcel coverage (LA), they come from the OpenFreeMap `building` layer with
  `render_height`. CoStar decides what gets highlighted and what it means.
- **Matterport** connection details come in a separate zip that is not in the kit. Access is
  owned by **HAC-14** (Backlog), which already allows a fallback to photos and floor plans.
- **Hour-of-day demand** already exists:
  - `lib/demand/arrivals.ts` has `ratePerMinuteByHour` and `expectedVisitsByHour`, using the
    category time blocks in `fixtures/categories/*.json`.
  - The engine (`lib/sim/engine.ts`) emits continuous-time `SimEvent`s but **no hourly
    series**.
  - HAC-22's `get_site_run` already needs "waits by hour, abandonment by hour".
- **Customers have no positions.** `Persona` (`lib/demand/contracts.ts`) has lat/lng, but
  `Customer` and `SimEvent` (`lib/sim/contracts.ts`) do not.
- **Public geometry** in PostGIS: `public_block_groups.geom` (polygons), `public_jobs.point`
  (LODES) and `public_places.point` (competitors).
- **No chart library** is installed.

## Coordination

- **HAC-25** (Yasser, In Development) owns `components/replay/` and `components/comparison/`.
  New work goes in `components/city/`, `components/interior/` and `components/insights/`, and
  only *reads* `components/replay/replay-state.ts`. SIM-11 touches `comparison-screen.tsx`
  and must wait for HAC-25 to merge.
- **`components/simulator/`** is shared by HAC-65 (Akshar, performance), HAC-63
  (oracle-lead, stored runs), Yasser and Sam's visual commits, and DS-4 (moving it into the
  shell). Edit it in this order: **HAC-65 → HAC-63 → DS-4 → SIM-6**. One ticket at a time
  touches `neighborhood.tsx` and `demo.tsx`.
- **HAC-60** (catchment independent of candidate order) changes the inputs to SIM-4 and
  SIM-5. Use its output once it merges.
- **HAC-61** (provenance) and **DS-1** (evidence labels) define how origins are shown.
  Every chart and overlay here uses them.
- **HAC-22** (site evaluation) should use SIM-2's `hourlySeries` for `get_site_run`.
- **HAC-14** (Matterport access) blocks the real-scan half of SIM-12 to SIM-15. Until then,
  build against a recorded fixture and Matterport's public demo model.
- Contract changes that need a `[CONTRACT]` post first:
  - SIM-2: hourly types
  - SIM-5: `lib/contracts/scene.ts`
  - SIM-12: `lib/contracts/interior.ts` and the env vars
  - SIM-14: `OriginSchema` gains `matterport`

## Dependency order

```
SIM-2 ─► SIM-4 ─────────────┐
SIM-1 ─► SIM-5 ─────────────┤
HAC-65 ─► HAC-63 ─► DS-4 ───┴─► SIM-6 ─┬─► SIM-7, SIM-8, SIM-9
                                        ├─► SIM-13 (+SIM-12) ─► SIM-15
                                        └─► AGT-9
SIM-2 + SIM-3 ─► SIM-10 ─► SIM-11 (+HAC-25)
SIM-1 + HAC-14 ─► SIM-12 (fixture until HAC-14) ─► SIM-13, SIM-14 (+SIM-8)
everything ─► SIM-16 (tests, absorbs HAC-36)
```

SIM-2, SIM-3 and SIM-1 can start now. SIM-17 (Jev end to end) can also start now and
runs alongside the rest.

---

## SIM-1 Spike: what CoStar can feed the 3D scene

**Context.** We need to know whether CoStar can do more than mark points: building heights,
photos, floor plans, or links to Matterport.

**Scope.**
- Against the loaded kit, count how often these keys appear in `costar_properties.data`:
  stories / number of floors, building height, RBA / building SF, typical floor SF, land area,
  year built.
- Classify `costar_attachments` by kind: primary photo, gallery photo, floor plan, site plan,
  and anything that looks like a 3D tour or Matterport URL.
- Record aggregate counts only, split by city and by retail versus non-retail properties.
- Decide three things and write them down:
  1. Extrude CoStar buildings from stories when the tile has no `render_height`, yes or no.
  2. Show the primary photo in the site card, yes or no, subject to HAC-14's terms.
  3. Whether any attachment links to a Matterport model, which feeds SIM-12.

**Files.** `docs/costar-3d-fields.md`. Optionally a read-only script,
`scripts/costar-3d-report.ts`.

**Acceptance.**
- [ ] The doc lists coverage percentages per field and per attachment kind, for each city.
- [ ] All three decisions are recorded, and the board is told about them.
- [ ] No sponsor records, URLs or screenshots are committed.

**Links.**
- Blocked by: HAC-11 ✓, HAC-51 ✓ (data loaded locally; HAC-50 ✓ for native setup)
- Blocks: SIM-5 (optional fields), SIM-12
- Related: HAC-14 (terms for photos and floor plans)

**Suggested owner.** Anyone with the kit loaded.

---

## SIM-2 Hourly series from simulation events

**Context.** Peak-hour charts, the stats card and HAC-22's `get_site_run` all need per-hour
numbers. The engine only produces a whole-day `DailyMetrics`.

**Scope.**
- `hourlySeries(events, metrics)` returns 24 buckets. Each bucket holds:
  - `arrivals`, `joined`, `served`, `balked`, `reneged`
  - `meanWaitMin` and `p90WaitMin` (served customers, bucketed by service start)
  - `meanQueueLength` and `maxQueueLength` (time-weighted within the hour)
  - `stationUtilization` (busy station-minutes divided by stations × open minutes in the
    hour)
  - `revenueUsd`
- Hours outside opening hours are marked `closed`.
- `aggregateHourly(runs)` takes many seeds and returns the mean plus p5 and p95 for each field
  and hour.
- `peakHours(series, n)` returns the top hours by arrivals and by p90 wait.
- Pure functions with no I/O.

**Files.** `lib/sim/hourly.ts`, `lib/sim/hourly.test.ts`. Types are exported from
`lib/sim/contracts.ts`.

**Acceptance.**
- [ ] For every run, the sums across hours equal `DailyMetrics` for arrivals, served, balked,
      reneged and revenue.
- [ ] Utilization weighted by hour reproduces the daily `stationUtilization` within 1e-9.
- [ ] Results are deterministic: the same events always give the same series.
- [ ] `[CONTRACT]` is posted, mentioning HAC-22's owner.

**Links.**
- Blocked by: none
- Blocks: SIM-4, SIM-7, SIM-10, SIM-11, AGT-3 (`explain_hour`), AGT-10
- Related: HAC-13 ✓ (engine), HAC-22 ✓ (`get_site_run` needs hourly waits and abandonment)

**Suggested owner.** The simulation lane (HAC-13 author).

---

## SIM-3 Real arrival curves in the replay

**Context.** The replay fixture ignores the demand model's time-of-day blocks, so the "peak
hour" it shows is meaningless.

**Scope.**
- Generate the replay and comparison fixture schedules with `buildArrivalSchedule` from
  `lib/demand/model.ts`, using the category fixture time blocks.
- Add an optional smoothing step to `lib/demand/arrivals.ts`. It turns the 3-hour step
  function into a continuous curve that keeps every block's total share.
- The smoothing step is opt-in and defaults off, so HAC-18's existing tests still hold.
- Keep the fixture's seeds and the public shape of the comparison fixture.

**Files.** `lib/demand/arrivals.ts` (+ test), and a new fixture builder in
`lib/sim/fixtures/` that HAC-25 can switch to.

**Acceptance.**
- [ ] The coffee fixture peaks between 08:00 and 11:00.
- [ ] Block totals match the unsmoothed totals within 1 expected visit.
- [ ] The same seed always gives the same schedule.

**Links.**
- Blocked by: none. Coordinate with HAC-25 before editing anything in `components/`.
- Blocks: SIM-10
- Related:
  - HAC-18 ✓ (demand model)
  - **HAC-64 ✓** (it just changed service-time generation in the same arrival code, so
    start from current `main`)
  - HAC-25
  - HAC-63 (`makeDemo()` should use the new fixture builder)

**Suggested owner.** The demand lane (HAC-18 author).

---

## SIM-4 Spatial trips for every customer

**Context.** Agents need to walk or drive in from somewhere real for the city view to mean
anything.

**Scope.**
- `buildTrips(schedule, personas, dayResult, site, seed)` returns one `AgentTrip` per
  scheduled customer:
  `{ customerId, personaId, kind: "resident" | "worker" | "passby", mode, origin, path: [lng, lat][], timestamps: number[], outcome: "served" | "balked" | "reneged" | "open" }`.
- Origins are seeded per customer:
  - residents: a random point inside their persona's block group
  - workers: their LODES point plus jitter
  - pass-by: a point along the frontage road direction
- Timing:
  - The agent leaves its origin so that it reaches the door at `arrivalMin`.
  - It waits and is served according to the events.
  - It walks away after completion or abandonment.
  - Speed depends on mode: walk 80 m/min, drive 400 m/min. Driving agents appear from the
    nearest arterial.
- v1 paths are street-grid (L-shaped) approximations, rotated to the local street bearing.
  Snapping to road lines from the vector tiles is an optional stretch goal behind a flag.
- Pure function: same inputs, same trips.

**Files.** `lib/sim/trips.ts`, `lib/sim/trips.test.ts`.

**Acceptance.**
- [ ] The trip count equals the schedule's in-hours arrivals.
- [ ] Every trip's door timestamp equals its arrival event's `timeMin`.
- [ ] Each outcome matches the engine's events.
- [ ] Paths and origins are byte-identical for the same seed.

**Links.**
- Blocked by: SIM-2 (types only)
- Blocks: SIM-6, SIM-10 (origin heatmap)
- Related: HAC-15 ✓ (personas), HAC-17 ✓ (catchment), HAC-60 (catchment independent of
  candidate order)

**Suggested owner.** The simulation lane.

---

## SIM-5 Neighborhood scene API

**Context.** The city view needs one payload describing the area around a CoStar site.

**Scope.** `GET /api/sites/[siteId]/scene` returns:
- the site point, suite (size and asking rent with origins) and parent property
- nearby CoStar properties within the catchment radius, **authorized fields only**: id,
  point, type and subtype, retail flag, stories if SIM-1 found them, and current tenants'
  industry and name
- competitors from `public_places`, with category and distance
- block-group polygons, simplified, with population and median income for the heat layer
- the catchment ring or rings
- a `provenance` array

Use PostGIS `ST_DWithin` on the existing GiST indexes. Responses are cacheable, and Zod
validates them.

**Files.** `app/api/sites/[siteId]/scene/{route,handler,handler.test}.ts`,
`lib/contracts/scene.ts`, `lib/data/scene-repository.ts`.

**Acceptance.**
- [ ] The response passes the Zod schema, and no raw CoStar `data` or `source` payload leaks.
- [ ] A missing site returns 404, and an empty area returns empty arrays rather than an
      error.
- [ ] p95 is under 500 ms locally for a 1-mile radius.
- [ ] `[CONTRACT]` is posted.

**Links.**
- Blocked by: HAC-16 ✓, HAC-17 ✓, SIM-1 (optional fields)
- Blocks: SIM-6
- Related: **HAC-59 ✓** (read from the slim projection; never load provenance blobs per
  request), HAC-60

**Suggested owner.** The data lane.

---

## SIM-6 3D city view

**Context.** This is the centerpiece of the reference video, grounded in real CoStar
neighborhoods. The `simulator-visualization` branch already has the 3D base: a Cesium scene
of the Vexcel mesh, road overlays, sky and a playback timeline. HAC-65 is making it fast,
HAC-63 feeds it stored runs, and DS-4 moves it into the Sitework shell. This ticket adds the
**content** that makes the scene about the founder's site. It does not change the 3D stack.

**Scope.**
- Build on `components/simulator/neighborhood.tsx` (Cesium). **Do not** add MapLibre 3D or
  deck.gl. Where there is no Vexcel coverage (LA), fall back to OpenFreeMap `building`
  extrusions in Cesium.
- **Candidate building highlighted:**
  - Find the mesh or tile feature under the CoStar point.
  - If there is none, use a pin with an extrusion based on stories (SIM-1).
  - Pin the entrance.
- **Nearby CoStar properties** tinted by type, and **competitors** as pins, both from SIM-5.
- **Agents layer:** SIM-4 trips drawn as Cesium entities or primitives.
  - Agents are colored by outcome (served, walked away) or by persona kind.
  - A short fading trail follows each agent.
  - A queue ring at the door grows with the current line length.
- **Replace the invented overlays.** The "Apartments / Offices / Transit" anchors become
  real SIM-4 origins. The road "traffic" coloring either stays labeled as illustrative
  (DS-4 wording) or is removed.
- **Places** menu: fly between shortlisted CoStar sites.
- **One playback clock**, reused from `replayAt` in `components/replay/replay-state.ts`. Play,
  pause, speed and seek drive the scene and the agents.
- Route: `app/(pages)/projects/[projectId]/city/page.tsx` in the workspace navigation, as
  set up by DS-4.

**Out of scope.**
- Rendering performance: HAC-65.
- Loading stored comparisons and runs: HAC-63.
- Shell placement and the dark-mode styling: DS-4.

**Files.** `components/city/*` (new layers and the Places menu), and small hooks in
`components/simulator/neighborhood.tsx` once HAC-65, HAC-63 and DS-4 have merged.

**Acceptance.**
- [ ] It loads for each fixture site and for any `/api/sites` site that has a scene.
- [ ] The candidate building is highlighted, or pinned with an extrusion, on every fixture
      site.
- [ ] Seeking to the same minute shows the same agent positions every time.
- [ ] Changing speed never changes totals.
- [ ] With 500 agents it keeps HAC-65's recorded ≥30 FPS baseline, measured with the same
      method as HAC-65.
- [ ] No overlay is labeled "Traffic" or "Demand" without its DS-4 qualifier next to it.
- [ ] It works on a 375 px wide screen: the panels collapse into a bottom sheet.

**Branch.** `components/simulator/` exists only on the `simulator-visualization` branch. It is not on
`main` yet.
- If `simulator-visualization` has not been merged into `main` when you start, branch from a
  freshly fetched `origin/simulator-visualization` (after HAC-65, HAC-63 and DS-4 have
  merged into it) and open the PR against
  `simulator-visualization`, the same as HAC-65.
- If it has been merged, branch from `main` and target `main` as usual.

To check, run `git ls-tree -d origin/main components/simulator`. It prints nothing while the folder is only on `simulator-visualization`.

**Links.**
- Blocked by: SIM-4, SIM-5, HAC-65, HAC-63, DS-4
- Blocks: SIM-7, SIM-8, SIM-9, SIM-13, SIM-15, AGT-9
- Related: HAC-25 (replay clock), HAC-61, DS-1

**Suggested owner.** Whoever owned HAC-65, to keep `components/simulator/` with one person,
or the frontend lane (HAC-21 author).

---

## SIM-7 Live stats card

**Scope.** A floating card over the city or interior view. It shows, so far today: served,
revenue and walk-aways ("unmet demand"). It also has:
- current line length and current wait
- a cumulative purchases sparkline
- the clock (`hh:mm / close`)
- play, pause, speed (1×, 6×, 18×, 60×) and a seek bar
- a mini tab switch for "This site / Area overview"

**Files.** `components/city/stats-card.tsx` (+ test of the derived numbers).

**Acceptance.**
- [ ] The numbers at any minute equal `replayAt` and `hourlySeries` cumulated to that minute.
- [ ] At close, the numbers equal `DailyMetrics`.

**Branch.** This ticket builds on the city view from SIM-6, so use the same branch SIM-6 merged into. If
`simulator-visualization` has not been merged into `main` yet, branch from
`origin/simulator-visualization` and open the PR against it. Otherwise use `main`.
To check, run `git ls-tree -d origin/main components/simulator`.

**Links.**
- Blocked by: SIM-2, SIM-6
- Related: HAC-36 (replay determinism), DS-1 (card and number styles)

---

## SIM-8 Experiment panel: levers and rerun

**Scope.**
- The right-hand panel's **Experiment** tab has these levers:
  - average ticket or price
  - planned stations
  - staff headcount
  - opening hours, per day type
  - demand multiplier
  - seed
  - weekday or weekend
- "Restart with settings" reruns `simulateDay` client-side. It is pure and deterministic, and
  runs in a Web Worker if it takes over 50 ms.
- "Save baseline & rerun" pins the current run, then shows the deltas for:
  - monthly contribution (`lib/sim/economics.ts`)
  - served
  - walk-aways
  - p90 wait
  - peak-hour p90 wait
- Every lever shows its origin badge, and an edited value becomes `founder`.

**Files.** `components/city/experiment-panel.tsx`, `lib/sim/experiment.ts` (+ test).

**Acceptance.**
- [ ] Rerunning with unchanged levers reproduces the baseline exactly.
- [ ] Adding a station never increases p90 wait on the fixture.
- [ ] The deltas match a direct engine plus economics computation.

**Branch.** This ticket builds on the city view from SIM-6, so use the same branch SIM-6 merged into. If
`simulator-visualization` has not been merged into `main` yet, branch from
`origin/simulator-visualization` and open the PR against it. Otherwise use `main`.
To check, run `git ls-tree -d origin/main components/simulator`.

**Links.**
- Blocked by: SIM-6
- Blocks: SIM-10 (station callout), SIM-14
- Related:
  - HAC-22 ✓ (sensitivity)
  - HAC-62 (robustness headline)
  - AGT-1 (lever changes become scenario versions)
  - AGT-3 (lever changes and agent tools share `lib/scenario/service.ts`; once AGT-1 exists,
    the levers call it)
  - DS-5 (its "change an assumption" action opens these levers)

---

## SIM-9 Inspect and follow a customer

**Scope.**
- The **Inspect** tab has a searchable customer list. Clicking an agent on the map or in the
  interior selects it.
- "Follow" locks the camera to that agent.
- The card shows:
  - persona (kind, income band, age band, has kids)
  - origin distance and travel mode
  - current activity (traveling, waiting, in service, left)
  - the line length it saw and its stay probability
  - the panel's answers (where else it would go, visits per month)
  - outcome and wait
  - a one-line "why" (for example "Saw 6 in line, stay probability 0.31, walked away")
- Move or reuse the inspector logic from `components/replay/replay-player.tsx` after HAC-25
  merges.

**Files.** `components/city/inspect-panel.tsx`.

**Acceptance.**
- [ ] Every number on the card traces back to the schedule, persona or events.
- [ ] Following keeps the agent in view through the whole trip.

**Branch.** This ticket builds on the city view from SIM-6, so use the same branch SIM-6 merged into. If
`simulator-visualization` has not been merged into `main` yet, branch from
`origin/simulator-visualization` and open the PR against it. Otherwise use `main`.
To check, run `git ls-tree -d origin/main components/simulator`.

**Links.**
- Blocked by: SIM-6, HAC-25 (inspector logic)
- Related: HAC-57 ✓ (stored replay player)

---

## SIM-10 Customer insights: peak-hours dashboard

**Context.** This is the data-visualization half of the request. The founder should be able
to read their day at a glance.

**Scope.**
- `components/insights/`, shown as an **Insights** section on the site detail page and as a
  drawer in the city view. A weekday / weekend toggle sits on top. Each chart shows the mean
  across all seeds with a p5–p95 band.
- Charts:
  - **Demand vs capacity by hour:** arrivals bars, served bars, and a capacity line at
    stations × 60 / mean service minutes.
  - **Wait by hour:** mean wait as a line with a p90 band.
  - **Walk-aways by hour:** balked and reneged, stacked.
  - **Revenue by hour**, plus cumulative revenue.
  - **Customer mix:** residents, workers and pass-by, plus distance bands (<0.5, 0.5–1 and
    1–3 mi).
  - **Origin heatmap:** a map layer aggregating where served customers come from (H3 or a
    hex grid from SIM-4 origins).
- **Auto callouts**, generated from the data. Examples:
  - "Busiest hour 8–9am: 42 arrivals, p90 wait 6 min, 11% walk away."
  - "A 3rd station from 7–10am recovers about $X a month." This one runs SIM-8's experiment
    helper.
  - "Quiet after 2pm: utilization 18%; consider closing at 3pm."
- Add one chart library, `recharts` (pinned). Use the Tailwind tokens and keep both themes
  legible.
- Every chart carries origin badges and the "modeled, not a forecast" caption.

**Files.** `components/insights/*`, `lib/insights/callouts.ts` (+ test), and a mount point in
`components/site/site-detail.tsx`.

**Acceptance.**
- [ ] The charts render from fixture data first (SIM-2 and SIM-3 only), then from HAC-22's
      stored runs.
- [ ] Callout numbers match `hourlySeries` exactly.
- [ ] The charts have accessible names and summaries (axe clean), and they read correctly at
      375 px.

**Links.**
- Blocked by: SIM-2, SIM-3. The heatmap also needs SIM-4, and the station callout needs
  SIM-8.
- Blocks: SIM-11
- Related:
  - HAC-61 and DS-1 (origin and evidence badges)
  - HAC-62 (callouts and the robustness headline must agree)
  - DS-5 (where Insights sits on the decision page)

---

## SIM-11 Comparison: hourly overlay

**Scope.**
- Add a peak-hour sparkline (arrivals vs capacity) to each site row in the comparison table.
- Add an overlay chart of hourly p90 wait across the shortlisted sites.
- Add a "View on street" link to SIM-6 for each site.

**Files.** `components/comparison/comparison-screen.tsx`, after HAC-25 merges.

**Acceptance.**
- [ ] The sparklines use the same comparison and run IDs as the table.

**Links.**
- Blocked by: SIM-2, SIM-10, HAC-25
- Related: HAC-57 ✓ (live comparisons), HAC-62 (the comparison leads with robustness), AGT-6
  (multi-scenario comparison)

---

## SIM-12 Matterport model registry and interior API

**Context.** Scans of the candidate spaces, inside and sometimes outside, are the most
convincing "this is your space" asset we have.

**Scope.**
- A `matterport_models` table: `model_id`, `costar_property_id`, `costar_space_id`
  (nullable), `has_exterior`, `source`. It is loaded from the HAC-14 zip by
  `scripts/load-matterport.ts`, modeled on `scripts/load-costar.ts`, and is idempotent.
- `GET /api/sites/[siteId]/interior` returns
  `{ kind: "scan" | "floorplan" | "modeled", modelId?, showcaseParams?, floorPlanUri?, dimensions?, provenance }`.
  - For a scan, `dimensions` holds floors and rooms with area and bounds, fetched server-side
    from the Matterport Model API and cached in Postgres.
  - For `floorplan`, the URI is the CoStar `floorPlan` attachment.
  - Otherwise the kind is `modeled`.
- Env vars:
  - `MATTERPORT_SDK_KEY`: the Showcase SDK key, which may reach the client.
  - `MATTERPORT_API_TOKEN`: server-only.
  - Both go in `.env.example` and the env policy script.

**Files.** `lib/db/matterport-schema.ts`, `scripts/load-matterport.ts`,
`app/api/sites/[siteId]/interior/*`, `lib/contracts/interior.ts`.

**Acceptance.**
- [ ] Each of the three kinds is returned correctly on fixtures.
- [ ] The API token never appears in the client bundle (`scripts/check-client-bundle.ts`).
- [ ] Until HAC-14 access lands, the API works against a recorded fixture and Matterport's
      public demo model.
- [ ] `[CONTRACT]` is posted for the route and the env vars.

**Links.**
- Blocked by: HAC-14 (real models only; build on fixtures before then), SIM-1 (attachment
  links)
- Blocks: SIM-13, SIM-14
- Related: HAC-47 (CI secret scanning and env policy for the new keys), AGT-7 (room bounds)

---

## SIM-13 Interior view: the simulation inside the scan

**Scope.**
- `components/interior/matterport-view.tsx` embeds Matterport Showcase, connects the Showcase
  SDK, and registers a Scene component that renders, with the SDK's three.js scene objects:
  - agent meshes: entering, in line, at a station, leaving
  - station markers
  - a queue path
- A layout helper turns the room bounds from SIM-12 into an entrance, a counter or station
  row, and a queue polyline. Its output is stored, so placements are deterministic.
- Mattertags label the stations, the counter and the entrance.
- The view uses the **same playback clock and events** as the city view, and SIM-7 and SIM-9
  work here unchanged.
- Fallbacks:
  - `floorplan`: the CoStar floor-plan image becomes a ground texture under the r3f modeled
    layout.
  - `modeled`: the existing layout.
- A label always states which one is shown: "Scanned interior", "Listing floor plan" or
  "Modeled layout".

**Files.** `components/interior/*`, `lib/sim/interior-layout.ts` (+ test).

**Acceptance.**
- [ ] At any minute, the in-scan state (counts in line, in service, left) equals `replayAt`
      and the city view's state.
- [ ] The fallback label matches the `kind` from SIM-12.
- [ ] No Matterport frames are recorded or exported beyond HAC-14's terms.

**Branch.** This ticket reuses the playback clock from SIM-6, so use the same branch SIM-6 merged into. If
`simulator-visualization` has not been merged into `main` yet, branch from
`origin/simulator-visualization` and open the PR against it. Otherwise use `main`.
To check, run `git ls-tree -d origin/main components/simulator`.

**Links.**
- Blocked by: SIM-12, SIM-6 (clock)
- Blocks: SIM-15, AGT-8, AGT-9
- Related: HAC-14 (display terms)

---

## SIM-14 Scan-derived capacity

**Scope.**
- Turn scanned floor and room areas into `stations.usableSf`, and suggest a station count
  from the category's `sfPerStation`.
- Feed the results into `SiteConfig` with a new `matterport` origin. This extends
  `OriginSchema` in `lib/sim/contracts.ts` and `lib/contracts/`.
- The Experiment panel shows "capacity from scan" next to "capacity from listing SF", and the
  change in p90 wait between the two.

**Files.** `lib/sim/capacity.ts` (+ test), the origin enum, and `experiment-panel.tsx`.

**Acceptance.**
- [ ] With no scan, the behavior is byte-identical to today.
- [ ] With a scan, `usableSf` comes from the scan and is labeled `matterport`.
- [ ] `[CONTRACT]` is posted, mentioning the owners of HAC-22 and HAC-24.

**Links.**
- Blocked by: SIM-12, SIM-8
- Related: HAC-22 ✓, HAC-24 ✓ (both read `SiteConfig` origins), AGT-7 (layout room bounds)

---

## SIM-15 City-to-interior transition

**Scope.**
- Clicking the highlighted CoStar building flies the camera to its frontage, then crossfades
  into SIM-13. The interior starts at the exterior or entrance sweep when `has_exterior` is
  set.
- "Back to street" reverses the transition.
- The clock, the stats card and the selected customer persist across the switch.
- The site card shows the CoStar `primaryPhoto`, if SIM-1 and HAC-14 allow it.

**Files.** `components/city/transition.tsx`, plus small hooks in the city and interior views.

**Acceptance.**
- [ ] Simulation time does not jump across the transition in either direction.
- [ ] The selection and the follow state survive the transition.

**Branch.** This ticket builds on the city view from SIM-6, so use the same branch SIM-6 merged into. If
`simulator-visualization` has not been merged into `main` yet, branch from
`origin/simulator-visualization` and open the PR against it. Otherwise use `main`.
To check, run `git ls-tree -d origin/main components/simulator`.

**Links.**
- Blocked by: SIM-6, SIM-13
- Related: HAC-14 (primary photo terms), SIM-1

---

## SIM-16 Tests

**Scope.**
- Vitest:
  - `hourly.ts`: conservation against `DailyMetrics`
  - `trips.ts`: determinism, and trip count equals arrivals
  - `experiment.ts`: an unchanged rerun equals the baseline
  - `callouts.ts`
  - `interior-layout.ts`
- Absorbs **HAC-36** (replay determinism E2E and a computer-use visual check). On import,
  mark HAC-36 as a duplicate of this ticket, or close it once this one covers it.
- Playwright E2E, on the HAC-29 harness:
  - open the city view and play
  - seek and check that the stats are deterministic
  - change a lever, rerun and see the deltas
  - follow a customer
  - enter the interior (fixture scan or fallback) and check the label
  - open Insights and see the peak-hour callouts
- Visual checks at 375 px and at desktop width.

**Files.** Tests next to the code, plus `tests/e2e/city-sim.spec.ts`.

**Acceptance.**
- [ ] All four `pnpm` checks pass, and the E2E suite passes on a Vercel preview.

**Links.**
- Blocked by: SIM-1 to SIM-15
- Related: HAC-36 (duplicate, see above), HAC-29 ✓ (harness), HAC-34 (pipeline determinism)

**Suggested owner.** frank-claude (test lane).

---

## SIM-17 Jev end to end: live runs, partial failures and Jev-backed example data

**Context.** The Jev customer panel is built and wired:
- HAC-15 ✓ built the panel and HAC-54 ✓ aligned its client with TypeSafe's real API.
- HAC-18 ✓ built the demand model that consumes Jev's behavior tables.
- When `/api/comparisons/capabilities` reports `jevConfigured: true`, the live comparison
  screen (`lib/client/live-comparison.ts`) and the agent tools (`lib/agent/tools.ts`) already
  ask for `demandSource: "jev"`.

In practice founders still see Huff almost everywhere:
- **Config.** Nobody has confirmed that `JEV_API_KEY` is set for Vercel Preview and
  Production. Without it, every run is Huff.
- **Partial failures.** In `lib/evaluation/assemble.ts`, if any single persona fails, the
  whole site falls back to Huff (`JEV_INCOMPLETE`). The only trace is a finding.
- **Example data.** The Montrose example (`components/comparison/example-comparison.ts`) is
  hardcoded to `demandSource: "huff"`. The simulator demo (`makeDemo()` on
  `simulator-visualization`) uses no demand model at all: 110 hand-built customers. The only
  recorded Jev data, `lib/panel/__fixtures__/jev-recorded.json`, covers a single
  persona × site, not a full panel.

The API default stays `huff`, which is deliberate: callers must opt in to paid panel calls.
This ticket doesn't change that default.

**Scope.**
- **Configuration and a smoke check.**
  - Ask `@oracle-lead` on the board to confirm that `JEV_API_KEY` (and `JEV_MODEL` if it isn't
    `jev-latest`) is set in Vercel for Preview and Production. Agents never handle the key
    itself.
  - Add a deployed smoke check: `GET /api/comparisons/capabilities` returns
    `jevConfigured: true` on the Preview and Production URLs.
  - Run one live Jev comparison on Preview and record its `demandSource`, model version and
    panel call count in the PR.
- **Partial-failure handling** in `lib/evaluation/assemble.ts` and `lib/panel/panel.ts`:
  - Retry each failed persona once before giving up. The panel cache means successful
    answers are not paid for twice.
  - If a site still has failures, keep today's site-level Huff fallback.
  - Show that fallback on the comparison screen next to the site, not only in findings:
    for example "Huff (Jev failed for 3 of 64 personas)".
- **Jev-backed example data.**
  - Record **one full Jev panel** for the Montrose example: all personas × the example
    sites and competitors. Use a script that runs only when `JEV_API_KEY` is set, and check
    the result in as a behavior-table fixture with its model version and recording date.
  - Switch `example-comparison.ts` to use that table, with `demandSource: "jev"`. It keeps
    its **Example** label and adds "Recorded Jev answers, `<model version>`, `<date>`".
  - Export a helper that turns the recorded table into a schedule through
    `buildArrivalSchedule`, so `makeDemo()` can replace its hand-built customers. The
    simulator change itself is made in HAC-63 or DS-4 on `simulator-visualization`, not in
    this ticket.
- **Recording terms.** Checking in recorded Jev answers is subject to the TypeSafe terms
  tracked in HAC-14. If the terms don't allow it, keep the recording out of git and say so
  in the PR.

**Files.**
- `lib/evaluation/assemble.ts` and `lib/panel/panel.ts` (+ tests)
- `scripts/record-jev-example.ts`
- `lib/panel/__fixtures__/` (the recorded table)
- `components/comparison/example-comparison.ts` (coordinate with HAC-25)
- `components/comparison/live-comparison-screen.tsx` (the fallback note)
- `tests/e2e/` (the capabilities smoke check)

**Acceptance.**
- [ ] On Preview, `GET /api/comparisons/capabilities` returns `jevConfigured: true`, and a live
      comparison reports `demandSource: "jev"` with a model version. Both are recorded in
      the PR.
- [ ] A test with a fake Jev client that fails one persona once shows that it is retried
      and the site uses Jev. A persona that fails twice gives the site-level Huff fallback,
      and the screen says so next to the site.
- [ ] The Montrose example renders from the recorded Jev table with no network calls, and
      shows the **Example** and "Recorded Jev answers" labels.
- [ ] Without `JEV_API_KEY`, tests, the build and the example all still work. The recording
      script exits with a clear message and changes no files.
- [ ] No key, token or raw request header appears in the repo, logs or the client bundle
      (`scripts/check-client-bundle.ts`).

**Branch.** `main`. Nothing here touches `components/simulator/`. Using the recorded table in
`makeDemo()` happens in HAC-63 or DS-4.

**Links.**
- Blocked by: none. The config step needs `@oracle-lead` or a human to set the key.
- Related:
  - HAC-14 (Jev access and terms)
  - HAC-15 ✓, HAC-18 ✓, HAC-54 ✓ (panel, demand model, client)
  - HAC-25 (owns `example-comparison.ts`)
  - HAC-47 (env and secret scanning)
  - HAC-62 (robustness: whether Jev and Huff agree)
  - HAC-63 (`makeDemo()` uses the recorded table)
  - SIM-3 (arrival curves from the same schedule builder)
  - DS-1 (the evidence label for recorded Jev answers)

**Suggested owner.** The panel lane (HAC-15 author).
