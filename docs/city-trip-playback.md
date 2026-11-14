# City trip playback sampler (HAC-77 preparation)

`components/city/trip-frame.ts` exports `sampleTripFrame`, `TripFrame`,
`SampledAgent`, `TrailPoint`, and `TripFrameOptions`. This is a pure frontend
adapter for existing `AgentTrip` values from `lib/sim/trips.ts` and their matching
engine `DayResult`. It adds no persistence or API contract, timer, random draws,
rendering layer, network request, or simulation rerun.

```ts
const frame = sampleTripFrame(trips, run, sharedMinute, {
  trailMinutes: 1,
  trailSamples: 8,
});
```

The caller supplies the city's existing clock in minutes since local midnight.
It is never clamped to opening hours or wrapped at midnight: inbound movement
may occur before opening or before midnight; a visible departure may continue
after closing or midnight. Repeated seeks to the same minute return the same
values, regardless of prior seeks or the caller's playback speed.

## Position and visibility

Positions interpolate between the supplied path vertices using their timestamps.
At equal timestamps, the last vertex at that time wins. This avoids division by
zero for repeated door vertices and zero-duration service. A customer is visible
from `visibleEntryMin` through the final visible path timestamp, inclusive.
Completed trips disappear after that final timestamp. Drivers' offscreen
origin-to-arterial travel and offscreen return are never added to the visible
path; their true origin is not used as a marker position.

Open trips have no recorded departure. Their last door position and replay state
remain available after closing with `heldAtClose: true`; this explicitly means
**last known state, terminal outcome unknown**, not evidence that the person is
still there after closing. No departure or completion is invented.

## State and evidence

`queueLength`, `served`, `left`, and `arrivals` come from `replayAt(run.events,
minute)`. Queue length covers the supplied run, even when a caller supplies only
a subset of its trips. Phases are `inbound`, `waiting`, `in_service`, and
`outbound`. The latter is available only after an arrival's leave decision,
completion, or abandonment event occurs at or before the shared minute.

`outcome` is null before that event, then `balked`, `served`, or `reneged`.
The sampler never copies a trip's eventual outcome into an earlier frame. A
future renderer may color by these event-visible outcomes or by persona kind;
it must not use the original trip's final outcome to reveal future decisions.

Every sampled agent carries the original `local_rotated_grid` approximation and
geometry source/provenance entries. These paths and interpolated positions are
**approximate modeled travel**, not observed movements, verified street routing,
or traffic measurements. `provided` describes supplied geometry provenance,
not verification of actual travel.

## Trails and validation

Trails use fixed historical samples over the most recent simulated minute by
default. `trailMinutes` must be positive and finite; `trailSamples` defaults to 8
and must be an integer from 2 through 64. Their time interval is clipped to the
visible path, with no future sample points. Opacity is `1 - age / trailMinutes`,
clamped to 0–1. Consecutive stationary samples collapse; an entirely stationary
window returns no trail. These are sampled trail points, not an additional
street route; connecting sparse points can simplify a turn.

Duplicate customer IDs, mismatched path/timestamp lengths or arrival times,
invalid indices, nonfinite positions/timestamps, and nonchronological events
throw instead of producing ambiguous markers. The function does not mutate its
inputs. Position tuples are fresh values; provenance entries are readonly views
of existing metadata.

## Scope and verification

Tests use the real seeded engine and `buildTrips` adapter. They cover visibility
boundaries, interpolation, hidden driving, equal timestamps, completion and
abandonment timing, exact-closing service starts, unresolved closing states,
negative minutes and post-midnight departures, bounded trails, repeated seeks,
input preservation, and invalid inputs.

HAC-77 remains incomplete. The HAC-76 scene payload, Cesium layers, fixture/live
site integration, Places menu, mobile bottom sheet, and measured 500-agent FPS
are separate work. This pure sampler establishes no UI or performance claim.
