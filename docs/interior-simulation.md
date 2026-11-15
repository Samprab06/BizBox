# BizBox café interior replay

HAC-104 adds a dots-only operating comparison to
`/projects/houston-coffee/simulator#operating-plan`. With a domain-authorized `MATTERPORT_SDK_KEY`,
the example opens the real **The Coffee Port** Matterport scan and adds simulated
people and proposed service markers through the Bundle SDK's 3D Scene API. The
demand remains the existing seeded toy café, not observed activity in that scan.

Use `http://localhost:3016/projects/houston-coffee/simulator#scanned-interior` to open the interior directly.
The supplied development key was verified on `localhost`; the `127.0.0.1` origin
did not load the model. Domain authorization belongs to the SDK key's settings.

## Matterport setup and viewing

Set the SDK key privately in ignored `.env.local`. It is a domain-restricted
browser key; never substitute `MATTERPORT_API_KEY` or `MATTERPORT_API_TOKEN`.
Those API credentials are server-only and covered by the client-bundle guard.

`pnpm dev` and `pnpm build` prepare unmodified Bundle SDK assets when an SDK key
is configured. `pnpm matterport:prepare` explicitly prepares them. The script
downloads the official `@matterport/webcomponent` 0.1.47 archive, verifies its
pinned SHA-512 integrity, and extracts its self-contained bundle into ignored
`public/matterport/`, retaining vendor license notices. It does not install the
web component or change the application's Three.js version. The iframe uses the
SDK's own Three.js 0.184 context. Static SDK assets are about 32 MB; model content
is streamed directly from Matterport. No model geometry is exported or recorded.

**Scanned interior** is the configured example's default. One viewer switches
between **One staffed counter** and **Two staffed counters**, using the same
replay minute. The example starts paused at 8:24 AM. **Show service area** returns
the camera to the café counter; normal Matterport controls let users explore.
The scan is a public reference, not the selected Houston candidate property.
Mint service markers are proposed overlays; the photographed counter is not
removed or remodeled.

The proposed overlay is registered near floor intersections in the public scan
at `{ x: 17.1, y: 0.04, z: 10.3 }`, rotated by π radians and scaled by 0.5. These
values live in the café's registry row (`lib/interior/__fixtures__/public-cafe.json`,
HAC-138); `lib/layout/scan-transform.ts` maps layout feet to scan metres, and in
development the viewer's **Dev: pick placement anchors** panel solves a placement
from 2–3 picked floor points. A scan without a placement keeps the overlay on
Modeled layout and says why. This is an illustrative placement, not measured room geometry or a physical layout
validation. Blue and purple dots belong to the SDK scene graph, not a flat HTML
layer. Connection/overlay errors are explicit; the UI never silently labels the
modeled fallback as a scanned interior.

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

**Modeled layout** is an explicit alternative and the default without an SDK key.
The general candidate registry/access and viewer integration remain
HAC-96/HAC-14/HAC-97. HAC-87 owns the general layout editor; HAC-99 owns the full
city-to-interior camera transition. This slice does not add those features or a
new chat/map shell. Public-scan configuration is only passed to the example;
stored candidate runs are never paired with this unrelated café scan.

Sphere geometry/materials are shared; the existing visibility observer and
demand rendering stop offscreen work. If WebGL is unavailable, a fallback leaves
playback, metrics and person inspection usable.

In the scan, spheres are 0.8 m across independently of placement scale and rest on
the placement floor. Standing service, employee and queue positions have 2.2 m
center spacing; the queue bends along the aisle, and approach/departure movement
uses separate illustrative lanes. Every replay identity and count is retained.
A shared normal-based lighting texture supplies curved shading and a highlight
without changing Matterport's scene lighting. Soft floor shadows and ground-level
employee/selection rings make depth easier to read. These are visual markers, not
human body footprints, measured illumination, or a clearance/capacity assessment.

## Verification

`components/simulator/interior-state.test.ts` checks paired workloads and engine
outcomes, exact queue/service cohorts, employee placement and shift limits,
departure lifetimes, wait calculations, empty/zero-capacity input and backward
seek/reset behavior. `tests/e2e/simulator-interior.spec.ts` checks shared playback,
counts, selection/reset, staffing inspection at 375/768/1440 px, and WebGL
fallback. Run the repository's four required checks before delivery.

The opt-in `tests/e2e/matterport-live.spec.ts` checks the actual provider's startup,
plan switch without replacing the iframe, shared playback and reset. Run with a
domain-authorized key configured on the server:

```sh
E2E_BASE_URL=http://localhost:3016 E2E_EXPECT_MATTERPORT=1 pnpm exec playwright test tests/e2e/matterport-live.spec.ts --project=chromium --workers=1
```

Live verification also visually confirmed blue customer spheres and one/two
purple employee spheres inside the public café, with real SDK depth testing.
The SDK reserves `outputs.objectRoot` and `outputs.collider`: component outputs
must initialize empty, with those fields assigned during `onInit`. Declaring
them in the constructor fails with the real provider even if a permissive test
double accepts it.
