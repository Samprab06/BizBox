# Café location story — local review

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
