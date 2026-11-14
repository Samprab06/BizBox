# Simulator workspace (HAC-70)

`/projects/[projectId]/simulator` mounts the existing seeded operating replay and
stored-run loader inside the warm shell and project context. The existing project
navigation includes **Test plan · Simulator**; HAC-69 owns the three-task navigation
reorganization and must retain this destination. The legacy `/simulator-demo`
redirect preserves comparison, site, project, run and repeated query parameters.
Project identity for loading comes from the new route path.

Analysis uses solid paper cards. Each 3D scene is a bounded dark-token viewport;
only its floating control groups use `GlassControl`. Expand and Collapse use native
fullscreen so keyboard activation, Escape, and browser focus behavior are preserved.
Unsupported fullscreen reports a local message and leaves the replay usable.

The fixture compares **Baseline** (pine) and **Alternative** (blue). Stored runs
remain **Baseline · Weekday** and **Baseline · Weekend**: two representative days
are not presented as alternative business plans. Stored customer decisions say
**recorded joined/left · join probability not stored**, because canonical events
do not preserve the model’s original probability. The fixture shows its actual
modeled probability. The existing engine outputs and
HAC-65 frame sampling, quality budgets, callback colors and visibility suspension
are retained. Balanced defaults sky/clouds off; either quality allows explicitly
turning them on or off. The ambient layer follows simulated time, not a new timer.

Traffic is labelled **Illustrative traffic pattern**, beside the switch and a
visible time-curve/invented-offset qualifier. Activity anchors are **Assumed
activity by time of day**, with their hand-placed provenance beside the legend.
Café arrivals and monthly values say **Modeled**. The contribution-change card has
an adjacent native one-tap disclosure for **22 weekdays · ingredients, labor, rent,
buildout amortization**, with excluded costs stated there.

Known synthetic stored records retain Example provenance; nonsynthetic stored
records do not. Missing/failed stored records fall back to the labelled example.
No data persistence, API contracts, simulation inputs, or dependencies change.

## Decision-first integration (HAC-71)

The shared `DecisionHeader` leads with the operating question, qualified answer,
real operating scene and next action. The existing neighborhood and larger replay
remain available below. The top scene is 160 px high, uses the existing engine run,
and its time state is shared with the replay. The scenario selector chooses an
actual run and uses that day's own opening hours. Fullscreen and **Full replay**
provide larger views; its optional camera fit leaves other scene defaults intact.

Saved comparisons forward the stored HAC-62 robustness summary unchanged. Its
model disagreement remains visible, and its influential condition opens the exact
comparison sensitivity control without automatically running a model. Historical
records without a summary say robustness is unavailable. The existing profile
version lookup identifies outdated data; failed freshness checks keep the saved
scene and show an unknown-freshness qualification instead of substituting examples.

The seeded fixture answers from its actual additional served customers and
contribution direction, with **One seeded example; demand robustness has not been
tested** beside it. Example and stored weekday/weekend labels retain their existing
meaning. The next action opens the real assumptions/evidence when no matching
saved sensitivity condition exists.

## Neighborhood WebGL fallback

The neighborhood's existing rejected-load handler catches Cesium import and
Viewer-construction failures. It clears failed SDK UI and stale control callbacks,
shows a local WebGL/imagery fallback, and retains Retry. An offline Chromium
regression exercises unavailable WebGL on the real workspace city branch; run
the local app with a dummy `VEXCEL_API_KEY`, then set `E2E_SIMULATOR_CITY=1` for
`simulator-workspace.spec.ts`. Test imagery requests are intercepted and never
reach Vexcel. The gate is unset when the server does not expose the city branch.
This guard covers the Cesium neighborhood only. The replay floor-plan fallback
from HAC-103 is retained from main; café scenes keep their existing React Three
Fiber fallback. The offline city check does not establish café WebGL-failure
coverage.

## Remaining integration checks

HAC-69 still owns the three-task navigation layout. This change provides the
Simulator destination and active state within the existing project navigation.
The HAC-65 render budgets and sampling remain covered by tests; a new comparable
foreground city FPS measurement is still required. The local fullscreen sample
was browser-throttled to roughly one callback per second and advanced the clock
only 15 simulated minutes in 8.8 seconds, so it cannot establish the ≥30 FPS
acceptance threshold. Do not treat that sample as a rendering benchmark.
