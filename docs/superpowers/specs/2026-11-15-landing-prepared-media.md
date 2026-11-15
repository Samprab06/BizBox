# Prepared media for the landing story

Akshar requested replacing real-time 3D/rendered demonstration visuals with videos or stills, using Zipline as a motion reference. This supersedes the earlier cold-load spec's requirement to preserve a live 3D map on the landing page. The actual product retains its interactive map and simulation.

## Scope

Capture BizBox's existing Vexcel street scene and illustrative road-following movement once at build time. Deliver a six-second muted video with a poster; property discovery uses the poster and the morning chapter plays the recording once. Capture the existing one- and two-counter demonstrations as separate loops. Keep property facts, seeded results, selection controls, headings and consultant dialogue as accessible HTML. Preserve the current responsive MacBook/interior images and scroll story.

The landing must not download Cesium, map tiles or road data at any chapter. No media is fetched for future chapters on initial navigation. Mount sources only when the relevant chapter is visible; pause/release playback on exit or a hidden tab. Reduced motion, Save Data and playback failure retain a useful poster and native facts, with an explicit playback control. The morning clock follows video playback, including buffering and replay.

## Media contract

Content-hashed MP4 (H.264) and WebM files with WebP posters live in `public/landing-assets/prepared`. `manifest.json` records dimensions, durations, normalized map anchors, counter counts and paths. Map overlays project the captured normalized anchors using the same centered cover fit as the media, then clamp glass cards to the viewport. Text and financial data are never baked into footage.

Recordings show an illustrative prepared example, not live pedestrian measurement or property-specific verification. Preserve map attribution, existing modeled-data disclosures and generated-interior provenance. Original source assets and product renderer remain available.

## Verification

Verify media contains the intended roads/dots and visibly distinct one/two counters; verify phone and desktop anchor placement, pause/replay/hidden-tab behavior, poster fallbacks, counter selection through the closing shot, and immutable asset delivery. Retain initial cold-navigation budgets and assert no GIS requests across the landing flow. Run lint, typecheck, unit tests and production build, then relevant cross-browser landing tests.
