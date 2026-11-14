# Controlled Experiment panel (HAC-79)

`components/city/experiment-panel.tsx` presents BizBox's experiment levers and
single-seed preview results. It uses the existing paper/card, Baseline/Alternative
and evidence-badge design system. It adds no simulation clock, engine execution,
network request, worker, scenario history or persistence.

## Host interface

`ExperimentPanel` takes these controlled props:

- `settings: ExperimentSettings` and required `origins: ExperimentOrigins`.
- `onSettingsChange(settings, origins)`: the host updates its draft. Only the
  edited lever's origin changes to `founder`; other settings and origins remain
  intact. The supplied inputs are never mutated.
- `onRestart(settings)`: the host recalculates and supplies `current`.
- Optional `onSaveBaselineAndRerun(settings)`: the host pins the **displayed**
  current run as `baseline`, then recalculates using the edited settings. The
  button is disabled with an explanation if the handler or current run is absent.
- Optional `current`, `baseline`, `busy` and `error`.

The `ExperimentLever` keys are `averageTicketUsd`, `plannedStations`,
`staffHeadcount`, `demandMultiplier`, `seed`, `dayType`, `weekdayOpen`,
`weekdayClose`, `weekendOpen` and `weekendClose`. The four time keys refer to
`settings.hours.<day>.openMin/closeMin`. Each control shows the supplied origin
and its design-system evidence badge. No provenance is inferred from API success
or from the appearance of an input.

Hours are entered in 24-hour `HH:MM` format; `24:00` is accepted for closing at
midnight. Both day types require closing after opening on the same day. Numeric
inputs reject empty, negative and non-finite values; stations, staff and seed
require whole numbers, and ticket price, stations and demand multiplier must be
positive. Incomplete input text stays local and disables actions until corrected;
valid settings remain controlled by the host. Zero staff is valid for preview;
the current saved scenario contract requires at least one person, so the host
must enforce that boundary when saving.

Both action callbacks may return a promise. While pending, controls and actions
are disabled, and duplicate submissions are blocked. Synchronous throws and
promise rejections produce an inline error. The panel never claims that a save
succeeded: only the host can confirm a persisted result and update the supplied
runs. The host should clear its own `error` prop when appropriate.

## Results and integration boundary

All five deltas use the existing `experimentDelta` helper: Alternative minus
Baseline for monthly contribution, displayed-day served, walk-aways, p90 wait
and the largest hourly p90 wait. Missing wait observations remain **Unknown**.
The results table scrolls horizontally on narrow screens and supports left/right
arrow keys when its labeled region has focus. Different sites or day types are
shown with explicit labels and no delta,
rather than calling the helper with incompatible runs. A changed draft keeps the
last calculated run visible with a restart reminder and its actual day, seed and
site. These single-seed previews are model scenarios, not forecasts or intervals.

The mounting host is still HAC-77-dependent. It must reuse the canonical playback
controller, perform expensive calculations in a Web Worker when they exceed
50 ms, and call the shared `lib/scenario/service.ts` / HAC-82 boundary for saved
mutations. Passing an in-memory pin callback does not establish scenario
persistence. Do not wire this component directly to a new API or a second timer.
The panel and helper alone do not complete HAC-79's mounted/worker/persistence
acceptance.

## Verification

`components/city/experiment-panel.test.ts` checks immutable edits and individual
origin changes, all control labels/provenance, disabled save states, result/delta
presentation, mismatched-day/site safety, unknown waits, invalid hours and busy
states. `lib/sim/experiment.test.ts` separately checks deterministic engine and
economics parity and the fixture's extra-station wait behavior.

Browser verification should mount the controlled component in a local harness,
exercise numeric/time/day edits, keyboard focus, invalid input, pending actions,
callback rejections and reset/retry, and inspect 390/768/1440px widths and reduced
motion. The component itself has no animation or canvas. A local harness is
verification only; it does not establish the future city host, worker or saved
scenario integration.
