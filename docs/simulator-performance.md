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
