# Prepared media for the landing story

Akshar requested replacing real-time 3D/rendered demonstration visuals with videos or stills, using Zipline as a motion reference. This supersedes the earlier cold-load spec's requirement to preserve a live 3D map on the landing page. The actual product retains its interactive map and simulation.

## Scope

Capture BizBox's existing Vexcel street scene and illustrative road-following movement once at build time. Deliver a six-second muted video with a poster; property discovery uses the poster and the morning chapter plays the recording once. Capture the existing one- and two-counter demonstrations as separate loops. Keep property facts, seeded results, selection controls, headings and consultant dialogue as accessible HTML. Preserve the current responsive MacBook/interior images and scroll story.

The landing must not download Cesium, map tiles or road data at any chapter. No media is fetched for future chapters on initial navigation. Mount sources only when the relevant chapter is visible; pause/release playback on exit or a hidden tab. Reduced motion, Save Data and playback failure retain a useful poster and native facts, with an explicit playback control. The morning clock follows video playback, including buffering and replay.

## Media contract

Content-hashed MP4 (H.264) and WebM files with WebP posters live in `public/landing-assets/prepared`. `manifest.json` records dimensions, durations, normalized map anchors, counter counts and paths. Map overlays project the captured normalized anchors using the same centered contain fit as the media, then clamp glass cards to the viewport. Text and financial data are never baked into footage.

Recordings show an illustrative prepared example, not live pedestrian measurement or property-specific verification. Preserve map attribution, existing modeled-data disclosures and generated-interior provenance. Original source assets and product renderer remain available.

## Verification

Verify media contains the intended roads/dots and visibly distinct one/two counters; verify phone and desktop anchor placement, pause/replay/hidden-tab behavior, poster fallbacks, counter selection through the closing shot, and immutable asset delivery. Retain initial cold-navigation budgets and assert no GIS requests across the landing flow. Run lint, typecheck, unit tests and production build, then relevant cross-browser landing tests.

## Measured map-entry transfer

Fresh isolated Chromium contexts, production server, 1280×720/DPR1. After the initial hero settled, seek directly to the morning chapter and collect resource transfers for nine seconds. The original capture build is `1314178`; the replacement includes the subsequent main integration. Local browser cache starts empty in each context. This is a lab resource sample, not a physical-device frame-rate or LCP guarantee.

| Map-entry resources          | Live renderer baseline | Prepared media |
| ---------------------------- | ---------------------: | -------------: |
| Additional transferred bytes |             10,296,374 |        988,324 |
| Additional requests          |                     77 |              3 |
| GIS/road/engine requests     |                     69 |              0 |
| Canvas elements              |                      1 |              0 |

This window includes the expanded screen-background image as well as map media. Transfer decreased90.4%; initial hero budgets remain separately covered. The map MP4 is409,620bytes, its WebP poster340,956bytes; the counter MP4s are165,065/140,360bytes. Browser autoplay policy and decoding still vary by device, so posters remain useful without video playback.

## Final verification

Integrated `a73078b` main normally without conflicts or replacing teammate code. Lint, typecheck, production build, environment-file guard and client-bundle guard pass. Full unit suite:2,201passed/51existing skips. Homepage, retained legacy preview, cold-media budgets and prepared-media behavior:86browser checks passed across Chromium/WebKit/mobile Chrome, with one pre-existing WebKit keyboard skip. New coverage includes no live GIS downloads, immutable/range delivery, poster-only reduced motion/Save Data, manual autoplay recovery, selection through the closing shot and hidden-tab continuity including completed12:00results. The independent focused review's completed-clock regression was fixed and covered by browser tests. The existing recorded-example-loader tracing warning remains.

## Discovery, prompt and framing correction

Akshar reported three visible problems after release: “Two spaces for your café” reused the simulation poster with baked road dots; the location question had an inner blue glass patch; the map recording cropped its edges on narrow screens. Discovery now uses separate dot-free map captures. A480×960 portrait recording/poster complements the desktop capture, and both orientations use centered contain-fit with the same fit for native map anchors. Changing orientation reloads the appropriate source while retaining its playback time. No map engine is added to the landing.

The question's refraction pseudo-layer caused the rectangular blue inset. It is disabled only for the location question's composer and bubbles; native backdrop blur and the reflective border remain. This also avoids a CSS compiler prefix-deduplication issue that discarded the unprefixed backdrop-filter override in Chromium. Other chat layouts and glass components remain unchanged.

Capture files/provenance use the original renderer at build time. The temporary capture route/components were moved outside the repository before validation. New portrait MP4 is296,548bytes; discovery stills are369,272bytes (desktop) and211,382bytes (portrait). Everything retains content hashes and existing immutable delivery. Current hero loading budgets remain unchanged.

Correction verification: both new regression cases failed against the prior implementation before the fix. Lint/typecheck/build and env/client-bundle checks pass. Full units:2,203passed/51existing skips. Homepage/legacy/cold/media browser coverage:92passed/oneexisting WebKit keyboard skip across Chromium, WebKit and mobile Chrome. New coverage checks clean discovery assets, complete-frame fit, portrait source selection, rotation/time continuity, and absence of the blue pseudo-layer in both prompt and sent bubble. An independent focused review found no unresolved issue; actual phone screenshots verify both cards and both full dot flows remain clear of the overlays.

Main's separate HAC-200 workspace failure was reproduced against the unmodified9c45718 production build before rebuilding these corrections. It navigates directly to the workspace and is not caused by landing changes. Its repair is tracked separately, with explicit candidate selection retaining the real chat-request assertion.

## Linux WebKit source initialization

The full Linux WebKit run exposed manual-play requests that remained pending at `HAVE_NOTHING`/`NETWORK_IDLE`, with muted video visible and the story unpaused. An isolated comparison kept the assertions unchanged: the original path failed6/6 repeated cases; explicitly loading sources immediately before first playback passed6/6, reached readyState4 and advanced time. The player now calls `load()` before `play()` only when it has no media data. Save Data/reduced-motion/visibility source gates remain intact.

The same resource-selection issue left a newly restored paused/end frame unloaded despite an “ended” parent label. A direct Chromium probe showed actualtime0/durationNaN/readyState0 after hide/show; loading metadata for retained positions restores the real endpoint (time5.96/duration5.96/readyState4, paused). The browser regression now checks the decoded endpoint as well as the label, and covers first mounting while paused then resuming. Temporary probe jobs/hooks are removed; the final workflow equals main with no changed gates, retries, skips or timeouts.

Final player verification: all2,203unit tests and production build/lint/typecheck pass;30native media/cold-budget cases were verified across Chromium/WebKit/mobile Chrome. The new paused-first-mount test initially tried Pause on the hero, where it is intentionally absent; correcting setup to enter location discovery first made all three variants pass without runtime changes. The27other cases passed in the initial batch. A focused source review cleared the initialization/restoration lifecycle. The Linux comparison evidence and all assertions are preserved; temporary instrumentation is absent from the final tree.
