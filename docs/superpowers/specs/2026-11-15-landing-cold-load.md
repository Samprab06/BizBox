# Landing cold-load optimization

Akshar reported that the published homepage was very slow on other computers without a browser cache. This follows the approved homepage release. Preserve the existing design, real 3D map, business scenario, routes and teammate changes.

## Evidence and changes

Cold Chrome traces of the published version with Slow 4G and 4× CPU slowdown showed the original CSS city photograph completing around 9 seconds and the screen photograph around 15 seconds. The initial hero did not download Cesium; its dynamic loading was already working. The dominant initial cost was the two JPEG backgrounds, not an eager 3D renderer.

The story now renders responsive build-time WebP pictures in server HTML. The initial laptop background selects a candidate for its actual aperture rather than downloading a full-screen 3840px photograph; the same image node upgrades as the screen expands. The measured 1500px/DPR2 transition kept the image node and upgraded from the 1280px candidate to 1920px without overflow. The laptop uses one correctly matched responsive high-priority preload and direct WebP delivery. A legacy Geist font remains available to the earlier demo but is no longer preloaded on the DM Sans homepage. The invisible final link no longer prefetches the app during the hero.

New derivative filenames contain content hashes and use immutable caching. This cache policy only targets the new WebP directory; mutable pages and existing assets keep their previous policy. Source images are preserved, no image generation/dependencies/services were added, and the native-size laptop alpha is unchanged. Future-scene photographs remain mounted only when their scenes are reached. Memoizing StoryMap avoids repeating its tree on unrelated parent clock/scroll updates; actual 3D rendering and seeded results are unchanged.

## Controlled desktop comparison

Same production server origin, Chrome 1365×900/DPR1, Slow 4G, 4× CPU. Cold navigation/reload bypassed the browser cache; positive transfer sizes confirmed downloads. These are lab samples, not field percentiles or a physical-device FPS claim.

| Metric | Before | Optimized |
| --- | ---: | ---: |
| Initial resource transfer | 2,459,584 bytes | 551,234 bytes |
| Load event | 15,026.6 ms | 4,590.9 ms |
| City image complete | 9,206.0 ms | 4,048.9 ms |
| Screen image complete | 15,023.9 ms | 4,589.4 ms |
| First contentful paint | 1,916 ms | 1,820 ms |
| Largest contentful paint | 2,106 ms | 2,268 ms |
| CLS | 0.01 | 0.01 |

Initial transfer fell 77.6% and the load event improved 69.4%. LCP stayed in the 2.1–2.3 second range in these samples; this work does not claim an LCP improvement. It targets the previously very late backgrounds and cold asset delivery. Server timing, viewport/density and network conditions affect outcomes. The 3D view still needs its own map resources after entering that scene.

## Regression checks

The cold-load browser test failed against the original build and passes against the optimized build. It budgets initial media under 750KB and scripts under 350KB, rejects the original JPEG downloads and future-scene/3D requests on the hero, checks exactly one laptop candidate, checks the unused font is absent and verifies immutable headers. Existing homepage entry tests cover new/returning founders, keyboard, reduced motion and phone/tablet/desktop layouts.

Full validation and release status are recorded in the landing handoff and PR. Encoding settings, byte counts and source/output hashes are in `public/landing-assets/optimized/manifest.json` and its README.
