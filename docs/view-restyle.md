# Shared view styling (HAC-147)

Simulator, site, insights, candidate map, city controls, saved Nessie results,
legacy consultant and interior chrome use the neutral-smoke foundation and DS-7
primitives. Source labels, scenario names, disabled/loading states, selection,
playback, transition, camera and Follow behavior remain owned by their existing
controllers. This change adds no provider calls, assets, dependencies or data.

Legacy paper/pine/mint/viewport utility names are replaced with canonical canvas,
raised panel, field, accent/on-accent, ink/muted and focus-ring tokens. Existing
`surface="paper" | "viewport"` API values remain compatible aliases to the same
neutral system; they do not create a separate light or green theme.

Cards preserve existing content layout and explicit region roles. Buttons and
ordinary fields use the shared primitives; native range/checkbox/switch controls
keep their specialized geometry and behavior. Existing native form-submit defaults
and all handlers remain intact. Opaque backing is retained for text over imagery.
The saved Nessie card still describes a simulated banking sandbox, not a real bank.

## Renderer boundary

`components/simulator/render-palette.ts` is a small adapter for Three, Cesium and
MapLibre. CSS `var()` strings are not passed to those engines. At view/canvas
creation it reads computed canonical colors, composites alpha against the known
opaque canvas, and returns typed legacy `rgb(r, g, b)` strings. Animation callbacks
reuse those values. Missing/unresolved colors fail clearly; no fallback hex palette
is copied into JavaScript. Temporary DOM probes are removed even on failure.

The two approved person-role colors live in the shared CSS as `agent-customer`
and `agent-employee`, with dark print overrides. The real customer/employee legend
uses those same tokens. Customers stay blue; employees stay purple with rings;
selection outlines and visible role labels remain. Shared geometry/material
allocation, renderer disposal and per-frame update paths remain intact.

Illustrative room materials, catchment fills, traffic overlays and activity
markers now draw from the shared palette. Traffic retains its numeric curve and
low/medium/high mapping; only its green low-end color becomes neutral. Candidate
addresses, catchment choice, competitor dots and selection/focus cues remain
explicit. Real map imagery, captured scans and listing floor-plan images are not
recolored or altered.

The three night/day/twilight sky constants in `neighborhood.tsx` are an intentional
scene-content exception: atmospheric scenery is not application chrome. They
retain their existing colors and daylight curve. The separately owned HAC-130 listing/tag adapter was merged unchanged; its native
Cesium tag presentation is outside this migration. The original DS-10 renderer
and chrome surfaces contain no other inline UI hex palette.

## Verification

Source guards cover canonical surface/focus utilities and inline UI colors.
Palette tests cover alpha composition, concrete RGB output, unsupported values,
missing tokens, probe cleanup and safe failure outside a mounted document.
Node-only Matterport tests inject values read from the canonical CSS; runtime
code never imports that test fixture. Existing overlay lifecycle and frame-budget
tests retain their resource/count assertions.

`tests/e2e/simulator-style.spec.ts` checks production CSS retains both role colors,
the visible legend resolves them, print turns both marks dark, and axe passes.
Provider requests are blocked in that style test. The existing simulator, site,
insights, map, station-callout and accessibility suites cover controls and states;
these checks do not establish live provider availability or a new FPS benchmark.
