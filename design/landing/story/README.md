# BizBox landing scroll prototype v1 — HAC-117

**Historical prototype:** this version is now served at authoring path `/story/v1`. `/story` redirects to the newer [curated guided demo](../guided-demo/README.md), replacing the live Vexcel playback path for the current landing review while preserving these files.

Akshar approved the generated simulation-style MacBook screen as a provisional display on November 14, 2026. Match the final product UI after that UI is finished. Do not regenerate the screen or block the landing on exact UI parity now. [Asset provenance](../macbook/imagegen-screen-v2.json) and [exact prompt](../macbook/imagegen-screen-v2-prompt.md) record the selected image.

This additive local prototype implements:

1. Houston sunset, optically centered MacBook, and word-by-word “Simulate business decisions.” No hero CTA.
2. Reversible camera entry into the same display. “Find a place for your idea.” clears before the fullscreen live 3D map hold.
3. Camera return to the MacBook with the same live iframe still loaded. “Test your business idea.” and “Open BizBox”.

Property details, matched Matterport walkthrough, paused counter simulation, and timed consultant narration remain HAC-118, HAC-116/119 and HAC-120. They must be inserted between the map and return. The current prototype deliberately does not present unrelated interior footage or invented simulation results. It is not the complete landing or a deployed homepage replacement.

## Run locally

Run the product with its normal environment on port 4194. Start the local authoring server:

```sh
pnpm exec tsx design/landing/macbook/review-server.ts
```

Open <http://127.0.0.1:4193/story/v1>. `BIZBOX_REVIEW_PRODUCT_ORIGIN` optionally changes the product origin. `BIZBOX_REVIEW_SIMULATOR_URL` optionally changes the simulator source. The authoring server defaults to `/projects/houston-coffee/simulator`; the current local review uses the existing dark `/simulator-demo` reference at port 3016 read-only. That other checkout/server is not part of this change. Final integration must use the supported product route. “Open BizBox” resolves to `/projects/houston-coffee/intake` on the configured product origin.

`/` remains the separate hardware reviewer, with `?live`, `?mobile` and legacy `?texture` inspection options. Previous checkpoints and assets remain intact.

## Integration contract

- `story-timeline.js` is the pure reversible frame contract. `entryMix` is already eased; the camera must not ease it twice.
- The shell emits `bizbox:story-progress` and exposes the current frame through `window.bizboxStory.getState()` for late scene initialization.
- `review.js` owns the shared model, camera and screen projection. `/story-scene.js` imports it, avoiding a second renderer implementation.
- Source surfaces remain 1600 × 1036 during projection. Fullscreen switches to native viewport dimensions and `transform: none`, avoiding the previous tiny intermediate raster surface.
- The hero poster is generated illustrative geography. It is not actual geodata, a provider capture or a forecast. Live entry uses the real simulator iframe. `returning` keeps that iframe visible without reloading it on return.
- Parent-page scrolling owns the story. The product iframe is decorative and inert here, preventing the map from trapping scroll. The final CTA opens the interactive product.
- Three keyboard-accessible chapter controls, PageUp/PageDown/Home/End support and reduced-motion static endpoints are included. No continuous hardware-render loop runs while idle.
- Preserve the visible MacBook credits link when integrating the CC BY model.

## Verification — November 14, 2026

Repository lint, typecheck, test and production build passed: 1275 tests passed, 40 intentionally skipped. Environment-file and client-bundle checks passed. Focused checks include five model asset tests, six screen projection tests, three existing platform adapter tests, and nine timeline tests.

Browser verification covered entry to a native-sized fullscreen iframe, return without frame replacement/navigation, desktop and 390px phone layout, closing CTA, reduced-motion endpoints, and no idle hardware redraw. The CTA intake route returned HTTP 200. Live provider imagery was inspected through DOM state without exporting its pixels. The saved hero image uses only the generated assets.

Branch/worktree: `codex/hac-115-macbook-assets` in the existing isolated `hac-115-macbook-assets/HackPrinceton` checkout. Local work only; no new remote PR, push, merge or deployment is part of this handoff. Main was merged at `28e64ed` before verification; later upstream changes are not claimed here. The original checkpoint PR is #96.
