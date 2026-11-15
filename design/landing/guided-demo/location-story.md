# Café location story

**Current release:** Akshar requested the newest refinement as the homepage at `/`. It shares the story component with `/landing-story`; older demo/static routes remain available. Open BizBox now uses `/start` so each founder creates or resumes their own project. PR139 is the earlier merged checkpoint; the refinement below supersedes its visual presentation.

Akshar approved implementation after the ten-screen discussion, then changed the consultant to its own screen after analytics: a speech bubble appears before the response text. Existing design is required. Review route: `/landing-story`. The pushed `/landing-demo` implementation remains unchanged.

## Implemented experience

The new route reuses canonical BrandLogo, local Geist, Houston backdrop, Glass/refraction/WordHeading, cameraAt and the persistent OnboardingScene. Full entry and 500ms settle precede the seven-second business montage. A story-only business description explains coffee/breakfast, commuters/residents and seating/takeaway; initial setup is $9,000 to match the prepared model.

Eleven scroll beats: hero, business understanding, location question, two properties, modeled morning, analytics, consultant speech, interior entry, counter question, split comparison, selected-result MacBook return. Chapter navigation/keyboard uses a fully entered onboarding target. Resize/orientation preserves normalized progress; reverse seeks remain available. Pause, replay, hidden-document and reduced-motion gates bound playback. Counter Replay remounts both flows while retaining selection.

The outdoor stage uses the existing balanced Cesium/Vexcel renderer and same-origin `/api/vexcel/3d/tileset`. One viewport mounts only outdoors and while the page is visible. Pins use example neighborhood coordinates. Optional existing-frame projection callbacks position translucent glass cards; safe placement and leaders keep them on screen. Native labels remain the default for other product views. Provider failure retains explicit unavailable status plus readable example facts.

The morning uses recorded five-minute engine checkpoints for arrival/served counts. Visible movement samples follow connected OpenStreetMap road vertices, fetched through the existing public road-tile adapter. Eighteen Montrose and thirty Heights sample dots illustrate relative demand; these are not per-person replay, measured traffic or verified routes to storefront entrances. Geographic-to-screen projection is locally calibrated from the two actual pins for the fixed north-up camera. Transform tweening is disabled so no chords cut across street bends. Source attribution remains visible. A local screenshot was captured at Akshar’s explicit request; no tile assets or map frames were published externally.

Analytics replace the map and show customers served and contribution after included costs. A separate user question/consultant speech screen reveals the prepared explanation. The See inside pointer approaches and presses before the generated interior expands; that same image node persists into the question with a restrained pan. The split shows 55/80 customers served and the extra $72 morning labor / $6,000 setup; wait and detailed definitions remain in Details. The closing MacBook retains the selected setup only.

## Data meaning

Rent, area, neighborhood positions and demand are authored examples, not verified listings or measured traffic. Both runs use the existing queue engine and economics: one staffed counter, $8 ticket, $18/hour, 30% ingredients, 8 AM–noon, 22 repeated mornings/month, $9,000 setup amortized over 36 months. Montrose has 110 assumed arrivals, 55 served, $88.27 contribution; The Heights has 180 assumed arrivals, 58 served, $45.98 contribution, and $4,300/month assumed rent. The $42.29 difference is rounded to $42 in the explanation. These are scenario results, not profit forecasts. Taxes, utilities and other overhead are excluded and disclosed in Details. The unchanged counter fixture uses the same 110-arrival Montrose baseline.

Interiors are the existing generated assets. They are not Matterport scans; no Matterport request or API integration is claimed in this route.

## Verification and local runtime

Fresh lint, typecheck and production build passed. Unit suite: 2,012 passed, 51 existing skips. Environment-file and client-bundle checks passed. Production build retains the pre-existing broad filesystem-tracing warning in recorded-example-loader. Scoped formatting and whitespace checks passed.

Browser checked actual Vexcel loading and projected cards (10% tint, 5px blur); same-morning checkpoints; map-free values; standalone typed speech; identical interior image node before/after expansion and into counter prompt; counter Replay clocks 16.57→0.27 seconds, Pause holding both at 12.243 seconds; selected one-counter/55 result retained on return; reduced motion disabling both flows; no horizontal overflow at 390px/1440px; consultant chapter preserved across resize. An independent focused review confirmed fixes for replay, card placement, empty projections and keyboard onboarding. Card placement tests cover 320/390/1440 and short landscape. These are browser emulation/layout checks, not physical-device FPS claims.

Local review server: `http://127.0.0.1:4198/landing-story`. It inherits only the existing configured local Vexcel key into its process at startup; no env file was created/edited and no credential entered the client. The provider-disabled production build on port4199 was separately checked to show the unavailable message and both property assumptions. That temporary verification server is stopped after QA. Existing mockups on4196 and prior landing on4197 are separate.

Worktree: `pr139-readiness/HackPrinceton`, branch `codex/pr139-readiness`, based on pushed PR139 head `c06b7c7`. This new flow is included in the requested PR checkpoint. Akshar subsequently requested a PR checkpoint of this implementation. That authorizes updating PR139; no merge or deployment is included.

## Map scroll correction

Akshar reported the two-spaces scene felt strange and laggy. Reproduced on the open preview: a wheel gesture over the live map left document scrollY at3192 because Cesium consumed the input. The landing-only CSS now gives the Cesium canvas `pointer-events:none`, letting native wheel/touch target the scroll story instead. DOM glass property cards and provider/source links remain interactive; other product map views are unchanged. Retested the same gesture:3192→3703; reverse returned3192. Clicking The Heights still updated the selected property. All21 story tests and scoped formatting passed. This fixes the demonstrated gesture conflict; it is not a physical-device frame-rate measurement.

## Requested PR checkpoint

Includes a reversible 500ms desktop-style map/results swipe with cleanup, native scheduler binding and reversal tests; aligned results labels; the larger +25 customers / +$72 morning labor / +$6,000 setup strip; visible sourced-road demand samples and the revised clearly illustrative Heights scenario. Source-loading failures remain honest, and map scroll capture remains disabled only in this landing. Current new flow remains at /landing-story; /landing-demo is preserved. Lint, typecheck/build and full suite passed: 2,020 tests, 51 existing skips. A focused review found and corrected straight-line transform interpolation between street samples; opacity alone now transitions. The local screenshot is held in the chat visualization directory, not committed. This is an iterative review checkpoint rather than final visual approval.

## PR139 browser readiness correction

The previous checkpoint failed browser CI because several shared-client tests still expected a permanently docked phone assistant, retired header budget prose and an example-property fallback after real inventory failed. Those tests now use the existing mobile sheet controls, verify the actual submitted rent ceiling in cents and saved founder input, and require unavailable inventory to remain unavailable. Map error assertions follow the current explicit copy while preserving retry, example-label, no-network and no-page-error checks. No skips, retries, timeouts or workflow changes were added.

A genuine 768px workspace navigation overflow was also reproduced: its popup sized itself against the viewport despite being positioned within a narrower header. Its width now follows that header. The existing geometry test fails before the fix and passes afterward.

Fresh lint, typecheck, production build and full unit suite pass (2,020 tests, 51 existing skips). The full WebKit accessibility suite passes all 48 tests; the previous intake contrast result did not reproduce in nine targeted runs or the full suite, so no speculative contrast override was introduced. A separate focused diff review found no actionable issues. Full runs of the four affected browser specs pass across Chromium, WebKit and mobile Chrome: 324 passed, 6 pre-existing browser-specific skips. GitHub CI is the remaining readiness gate.

## Homepage refinement

Compact bundled DM Sans headings replace the oversized light hierarchy. Optional camera settings reduce the desktop hardware and aperture together; default camera behavior remains unchanged for the earlier demo. The story-only seven-second onboarding selects the café, writes the brief, moves rent from $3,500 to $4,500, changes staffing from two to one and confirms the brief after entry settles. Pause preserves the input values; reduced motion shows the final confirmed state.

Each chat starts in a composer, sends a right-aligned user bubble and types a separate BizBox reply. A reversible bounded desktop swipe connects the question, actual Vexcel map and map-free analytics. Property facts appear progressively; comparison bars emphasize the existing engine-backed $88/$46 included-cost result and $42 difference. Counter chat derives its 110-customer/$72 labor/$6,000 setup explanation from server-prepared data. No fixture simulation is imported into the client. Chat clocks stop at their completion.

The consultant reply contains a crisp generated interior preview and See inside control. A separate non-scrolling image layer preserves the same image node as it expands, while the inner chat scroller tracks preview bounds. Browser verification covered 390×667 after 76.5px inner scrolling: zero source-image offset; the same image filled 390×667, rotated to 667×390 and reversed to its slot within 0.18px. Desktop/390px hero, prompt, comparison and counter chat had no horizontal overflow. Paused business setup held at 4,041ms / $4,200, then finished at $4,500 / one staff member. Actual map rendering retained one viewport and 18 Montrose/30 Heights road samples; analytics released the canvas.

Integration preserved newer main changes. The eight add/add conflicts caused by the prior squash merge were resolved only after verifying every upstream conflicted file exactly matched PR139’s 346b1b6 checkpoint; only the subsequent landing refinements were selected. No force push or teammate-file replacement is used.

Final homepage candidate: lint, typecheck and production build pass; full unit suite passes 2,032 tests with 51 existing skips. Environment-file and client-bundle guards pass. Homepage/retained-preview tests pass across Chromium, WebKit and mobile Chrome: 62 passed with one existing WebKit keyboard skip. Chat-first entry and smoke checks pass all 30 cases across those browsers. The chat test now waits for the Send control to become enabled before its next Enter, rather than racing a received request against its still-pending reply. No retries, timeouts or CI gates were weakened. New root tests verify no legacy iframe/script, own-project creation/resume, keyboard entry, phone/tablet/desktop sizing and confirmed reduced-motion onboarding.

## Cold-load follow-up

Akshar reported slow uncached visits after the homepage release. Cold Slow4G/4×CPU tracing found the two CSS JPEG backgrounds completing around9 and15seconds; Cesium was already absent from the initial hero. Responsive hashed WebP pictures now replace only this story’s background layers. The stage selects for the actual laptop aperture and upgrades the same image when expanded. A matched responsive laptop preload avoids duplicate/native-size downloads; unused legacy-font and invisible app-link preloads are removed. Original media, native laptop alpha, artwork, scenario results and actual3D map remain. StoryMap is memoized for unchanged props.

Controlled1365×900/DPR1 production-server samples: initial resource transfer2,459,584→551,234bytes (77.6% less), load event15,026.6→4,590.9ms, FCP1,916→1,820ms. LCP2,106→2,268ms remained in the same low-two-second range; no LCP improvement is claimed. These are throttled lab samples, not field guarantees or physical-device FPS. Full details are in `docs/superpowers/specs/2026-11-15-landing-cold-load.md`; encoding/hashes are in the optimized-asset manifest.

Integrated the next96-file main update without conflicts or replacing teammate code. Fresh lint/typecheck/build/env/clientbundle checks pass; full unit suite2148passed/51existing skips. The homepage, retained legacy preview and cold-budget checks pass across Chromium/WebKit/mobileChrome:71passed/oneexisting WebKit keyboard skip. The new cold test failed against the prior build, then passed with sub750KB initial media, sub350KB scripts, one laptop request, no original JPEG/future-scene/3D hero requests, no unused Geist download and immutable derivative headers. Browser comparison confirmed the same stage image node upgrading1280→1920 on screen entry.
