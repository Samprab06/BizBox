# Consultant and sandbox landing refinement — HAC-117

Akshar approved this revision with “ok do this” after rejecting the static property-tour framing and opaque glass. The current `/landing-demo` now follows a consultant brief into a shortlist, selected building, starting assumptions and staffed-counter sandbox. This is the current handoff; the earlier README verification describes the first curated revision.

## Latest follow-up: mobile and visible checkout count

Akshar subsequently requested a mobile demo and explicitly resumed phone work for this landing. This supersedes the earlier desktop-only restriction for this task.

- Portrait Mac fits96vw. Phone layout keeps consultant, scene, setup switch and results in one column with40–44px main controls.375×667 uses a local content scroller so results, costs and source details remain reachable; landscape retains three columns with scrollable rails. Desktop geometry remains unchanged.
- One-counter selection now shows the new one-terminal GPT edit; two-counter selection shows the preserved original two-terminal room. Both images mount/load ahead of the experiment for immediate switching. Scene loading now has an explicit status instead of leaving customer markers over a blank room while a cold image request finishes.
- The three fixed blue dots were permanently positioned queue decoration. Removed all fixed customer dots: all ten customers now traverse entrance, queue, service and exit paths. Queue progress is slower with one checkout. Purple staff use a person glyph and active checkout markers are numbered; counts agree with artwork and prepared results. Movement remains illustrative rather than individual seeded replay events.
- Pause freezes the SVG clock; reduced motion, hidden document and leaving the experiment stop movement. The closing Mac retains selected art, checkout/staff count and actual modeled metrics, with miniature phone controls hidden in favor of the full-size Sandbox controls.

New asset: `public/landing-assets/guided-demo/cafe-overhead-one-counter-v2.png` (1585×992), built-in GPT Image precise-object edit of preserved `cafe-overhead-v1.png`. Exact prompt: [prompts-v3.json](prompts-v3.json); source/dimensions/hash: [assets-v3.json](assets-v3.json). No new service or runtime image generation.

Verification: lint, typecheck, production build and env/client-bundle checks pass. Full suite with `--maxWorkers=2`:1303 passed/40 skipped. Seven new regression cases cover1/2 visible staffed stations, motion attached to every customer, selected artwork through closing and media integrity. Chromium emulation checked390×844,375×667,844×390 and1440×900. All10customer positions changed under natural playback; pause kept the clock identical; reduced motion paused it;375 local scroll reached all results; closing retained proposed80served/6.8min/$144 with2visible station markers. These are browser-emulation checks, not physical iPhone or Safari verification.

Implementation plan: [mobile counter demo](../../../docs/superpowers/plans/2026-11-14-landing-mobile-counter-demo.md). Current local preview remains `http://127.0.0.1:4195/landing-demo`. No push, new remote PR, merge or deployment.

## Visible changes

- New independent GPT 2D MacBook cutout. No Blender-derived hardware or WebGL renderer in the current landing; earlier assets and the old `/story/v1` prototype remain intact. DOM is above the generated opaque screen, with measured aperture/notch clipping.
- Real client Houston Ferris-wheel background inside the MacBook/onboarding. Existing photo/source manifest retained; quiet Credits link includes the photograph, generated scenes and font license.
- Local variable Geist font, normal spacing and restrained 120ms word stagger / 180ms clipped entrance for hero and chapter headings. Simplified navbar links; bottom segmented chapter pill removed.
- Full screen entry completes before “Understand your business” appears. A 500ms heading settle precedes the 7000ms active-time montage. Questions crossfade in one fixed panel; pause/replay/skip and reduced motion remain.
- “Compare locations.” visibly pushes and pans toward the selected lower-right example building. New matching closer aerial and street exterior then lead into the existing matching café interior under “Test this location.” The interior establishes the starting scenario, rather than a separate tour feature.
- Anchored consultant rail, central sandbox and aligned assumptions/results inspector. Concise actual example brief/findings replace narration paragraphs. Rent counts from $1 to the prepared $3,000 over 700 ms, with fixed units/tabular numerals and a clean restart on reentry.
- Clearer 10% tint, verified 5px backdrop blur, deterministic lens-edge displacement, thin luminous rims and restrained reflections. SVG turbulence removed. Inline blur is intentional to survive the existing CSS pipeline.
- The unchanged actual seeded experiment still supplies customer/wait/labor results and buildout tradeoff. Chosen setup and metrics remain visible in the closing MacBook. Decorative customer paths remain qualified as illustrative.

## Media, type and provenance

Exact new prompts: [prompts-v2.json](prompts-v2.json). Recorded native dimensions/bytes/hashes and original outputs: [assets-v2.json](assets-v2.json). Built-in GPT Image was used, with no CLI/API fallback.

- [Generated 2D MacBook](../../../public/landing-assets/guided-demo/macbook-gpt-v3.png),1513×1040; [aperture manifest](../../../public/landing-assets/guided-demo/macbook-gpt-v3.json).
- [Closer example location](../../../public/landing-assets/guided-demo/location-close-v2.png),1586×992, derived from the existing illustrative map.
- [Matching street exterior](../../../public/landing-assets/guided-demo/cafe-exterior-v2.png),1586×992, referenced against the closer building and existing green-tile/walnut interior.
- [Local Geist font/license record](../../../public/fonts/README.md). No new dependency or runtime font service.

All property/geographic/interior visuals and rent assumptions are illustrative example content. No researched listing, real traffic forecast, matched Matterport scan or live agent response is claimed. Exact final product UI parity remains deferred by Akshar.

## Verification

- Lint, typecheck, production build, environment-file and client-bundle checks passed.
- Full suite: 1296 passed / 40 skipped with `pnpm test --maxWorkers=2` (151 passing files, 11 skipped). The default parallel run hit an existing 5-second comparison-handler test timeout. Its 13 tests passed in isolation, and the complete two-worker suite passed unchanged; no backend logic or timeout setting was edited.
  - 21 focused tests cover timeline/entry readiness, 7000ms montage, location progression, reduced-motion exterior zoom, 700ms count endpoints/first paint/reentry, prepared metrics and media/font integrity.
- Independent read-only review found exterior scroll zoom continued under reduced motion. Moved zoom into the pure frame contract with a static reduced endpoint, added a regression test, and verified both visible exterior samples produce identity transforms in browser.
- Desktop Chromium: 1512×982, 1440×900 and 1280×768; no horizontal overflow. No phone-specific implementation/polish/screenshots/QA in this pass, following Akshar's project-wide desktop-only instruction. Existing responsive fallback/shared checks retained.
- Browser verified entry 0.99979 still has elapsed 0 and no onboarding heading; native full screen bounds 0, 0, 1512, 982; complete montage, pause retaining elapsed 320 ms, resume/skip, forward/reverse seeks, actual local font and 5px blur.
- Browser MutationObserver captured rent starting at 1, increasing monotonically and ending at 3000. Both new building/exterior images load. Missing exterior displays the fallback while retaining navigation.
- Experiment/closing retained proposed metrics 80 served / 6.8 min P90 / $144 labor, SVG flow paused after return, no iframe/canvas/provider/API requests. Production landing, intake entry, legacy route and credits returned 200.

The authoring browser's animation-frame throttling is not a device FPS benchmark. No universal frame-rate claim is made.

## Integration and review

Local branch `codex/hac-115-macbook-assets`. Prepared asset checkpoint `e0fa769`; subsequent presentation commit contains this completed refinement. `/story` on the local authoring server redirects to the current normal Next route at `http://127.0.0.1:4195/landing-demo`; `/story/v1` preserves the previous live camera prototype. Homepage/general product APIs and stores are unchanged. Reconcile newer main's canonical `/start` entry/session behavior during future integration. No new push, remote PR, merge or deployment performed.
