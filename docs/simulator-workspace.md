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

## Remaining integration checks

HAC-69 still owns the three-task navigation layout. This change provides the
Simulator destination and active state within the existing project navigation.
The HAC-65 render budgets and sampling remain covered by tests; a new comparable
foreground city FPS measurement is still required. The local fullscreen sample
was browser-throttled to roughly one callback per second and advanced the clock
only 15 simulated minutes in 8.8 seconds, so it cannot establish the ≥30 FPS
acceptance threshold. Do not treat that sample as a rendering benchmark.
