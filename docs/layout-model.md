# Typed layout model (HAC-86)

This is an approximate capacity model for a service-business scenario, using feet and axis-aligned rectangles. It is not a building-code, occupancy or accessibility certification. The ticket's pure-model scope adds no persistence: scenario `layoutId` and the existing diff hook are the integration boundary.

## Design and approach

Use typed rectangles for room bounds and solid footprints, a boundary point for the entrance, and a polyline for the queue. Arbitrary polygons and scan meshes would need a larger geometry dependency and are outside this ticket. A scan adapter may pass rectangular Matterport dimensions; otherwise a square whose area equals listing SF is used. The square shape is `agent-proposed`, with `costar` as its area source; listing SF never claims to supply measured dimensions.

Every element carries `origin` (`matterport`, `costar`, `founder`, or `agent-proposed`) and evidence IDs. These layout-specific origins do not extend the existing simulation or stored evidence enums. The shared UI evidence mapper labels `agent-proposed` as the existing “Assumption” category and Matterport as “Source-backed”. New operation versions use explicit caller-provided IDs, point at their parent, validate fully and deep-freeze cloned data. There is no random or clock-dependent behavior. Invalid input exposes dot-separated field errors for repair.

The modeled defaults are 1 ft between solid footprints, a 3 ft accessible route, a 3 ft queue corridor and 2 ft per waiting customer. They are authored modeling choices, not regulatory requirements. They are recorded in each layout policy with origin and evidence, and can be overridden explicitly. Seating groups require a positive dwell time and a seat count; no dwell time is inferred.

Validation requires solid footprints inside the room, no overlap, minimum pairwise clearance, unique element IDs, a clear queue corridor, and a route from the entrance to a free side of the counter. The approximate route uses visibility between corners of obstacles expanded by half the route width, within the similarly inset room, targeting the four counter-side midpoints. Entrance width must accommodate the modeled route. Queue paths may not cross, turn more than 90 degrees or pass too close to nonadjacent segments; consecutive points must differ. This conservative turn rule rejects near-hairpins that would count the same space twice. Queue length divided by spacing, rounded down, counts waiting customers only. The accessible route checks furniture footprints; it does not model moving or queued people, door swings or turning circles.

Input bounds keep this pure geometry work finite: at most 100 station and seating footprints combined, 64 queue points, coordinates within ±100,000 ft, dimensions up to 10,000 ft and policy distances from 0.1 to 100 ft. Invalid geometry or bounds produce field errors rather than partial results.

The station ceiling uses `categoryDefaults(category).values.squareFeetPerStation` (coffee 100, quick food 120, salon/barber 100, fitness 50), applied to room area minus the back-of-house footprint. These category values are authored defaults, as documented in `fixtures/categories/README.md`.

## Simulation boundary

`deriveSimParams(layout)` returns station count, queue capacity, seating capacity and seat-weighted mean dwell minutes (null without seating). Layout station count can populate `stations.planned`; its usable area and category SF requirement can populate the matching engine station fields. This ticket does not automatically change evaluation assembly or scenario overrides.

`SiteConfig.queueCapacity` is an optional nonnegative integer. It limits people waiting, excluding people in service. When the line is full and every station is busy, the arrival leaves and contributes to `balked`. A zero capacity still permits immediate service. Behavioral stay probability remains in the existing arrival event; the final decision can also reflect physical capacity. Existing completion-before-arrival ordering remains. With no queue capacity, event and metrics bytes remain identical.

The layout is authoritative for geometry when explicitly selected. Scan dimensions feed that layout; they do not silently override a selected layout's derived queue or station count. The caller must resolve competing scenario/scan inputs rather than combining limits invisibly. SIM-14 and scenario persistence remain separate integration work.

## Caller contract

Import schemas and types from `lib/contracts/layout.ts`; import model functions from `lib/layout`. `LayoutSchema` checks structural shape; use `parseLayout` at runtime boundaries for the complete geometry and category validation.

`deriveRoomBounds({ matterport?, listing? })` accepts measured width/depth or listing area with evidence IDs. `createLayout(input)` requires every physical element, sets a null parent and supplies the documented policy if omitted. `applyLayoutOp(layout, operation, { layoutId })` returns a detached, frozen next version. Callers allocate globally unique IDs and retain earlier versions; the pure function checks the current and immediate parent IDs but has no persistence registry.

Operations are discriminated by `op`: `add_station`, `add_seating`, `move`, `remove`, `set_queue_path`, `set_counter`, `set_entrance`, `set_back_of_house`, `set_room` and `set_policy`. `move` takes `elementId`, `position`, `origin` and `evidenceIds`; queue movement uses `set_queue_path`. `remove` applies only to station and seating groups; at least one station remains required. Element IDs are unique across the layout. The caller must provide provenance reflecting the actual source of each edit.

On failure, catch `LayoutInputError` and inspect `fieldErrors`, for example `layout.stations.0.footprint`, `op.elementId` or `meta.layoutId`. No failed edit mutates an earlier version.

`createLayoutDiffHook(resolve)` adapts to `diffScenarios` and `invertScenarioDiff`. Supply a synchronous lookup scoped to the caller's project/site; an unresolved ID is an error. The summary contains both versions' derived parameters, room, policy, element IDs and a symmetric list of changed element IDs. This adapter performs no database lookup, foreign-key enforcement or authorization. Layout storage, the scenario layout FK, interior scan adapters and scenario/evaluation wiring remain downstream work.
