# BizBox café interior replay

HAC-104 adds a dots-only operating comparison to
`/simulator-demo#operating-plan`. It uses the existing seeded toy café and queue
engine, not observed demand or a Matterport scan.

## Use the comparison

The **One staffed counter** and **Two staffed counters** panels share a clock,
speed, play/pause control, scrubber and reset. Reset pauses at opening and clears
the selected person. **Focus on shop** changes the framing without changing the
simulation. When the existing neighborhood is available, its timeline uses the
same clock.

- Blue spheres represent customers approaching, waiting, receiving service or
  leaving. Inspect one by clicking its dot or using **Inspect a customer**.
- Purple spheres with white rings represent employees at their assigned
  counters. Employee buttons provide keyboard inspection. They mark staffing
  during opening hours; they do not simulate employee tasks or travel.
- Approach and departure paths use illustrative two-minute animations anchored
  to arrival/completion/abandonment events. Travel time, pedestrian collisions
  and the room geometry do not change engine outcomes.
- There are no animated cars in the modeled café scene.

The fixture generates the same 110 customers, arrival times, stay draws and
service requirements with seed 45 for both plans. The alternative adds one
employee at $18/hour and a second station, plus $6,000 in buildout. Monthly
economics repeat the four-hour weekday 22 times. The extra employee costs
$1,584/month; the existing calculation also includes ingredients, rent and
buildout amortization, but excludes taxes and other overhead.

**Served** and **Left** are cumulative at the selected minute. **Waiting** and
**Busy counters** describe the current replay state. **Avg wait to service so
far** averages `service_start.waitMin` for customers whose service has started by
that minute, including customers still being served. It is not the engine's
day-end mean wait of completed customers.

The unchanged fixture finishes with 55 served / 52 left for one counter and
80 served / 28 left for two. Remaining customers are still waiting or in service
at closing; they must not be silently counted as served or left. These results
illustrate one set of assumptions, not a business forecast or a guarantee that
more counters are better.

## Context and boundaries

Existing stored comparison links (`comparison`, `project`, `site`) still select
their recorded site and runs. Their weekday/weekend labels and provenance are
preserved. They are not the fixture's paired staffing experiment. When no
per-station staffing metadata is supplied, employee dots are omitted and the
UI says staffing is unavailable rather than inferring it from station count.

The comparison uses a **Modeled layout**. Matterport registry/access and the
general scanned viewer remain HAC-96/HAC-14/HAC-97. HAC-87 owns the general layout
editor; HAC-99 owns the full city-to-interior camera transition. This slice does
not add those features or a new chat/map shell. Captured furniture in a future
scan cannot be removed by overlaying a proposed counter.

Sphere geometry/materials are shared; the existing visibility observer and
demand rendering stop offscreen work. If WebGL is unavailable, a fallback leaves
playback, metrics and person inspection usable.

## Verification

`components/simulator/interior-state.test.ts` checks paired workloads and engine
outcomes, exact queue/service cohorts, employee placement and shift limits,
departure lifetimes, wait calculations, empty/zero-capacity input and backward
seek/reset behavior. `tests/e2e/simulator-interior.spec.ts` checks shared playback,
counts, selection/reset, staffing inspection at 375/768/1440 px, and WebGL
fallback. Run the repository's four required checks before delivery.
