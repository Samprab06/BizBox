# Replay 3D view: manual script

Ticket: HAC-36 · Last run: not yet run · App URL: https://hackprincetonweb.vercel.app

Playwright checks replay determinism, controls, labels and the no-WebGL fallback
(`tests/e2e/replay-determinism.spec.ts`). This script covers what only looking can check:
the 3D canvas itself.

## Preconditions

- App running at https://hackprincetonweb.vercel.app (or local `pnpm start` on
  http://localhost:3000; use that URL in every step instead).
- Browser and viewport: Chrome with hardware acceleration on, 1440x900.
- Starting state: a fresh tab. No sign-in is needed.
- Test data: the example project `houston-coffee`, site `montrose`.
- Take a screenshot at every step and name it `step-<n>.png`.

## Steps

| # | Do | Expected result |
|---|---|---|
| 1 | Open `<App URL>/projects/houston-coffee/replay?site=montrose`. | The page shows "Modeled layout · synthetic weekday · default assumptions", a 3D floor plan with dark counters, and a Play button. No error text. |
| 2 | Drag the "Seek to simulated time" slider to about one third of its length. | The clock reads a mid-morning time. Blue spheres (customers) are on the floor; the counts line shows at least 1 waiting or in service. |
| 3 | Look at every sphere near the counters. | No sphere is drawn inside or through a counter box, and no sphere is outside the light-green floor. |
| 4 | Click directly on one blue sphere in the canvas. | That sphere turns orange, and the "Inspect a customer" menu below changes to that customer, showing Persona, Synthetic choice shares, Expected visits per month and Stay probability at arrival. |
| 5 | Click a second, different sphere. | The first sphere turns blue again, the second turns orange, and the details below change to the second customer. |
| 6 | Set Speed to 4× and press Play. Watch for 10 seconds. | Spheres appear in the line, move to the counters, and disappear after service. The clock advances steadily. |
| 7 | Press Pause. | The clock and all spheres stop moving. |
| 8 | Drag the slider slowly from the start to the end over about 5 seconds. | The scene updates continuously: no blank frames, no flicker, and no sphere vanishing and reappearing in the same place. |
| 9 | Try to orbit the camera: click and drag on an empty part of the canvas. Then scroll over the canvas. | Record what happens. If neither orbits nor zooms, mark this step **Fail** with the note "no camera controls" (the ticket expects orbit, zoom and reset). |
| 10 | If step 9 changed the camera, look for a reset control and use it. | The view returns to the original top-down angle. If there is no reset control, mark **Fail**, "no camera reset". |
| 11 | Seek to the opening time (slider at the far left) and take a screenshot. | Screenshot `replay-open.png`: an empty or nearly empty floor. |
| 12 | Seek to the middle of the day and take a screenshot. | Screenshot `replay-midday.png`: customers queued and in service. |
| 13 | Seek to the end (slider at the far right) and take a screenshot. | Screenshot `replay-close.png`: the button reads "Replay", and the counts line shows the day's totals. |

## Results (paste into the ticket)

| # | Pass / Fail | Notes or screenshot |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
| 12 | | |
| 13 | | |

Attach `replay-open.png`, `replay-midday.png` and `replay-close.png` to HAC-36. File any
failure as a `Bug` following `tests/manual/README.md`.
