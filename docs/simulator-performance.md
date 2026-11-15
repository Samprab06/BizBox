# Simulator rendering performance (HAC-65)

The labelled Example mode still uses the same seeded toy café scenario. Stored
runs supplied through HAC-63 use the same rendering code. Graphics quality affects
presentation, not arrivals, service decisions, costs or results.

## Controls and rendering

The **Graphics** selector defaults to **Balanced**. **Detailed** restores the
original city pixel density, tile detail and cloud sampling. Switching quality
keeps the viewer, camera and current simulation time.

| Setting                         | Balanced                       | Detailed                              |
| ------------------------------- | ------------------------------ | ------------------------------------- |
| City pixel density              | At most 1 pixel per CSS pixel  | Native display density                |
| City tile screen-space error    | 16                             | 1 (original)                          |
| Distance-dependent tile error   | Enabled                        | Disabled (original)                   |
| Tile cache / overflow budget    | 128 / 64 MiB                   | 512 / 512 MiB (original)              |
| Cloud layer                     | Off by default; optional banks | Optional banks plus volumetric clouds |
| Volumetric ray / shadow samples | Not used                       | 40 / 5 (original)                     |
| Café pixel density              | 1                              | Up to 1.5 (original)                  |

The city requests frames when its view, time, overlays or assets change instead
of continuously redrawing a paused scene. Balanced samples traffic/demand every
five simulated minutes, with opacity pulses over a fixed 65 m demand footprint;
Detailed samples every minute and retains the expanding footprint. Enabled cloud-bank positions sample each simulated minute. Sky and clouds are an explicit optional control; Balanced defaults them off. Playback batches React updates to at
most 60 Hz while accumulating elapsed time and preserving the frame phase; camera input remains independent.
Offscreen scenes and scenes covered by another fullscreen viewport suspend their graphics loops, then synchronize to the latest
time on return. Café canvases use demand rendering and initialize after first
visibility. Hidden-document playback pauses without advancing on resume.
Road tile requests are shared while pending, and obsolete requests are aborted.
The camera keeps Cesium's bindings and collision checks. Shorter spin/translation
inertia (0.5) and zoom inertia (0.4), zoom factor 8 and movement clamp 0.2 make
motion more responsive and reduce prolonged coasting. Tile tint expressions are
reused until their rounded color changes. Cesium's camera/update loop is capped
at 60 Hz rather than scanning the entities at the display's highest refresh rate.
Tile cache budgets bound tile caching/refinement, not total browser memory.

## Initial PR measurements (superseded by the follow-up below)

Measured locally on Akshar's Mac on November 14, 2026, in a foreground Chromium
browser with a 1500 × 804 CSS-pixel viewport and display pixel ratio 2. Both
candidates used `pnpm build` + `pnpm start`, the initial Montrose camera, normal
browser cache and 1× playback starting around 9 AM. Short samples measure frame
cadence with requestAnimationFrame and temporary WebGL draw-call counters. The
counters are removed after each sample and are not part of the application.

| Eight-second neighborhood playback sample | Original `383b558` | Balanced   |
| ----------------------------------------- | ------------------ | ---------- |
| Average frame cadence                     | 9.2 FPS            | 18.4 FPS   |
| Median frame interval                     | 116.6 ms           | 17.2 ms    |
| 95th-percentile frame interval            | 158.6 ms           | 341.2 ms   |
| City drawing buffer                       | 3000 × 1608        | 1500 × 804 |
| Offscreen café draw calls                 | 1,956 and 1,890    | 0          |

A settled paused sample issued no WebGL draw calls. A steady café-only sample
after scrolling the loaded city completely offscreen issued no city draw calls;
its frame cadence was about 118 FPS on this display. This does not promise 118
FPS on other displays or hardware. Frame cadence while idle is not a count of
rendered frames: the draw-call counter establishes whether graphics work stops.

The final sample improves average cadence and median latency, but its tail
latency remains high; this does not establish consistently smooth playback.
These are short local observations, not a universal benchmark. First-use shader
compilation, geometry preparation, downloads and quality changes can still
stutter. Network event collection for the original sample was truncated, so no
complete cold/warm tile count, byte reduction or load-time improvement is claimed.
Temporary diagnostics and the simulated document-visibility override used for
the suspension check were removed. Native tab-visibility behavior also depends
on the browser; unit tests cover visibility transitions and observer cleanup.

## Follow-up: eliminate color-driven geometry rebuilds

The initial patch still changed `ConstantProperty` material colors. Cesium forwards
those definition changes into static geometry invalidation, recreating ground
primitives even when the footprint is fixed. Callback-backed reusable colors now
update per-instance attributes instead. Real-Cesium regression tests verify zero
entity definition changes for road colors and demand opacity, correct backward
seeks, and safe result-object reuse.

Playback now targets 60 Hz and preserves its frame phase instead of repeatedly
discarding fractional frame time. The target branch was synchronized with
`74c95e0` (HAC-63); its optional story/stored-run support is retained.

Active-playback checks explicitly recorded the simulation clock before and after
each eight-second sample. The stalled control at `7330d54` advanced only about
22 simulated minutes and recorded 19 long tasks. The final candidate advanced
144 simulated minutes (the intended 1× speed), with 32.1 actual city-rendered FPS,
45.2 browser frame callbacks per second, p95 callback interval 41.7 ms, and eight
shorter long tasks totalling 646 ms. A preceding candidate sample rendered 43.1
city FPS with no long tasks. These varying short samples do not establish a
fixed 60 FPS; cold tiles, browser scheduling and machine load still matter.

Actual rendered frames count refresh intervals containing a WebGL draw call;
they are distinct from requestAnimationFrame cadence. Earlier callback-only
checks of 30 and 114 FPS should not be read as city-rendering rates. The final
paused sample again recorded zero draw calls. Temporary probes were removed.

## Workspace simulator check (HAC-70)

Measured on November 14, 2026 on `/projects/houston-coffee/simulator` (the
workspace route that `/simulator-demo` redirects to), at main `bab11dc`, with the
method below: `pnpm build` + `pnpm start --hostname 127.0.0.1 --port 3014`, a
foreground headed Chromium 159 window with a 1500 × 804 CSS-pixel viewport and
device pixel ratio 1, Balanced graphics, the initial Montrose camera, normal
cache, about 20 s to settle, then a seek to 9 AM and 1× playback. Hardware: a
Windows 10 laptop with Intel HD Graphics 520 (ANGLE / Direct3D 11). In the
workspace layout the city canvas is 959 × 639 pixels. A temporary probe in the
measuring script counted WebGL draw calls per animation frame; it is not part of
the application.

| Sample                                | City frames drawn | Median / p95 interval | City draw calls | Long tasks | Simulated minutes |
| ------------------------------------- | ----------------- | --------------------- | --------------- | ---------- | ----------------- |
| Playing, city in view, 8 s            | 4.4 FPS           | 233 / 252 ms          | 1,505           | 0          | 62 to 65          |
| Playing, city scrolled offscreen, 4 s | 0 FPS             | 16.7 / 16.8 ms        | 0               | 0          | 73                |
| Paused, city in view, 4 s             | 0 FPS             | 16.7 / 17.0 ms        | 0               | 0          | 0                 |

What this shows:

- Paused and offscreen scenes stop city drawing, as HAC-65 intended. The café
  scenes in view kept drawing while the city was offscreen.
- On this integrated GPU the city is GPU-bound at about 4 FPS. That is far below
  the 32 FPS recorded above on Akshar's Mac, but the hardware differs, so this
  sample neither confirms nor refutes that the workspace route keeps HAC-65's
  frame rate. A like-for-like check still needs the same Mac, or the HAC-65
  candidate re-measured on this laptop.
- Playback advanced only 62 to 65 simulated minutes in 8 s with the city in view
  (1× is about 144), against 73 minutes in 4 s with it offscreen. On slow GPUs
  the playback clock runs slower than real 1× speed while the city is visible.
  HAC-77 addresses this in commit `3a00669`. Capture the clock delta again when
  measuring a build with that change.
- The 500-agent case could not be measured here: this example renders the seeded
  café day, not a 500-agent city layer, which HAC-77 adds.

For the follow-up, run the HAC-65 candidate and workspace build on the same
machine in the same browser. Keep the graphics setting, initial camera, device
pixel ratio and cache warm-up consistent. Record each build's commit, city
drawing-buffer size, city-rendered FPS and simulated minutes advanced. Record the
500-agent workload separately when it is available.

## Reproduce and verify

1. Install from the lockfile with `pnpm install --frozen-lockfile`.
2. Use the existing private `VEXCEL_API_KEY` in `.env.local` for the neighborhood;
   never put it in source or a performance recording. The café fallback works
   without it.
3. Run `pnpm build` and use the project's production runtime (see
   [`Dockerfile`](../Dockerfile) for standalone asset packaging). The local
   samples used `pnpm start --hostname 127.0.0.1 --port 3014`; after the target
   branch enabled standalone output, that command emits a warning and does not
   establish standalone deployment acceptance.
4. Open `/projects/houston-coffee/simulator` (`/simulator-demo` redirects here) in a WebGL-capable browser. Keep viewport, camera,
   display density and cache conditions the same between candidates. Bring the
   browser to the foreground; occlusion throttling invalidates an FPS comparison.
5. Wait for the city to load and settle. Seek to 9 AM and sample 1× playback for
   eight seconds. Pause, let pending assets settle, and separately count idle
   draw calls. Avoid interpreting startup work as steady-state performance.
6. Open Operating plan, play and pause the café, inspect a customer, seek, and
   toggle Focus on shop. Scroll between views while paused and while playing.
   Confirm offscreen draw calls stop and returning views render the latest time.
7. Toggle Balanced / Detailed without losing the camera or time. Navigate away
   and return; no old viewer, observer or requests should remain active.

The seeded totals remain 55 served / 52 left for one station and 80 served /
28 left for two stations, with the same modeled monthly contribution change.
Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` before a PR.

## Cold load of the 3D neighborhood (HAC-177)

**Budget:** on a cold browser cache, the first buildings render within 9 s on
an 8 Mbps desktop link and within 12 s on a 4 Mbps link (measured below:
8.0 s and 11.0 s at worst). Until then the scene
shows its real loading stage, and after 8 s it offers **Skip 3D view**.

### Root cause

Two things made a cold load wait for the whole initial view:

1. **Decoders loaded last.** Vexcel tiles are Draco-compressed with KTX2
   textures. Cesium starts its Draco and KTX2 worker scripts and wasm binaries
   only when the first tile arrives. By then it has queued about 18 tile
   downloads, and the decoder files waited behind them. Measured at 8 Mbps,
   `decodeDraco.js` and `transcodeKTX2.js` were requested at 5.5 s and arrived
   at 14 s, when the last tile finished. No tile could be decoded before that,
   so nothing rendered until the whole view had downloaded.
2. **Every ancestor was downloaded.** Replacement refinement without
   `skipLevelOfDetail` loads zoom 13 through 18 for each visible area:
   127 Vexcel requests and 20.4 MB for the initial street view.

`components/simulator/tile-decoders.ts` now starts Cesium's own Draco and KTX2
singletons right after the SDK import, while the tileset document loads, and
waits for them (at most 10 s) before tile content can stream. The street view
also uses `skipLevelOfDetail`, as regional shortlists already did. The initial
view now needs 63 requests and 9.1 MB. The final detail is unchanged
(the same screen-space error); intermediate levels are skipped.

### Progress

`components/simulator/city-loading.ts` derives the overlay from real events
only: the 3D engine, the two tile decoders, the Vexcel tileset document, then
Cesium's own counts of tiles ready, downloading and decoding. Cesium discovers
the number of tiles in a view while it traverses, so no percentage is shown.
After the first buildings render, a small status line reports refinement
until the view's tiles have all loaded. Elapsed seconds stop at the first
building. Skip removes the 3D viewer; the timeline and replay keep working.

### Measurements

Measured on November 15, 2026 at `45ac60f` (before) and this change (after).
Both used `pnpm build` + `pnpm start` with a dummy `VEXCEL_API_KEY`, a local
proxy that sent `/api/vexcel/*` to the production tile proxy (real tiles, CDN
warm), headless Chromium 1243 with SwiftShader WebGL, a 1440 × 900 viewport,
Balanced graphics, a fresh browser profile for each run, and Chrome's network
throttling. "First buildings" is navigation to the loading overlay clearing
(Cesium's first `tileVisible`). "Settled" is the last Vexcel response for the
initial view.

| Link (down / RTT) | First buildings, before | First buildings, after | Settled, before | Settled, after |
| ----------------- | ----------------------- | ---------------------- | --------------- | -------------- |
| Unthrottled       | 7.0 s                   | 6.4–7.1 s              | 7.0 s           | 6.4–7.3 s      |
| 20 Mbps / 40 ms   | 13.4 s                  | 6.2–7.6 s              | 12.6 s          | 7.8–9.4 s      |
| 8 Mbps / 60 ms    | 27.4 s                  | 7.3–8.0 s              | 26.2 s          | 14.2–14.5 s    |
| 4 Mbps / 80 ms    | 49.8 s                  | 10.4–11.0 s            | 49.6 s          | 25.7–26.1 s    |

Before the change, the first building appeared only after all 20.4 MB had
arrived. After it, the first building needed 0.4–1.9 MB on throttled links.
The 4 Mbps baseline matches the 50–60 s QA report. Unthrottled loads in this
container are bound by JS download and SwiftShader rendering, so they barely
change. A real GPU and a desktop browser will differ; repeat on the QA machine
to confirm the budget there.

Production (`usebizbox.app`, unthrottled, same container) took 7.2 s to the
first building on a CDN-cold load and 6.6 s CDN-warm. Every Vexcel response on
the first load was an `x-vercel-cache: MISS`; Vercel clears its CDN cache on each
new deployment, and production redeploys often. On a CDN-cold load each tile goes to Vexcel. That
adds latency but does not explain a 50 s load by itself.
