# BizBox guided product demo — HAC-117

**Current revision:** see [consultant/sandbox refinement](refinement-v2.md). It uses a GPT 2D MacBook, the client Ferris-wheel photo, local Geist, clearer glass and moving location/exterior beats. The initial curated implementation and verification below are retained as history.

This revision follows Akshar's approved full landing direction: preconfigured onboarding in 6–8 seconds, generated location/property/interior scenes, a grounded staffed-counter comparison, and a MacBook return. Exact final product UI parity is deferred. The earlier live-camera prototype and all source assets remain intact.

## Surfaces

- `/landing-demo`: standalone Next.js landing route, using the normal application build.
- Authoring server `/story`: local redirect to the new page. `BIZBOX_REVIEW_LANDING_ORIGIN` defaults to `http://127.0.0.1:4195` and is authoring-only configuration.
- Authoring server `/story/v1`: previous live Vexcel/camera prototype, preserved.
- Authoring server `/`: original hardware review, preserved with its existing live/texture options.

The product homepage and general workspace/onboarding code are not replaced. No deployment is implied by this local review.

## Media

`assets.json` records native resolution, byte sizes, original outputs and provenance. `prompts.json` contains the exact final prompt set. Map/interior/overhead images were generated with built-in GPT Image, copied into `public/landing-assets/guided-demo/`, and are illustrative example content. The overhead view uses the interior as its reference to preserve the green-tile bar, walnut tables, glazing and circulation lane. They are not real listing imagery, surveyed geography or Matterport footage.

`macbook-frame-v2.png` is an offline Blender EEVEE render of the existing sourced CC BY MacBook, with transparent background/display. The original source and prepared scene were preserved. `macbook-frame-v2.json` records the aperture quad in normalized image coordinates, in TL/TR/BR/BL order. `render_macbook.py` creates its own sibling scene and saves an editable `.blend` library. Run it in Blender with `__file__` set to the script path and the HAC-115 source scene open. The physical-model credits link remains required.

Playback uses generated imagery and animated DOM overlays. No live Vexcel, Matterport iframe, WebGL laptop renderer, live agent or paid API request is required by this landing.

## Experiment evidence

`components/landing-demo/demo-data.ts` imports the existing `makeDemo()` from `components/simulator/fixture.ts` on the server. The client receives only prepared data. This reuses the actual product engine and existing seeded schedule, not a second simulation implementation.

Both setups use the same 110 arrivals, service draws and seed 45, for one modeled weekday morning from 8 AM to noon. Current setup has one staffed station; proposed change has two. Wages are $18/hour; total morning labor is $72 versus $144. Proposed buildout is $6,000 higher. The engine models station count and staffing separately; this example explicitly changes both.

Metrics have distinct meanings: served means completed services; walkaways are balked plus reneged and exclude unfinished customers at closing; p90 wait describes served customers only. Revenue and labor are for the four-hour example. Contribution is a daily equivalent of modeled monthly contribution divided by 22 identical example mornings, including ingredients, labor, rent and 36-month buildout amortization; taxes and other overhead are excluded. Do not label it guaranteed profit or a forecast. Property rent/area derive from this same synthetic fixture, not a real listing.

## Verification

Prepared-data tests verify the exact engine outputs, identical arrival IDs/times, explicit staffing/cost changes, deterministic reconstruction and fixture property/economics consistency. The landing timeline tests cover chapter order, fast/reverse seeking, camera endpoints, bounded 7000ms onboarding and selection persistence on return.

Verified the production build at `http://127.0.0.1:4195/landing-demo`, with `/story` redirecting from the authoring server. Lint, typecheck, production build, environment-file and client-bundle checks passed. Full Vitest rerun: **1288 passed, 40 skipped** across 150 passing files and 11 skipped files. The initial full test run hit two 5-second timeouts in the existing comparisons-handler suite; all 13 tests in that file passed in isolation, then the full suite passed unchanged. No test timeouts or backend logic were edited.

Integrated Chromium browser checks covered:

- Complete 7000ms onboarding, pause retaining the same elapsed value, resume, skip and replay.
- All chapters and fast forward/reverse seeking; property details precede interior.
- Current/proposed setup selection and matching actual served/p90/labor values; the selected metrics remain visible in the closing MacBook.
- Desktop, 390 × 844 portrait and 844 × 390 landscape. Portrait contains the whole overhead room with matched path alignment; landscape retains essential property/results/controls. No horizontal overflow.
- Actual computed `backdrop-filter: blur(14px) saturate(1.25)` on the production glass surfaces, plus localized SVG displacement/rim/reflection styling. Inline blur is intentional: the current CSS pipeline dropped the stylesheet declaration in Chrome. Fallback styles remain available without SVG backdrop support.
- Reduced motion pauses illustrative SVG customer motion and exposes the completed business brief.
- Missing-scene fallback retains navigation. A JavaScript-disabled reload exposes the no-script brief and working product entry link without a long empty scroll region.
- No iframe, canvas, Vexcel/Cesium/Matterport or agent/API request in the landing's playback path. Production landing, product intake entry and preserved `/story/v1` returned HTTP 200.

An independent read-only code review found the previous short-container rule hid final results and landscape controls; this was corrected with explicit laptop/fullscreen layout modes and verified in browser. No material review finding remains open. The authoring browser throttles idle animation frames, so synthetic frame timing from that harness is not a reliable device FPS benchmark; no universal frame-rate claim is made.

## Integration boundaries

The final UI remains provisional as requested. All geographic/property/interior visuals are illustrative, not matched real listing or Matterport evidence. Customer paths are explanatory animation; displayed outcome numbers come from the actual seeded engine fixture. Final supported product entry is currently `/projects/houston-coffee/intake` in this checkout; reconcile with newer main's `/start` flow during integration, preserving that owner's session behavior. No general onboarding/workspace/backend implementation was duplicated.

The code is local on `codex/hac-115-macbook-assets`. Media/data checkpoint: `148a7a8`; the subsequent presentation/handoff commit completes the curated demo. No new push, remote PR, merge or deployment was performed. Earlier checkpoint PR #96 and all previous assets/routes remain preserved.
