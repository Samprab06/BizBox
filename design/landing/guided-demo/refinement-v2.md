# Consultant and sandbox landing refinement — HAC-117

Akshar approved this revision with “ok do this” after rejecting the static property-tour framing and opaque glass. The current `/landing-demo` now follows a consultant brief into a shortlist, selected building, starting assumptions and staffed-counter sandbox. This is the current handoff; the earlier README verification describes the first curated revision.

## Hero brand, navigation and continuous entry

Akshar resumed screen-by-screen hero refinement after draft PR139: replace old branding, simplify the Sandbox/OpenBizBox header controls, and make MacBook entry one natural motion. This hero refinement is now integrated on top of the PR139 readiness checkpoint; later ten-screen design mockups remain separate.

- Uses the canonical BrandLogo component and both light/dark artwork copied unchanged from current main's branding implementation (source commit `b5d0dd9`). Header and first onboarding question use the same actual mark; no new logo artwork was generated.
- Header has quiet How it works, Locations and Test a decision links. Phones show How it works; the top OpenBizBox CTA is removed. Closing CTA remains in its existing beat. Mobile-preview instructions no longer refer to a Sandbox header button.
- New pure `cameraAt(viewport,macbook,entry)` contract keeps the display aligned with uniformly scaled hardware while visible and continuously fits the aperture after the hardware fades. Radius/notch removal use the same progress. No entry===1 aspect-ratio snap.
- One persistent onboarding DOM card changes bounds, spacing and typography continuously from the laptop aperture to its final viewport position. No magnified preview card is replaced by a smaller native card. The card remains inert until full entry; Understand your business appears only then. The 500ms settle and 7000ms active-time montage are preserved.
- Prepared answers remain visible during reverse entry, including return to the hero. Replay explicitly resets. Initial tiles fit portrait and landscape laptop apertures; final small-landscape spacing keeps all four answer tiles visible with 40px controls. Existing later scenes and selected-result return are unchanged.

Plan: [hero entry refinement](../../../docs/superpowers/plans/2026-11-14-landing-hero-entry-refinement.md). Browser reproduced the old end-boundary panel jump (about 1305×747 → 520×430). New desktop near-end and full-end samples both use screen 1440×900 and card 520×430 at the same position, with the exact same DOM node throughout forward/reverse seeks. Fresh pre-entry samples retain elapsed 0, no Understand heading and inert controls; full entry still starts with elapsed 0.

Browser layout checks cover 1440×900, 390×844, 375×667, 844×390 and 667×375. Both first and final landscape categories fit without clipping after adjusting compact spacing. These are Chromium-emulation/layout checks, not a physical-device FPS benchmark.

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

## Direct interactive mobile preview

The explicit preview entry is `/landing-demo/mobile`. On a desktop it renders the live `/landing-demo` route in a390×844 same-origin iframe. Scroll inside the phone and tap Sandbox, then One counter or Two counters. The chat GIF is a recording and has no interactive buttons. The old `/story/v1` remains historical.

Follow-up browser verification reproduced real pointer clicks in the live page and in the phone iframe: Two→One→Two selected proposed/current/proposed, changed2/1/2active checkout markers and corresponding artwork, and showed80/55served,6.8/20.2min P90 and$144/$72labor. Akshar then clarified that numbers switch but the physical room still reads as two counters; the following visual correction addresses that distinction. The phone preview iframe is confined to this review route; the landing experience itself still uses no iframe/provider embed.

## Physical counter layout and Heights details

Akshar clarified that changing only checkout terminals was insufficient. The proposed view now adds a separate freestanding green-tile counter island in the open floor, while current keeps only the original continuous wall-side service counter. Original artwork is preserved. Second staff, station marker and customer path move to the actual island. Scene header states1/2staffed counters; seeded comparison and costs are unchanged. The extra island is illustrative scenario geometry, not an engineered fit-out or real property alteration.

New generated asset: `public/landing-assets/guided-demo/cafe-overhead-two-counters-v3.png`. Built-in GPT Image precise-object edit; exact prompt [prompts-v4.json](prompts-v4.json), dimensions/hash/provenance [assets-v4.json](assets-v4.json). Replaces prior two-terminal artwork only in current demo selection; no assets deleted.

The Heights now uses the same property-facts component as Montrose: example rent$3,400/month,1,350sqft andTheHeights area. These are explicitly illustrative assumptions, not researched listing data. The prepared simulation remains Montrose($3,000/month,1,200sqft); the Heights continuation says“Continue with Montrose” rather than silently running a different property's numbers. The selected map pin receives a visible highlight.

Direct interactive phone preview: `http://127.0.0.1:4195/landing-demo/mobile`; iframe renders actual landing route at390×844. Desktop review route is noindex and has no simulation logic. TapSandbox to test counters; scroll through location stage and tapTheHeights for details. Chat GIFs remain noninteractive recordings.

Final verification of this follow-up: lint/typecheck/production build/environment-file/client-bundle checks pass. Full suite with two workers:1304passed/40skipped;29focused tests pass. Production phone-preview iframe is exactly390×844 with no horizontal overflow. Real clicks selected Heights and rendered$3,400/month,1,350sqft,TheHeights and explicit Montrose continuation; One/Two clicks switched physical wall-only/island artwork and1/2station positions with corresponding55/80served,20.2/6.8min wait and$72/$144labor. Screenshots of complete preview saved in task visualization directory. No push/PR/merge/deployment.

## PR #139 readiness integration

Integrated main `926ab86` into the published PR checkpoint in an isolated checkout. The newer unpublished landing commit in the authoring worktree is deliberately untouched and excluded. Main brings the existing HAC-157 comparison overflow/table-selector fixes. Adopted the two stale scenario-heading assertions from PR #147 / HAC-158: the statistics card displays “One staffed counter” and “Two staffed counters”; simulation and shared-clock assertions are unchanged.

Integrated local validation: lint, typecheck, production build and 1,901 unit tests passed (51 existing skips). All nine previously failing browser cases passed across Chromium, WebKit and mobile Chrome. GitHub CI is the final readiness gate; no merge into main is authorized or performed.

The first integrated GitHub run passed app checks, API, Chromium and WebKit. Mobile Chrome exposed two more test setup regressions: print coverage assumed the narrow consultant sheet was open, and the replay screenshot baseline could precede canvas sizing. The print test now explicitly opens the consultant through the shared fixture; replay uses the existing PR #147 condition-based canvas/scroll settlement. Both original failures were reproduced locally and then passed five repeats each without retries (10/10). No production behavior, retry count or timeout was changed.

A subsequent full run exposed an actual compact-width timeline bug: the shared range input measured zero pixels wide because adjacent controls consumed its flex row. The timeline now requests a shrinking20rem flex basis so adjacent controls wrap while the range stays usable; a regression asserts visible width of at least44px. A global unlayered card min-width rule precludes solving this with an ordinary min-width utility, so the fix is local flex sizing. WebKit also exposed landing reduced-motion state being read before its first frame; the assertion now polls that state. Against the isolated branch's production build, transition and reduced-motion cases passed three repetitions in all three browsers (18/18, no retries). No timeout/retry/CI setting was changed.

Latest-main synchronization: merged `439a0f9` after main incorporated the comparison/workspace and HAC-158 fixes while validation was running. The only merge conflict was equivalent staffed-counter assertion formatting; no behavior was discarded. Fresh integrated lint/typecheck/build passed, with1,961unit tests passing and51existing skips. All seven failure/regression cases passed on the isolated latest production build in Chromium, WebKit and mobile Chrome (19passed,2existing camera-project skips). GitHub CI remains the final gate before ready-for-review status.
Hero follow-up validation: lint/typecheck/build/environment-file/client-bundle checks pass. Full suite with two workers: 1,333 passed, 40 skipped. The landing component suite has 53 passing tests, including camera continuity, physical aperture alignment, initial answer fit, reduced static endpoint and one-panel/retained-state regressions. Production browser confirms one card at both end-boundary samples, unchanged 520×430 card bounds, elapsed 0 before/full entry then completed 7,000ms review, and selected two-counter results (80 / 6.8min / $144) retained on closing. Reduced motion presents one static completed card. Preview is refreshed locally; no new push, PR update, merge or deployment after PR139.
