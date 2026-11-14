# Connected client workspace — HAC-130

The client entry is `/projects/[projectId]/workspace`. This implementation applies the approved dark glass layout to the existing application and controllers. The separate `docs/design-prototypes/consultant-workspace/interactive` prototype is rejected and is not part of the application or this delivery.

## Owner flow

1. Finish the business brief, including plain typed areas to favor or avoid.
2. Browse matching listing cards alongside a bird’s-eye Vexcel scene. Selecting a card preserves the actual site ID in the URL, details, navigation and voice context. Card selection is available now; building picking remains HAC-77.
3. Select two or more locations and explicitly choose **Compare locations**. The existing comparison controller calculates the result. Results distinguish modeled customers/contribution from observed data, report demand provenance and disappear when their selected-location set becomes stale. There is no separate baseline screen or required replay.
4. Open **Interior** for a selected listing. The existing interior registry must return a matching, non-demo scan before a Matterport viewer appears. Parent-building scans are labeled separately from exact-space scans. A floor plan or unavailable state appears otherwise.
5. After a saved comparison includes this site, expand **Indoor experiment · Test service capacity**. The existing station experiment controller compares the current setup with additional stations/staff, preserving its original seeds, service calls and budget confirmation. This is an operations comparison; it does not claim to edit a Matterport model or simulate arbitrary renovations.
6. The consultant stays beside these views. Text and Voice use the same existing conversation and draft. Voice uses the existing `VoicePanel` and reactive orb, with the selected site supplied in voice context.

## Boundaries and remaining tickets

| Surface            | Implemented client connection                                                                   | Remaining dependency / owner                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Listings           | Existing live-comparison inventory; synthetic fallback cards are excluded                       | Actual inventory, data coverage and readiness remain the existing data pipeline owners’ responsibility                                                                                                                                                 |
| Vexcel             | Existing Neighborhood renderer, bird’s-eye camera, illustrative road/demand layers disabled     | HAC-77 / Yasser: building picking and renderer controller. The current proxy hardcodes Houston’s collection; LA needs a verified collection mapping before this client enables its imagery                                                             |
| Consultant / Voice | Existing intake conversation, real voice client/orb, draft continuity                           | HAC-82 business tools are merged; HAC-83 / Sam still owns the full scoped consultant runtime, Jev and relevant Nessie tool dispatch, visual actions and runtime credentials. The current intake assistant is not represented as that completed runtime |
| Location results   | Existing explicit comparison API, ranges, assumptions and per-site demand labels                | Sam’s live Jev validation and data readiness; no observed pedestrian counts are claimed                                                                                                                                                                |
| Interior           | Existing selected-site registry API; matching Matterport iframe or floor-plan/unavailable state | HAC-14 / Sam: provider rights and authorized listing scans. HAC-97 / Yasser: interior result overlays and spatial dispatch. The public café demo is never substituted for an ordinary listing                                                          |
| Indoor experiment  | Existing saved-comparison station experiment controller; founder-facing “Current setup” copy    | HAC-79/84 / Yasser and runtime owners: broader controls, spatial feedback and persisted Keep/Discard flow. No unsupported local Keep success is fabricated                                                                                             |

The client adds no server contract, environment variable, dependency, simulation engine, agent runtime or alternate data store. The two new Neighborhood flags default to the previous behavior for existing consumers. The optional station controller copy flag also preserves existing callers.

## Visual rules

The scoped CSS module defines a 68/32 desktop scene/assistant split, dark translucent surfaces, silver text, periwinkle controls and visible keyboard focus. The scene extends underneath both panes. Tablet/phone stack the scene above the assistant. Blur and opacity stay fixed across view changes; no liquid deformation or blur animation runs. Existing reduced-motion handling for the orb remains intact. Additional project screens are reachable through the compact header menu.

## Verification and limits

Browser coverage includes real-service response shapes with explicitly mocked API responses: listing selection and URL/detail continuity, same chat draft across views/Text/Voice, correct compared IDs, stale results, selected-site Matterport URLs, service failures, keyboard use, accessibility and desktop/tablet/phone layouts. These tests prove client behavior, not provider availability or scan licensing. Vendor assets, microphones and paid model calls were not exercised.

The local preview has no configured team provider credentials. It therefore truthfully shows imagery/listing/assistant unavailability. Live demo readiness still depends on the tickets above.

After locally merging main fe99baf, the delivery source passes lint, typecheck, all 1,364 unit tests (43 gated tests skipped) and production build in an isolated source snapshot. The final integrated Chromium regression has 89 passed and 2 skipped. The build retains an existing recorded-example filesystem-tracing warning outside this change. That snapshot excludes the pre-existing, interrupted untracked `docs/design-prototypes/bizbox-onboarding/simulation-preview.test.ts`, which imports missing files and breaks the workspace-wide test/type checks. That unrelated file is preserved in the working checkout and excluded from this change.
