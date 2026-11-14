# Experiment previews (HAC-79)

`lib/sim/experiment.ts` supplies the pure preview calculation for the future city
Experiment panel. `experimentSettings(input)` takes the saved engine settings;
`runExperiment(input, settings)` rebuilds both weekday and weekend arrivals with
the existing seeded demand generator, runs `simulateDay`, derives hourly metrics,
and computes monthly contribution with the configured weekday/weekend calendar,
ingredients, labor, rent, NNN charges and buildout amortization.

Levers cover average ticket (USD), planned stations, staff headcount, each day
type's opening hours, demand multiplier, seed and displayed day type. A demand
multiplier is relative to the supplied demand baseline, including any calibrated
scale. Configured service mean and optional smoothed arrival mode are retained.
Changing price uses existing cached Jev price-acceptance interpolation; there is
no network request or fresh panel poll. Huff retains its existing price behavior.
Input objects are not mutated. No-op settings reproduce the direct generator,
engine and economics calculation exactly.

`experimentDelta(baseline, alternative)` reports Alternative minus Baseline for
monthly contribution, displayed-day served and walk-aways, p90 wait and the
largest hourly p90 wait. Missing wait observations remain unknown. Both sides
must be the same site and displayed day type. These are single-seed modeled
previews, not uncertainty intervals or a sales forecast.

This commit supplies calculation only. A mounted panel, origins on editable
controls, Web Worker scheduling when work exceeds 50 ms, pin/save UI and scenario
persistence are not implemented here. Persisted mutations must use the shared
`lib/scenario/service.ts` and HAC-82 patch builder; preview calculations must not
write their own scenario history or bypass the existing author/provenance rules.
Zero staff is supported by the engine preview but cannot currently be persisted
in the scenario contract, whose staff override requires at least one person.
City mounting remains HAC-77-dependent. HAC-79 remains incomplete.
