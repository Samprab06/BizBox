# Consultant workspace: approved layout direction

Akshar approved the generated layout direction on November 14, 2026:
“the actual map stuff will be the vexcel and matterport apis” and the UI must become functional through the existing implementation tickets.

These are GPT Image design references with illustrative data, not screenshots of working features.
These images do not implement production behavior. Images are saved alongside this file; exact generation prompts are in prompts.json. The separate typed-area follow-up changes only the existing onboarding input.

## Screen checkpoints

- [1 · Arriving after onboarding](01-arrival.png)
- [2 · Selecting a space](02-selected-space.png)
- [3 · Understanding the interior](03-interior.png)
- [4 · Setting up an experiment](04-experiment.png)
- [5 · Watching the simulation](05-running.png)
- [6 · Comparing baseline and alternative](06-compare.png)
- [7 · Keeping the decision](07-kept.png)
- [8 · Switching to Voice](08-voice.png)

## Functional handoff

Use one canonical workspace route `/projects/[id]/workspace`, reusing HAC-128's existing shell/Text/Voice implementation rather than building another chat store.
HAC-128's initial shell is merged: preserve its work; remaining visualization integration belongs to HAC-84/77/97/88.

Desktop: approximately 68% visualization, 32% persistent consultant. Dark translucent glass, readable contrast, periwinkle accent; no green or ornamental motion. Ratios are visual direction, not a requirement to break responsive behavior.

- Vexcel powers the actual geographic 3D neighborhood in the left viewport. Generated scenery/photos are design-only and cannot satisfy geographic-map acceptance.
- Matterport displays available matched interiors. Viewer availability, access and identity must be checked. A labeled modeled/floorplan fallback remains usable if no matched scan exists.
- Matterport imagery is a scene source, not proof that simulation overlays can be drawn arbitrarily into its SDK. HAC-97 must document the supported overlay/rendering approach and the fallback while preserving this split layout.
- Simulation customer positions, queues, stations and metrics come from canonical engine events; neither Vexcel nor Matterport creates those business results. Station addition in these images illustrates a scenario-capacity change, not a promise to remodel a Matterport scan. Arbitrary physical layout editing remains later HAC-87.
- Select a space, open its details/interior, propose changes, explicitly Run, play/pause/seek, compare Baseline/Alternative, Keep/Revert; same consultant beside every view.
- One project/site/scenario/run/day/minute/customer context, one playback clock, one thread. Text/Voice switches keep draft/history/proposals and use the same typed action.
- Existing tools and Nessie integration are reused. No generated example numbers or scripted mockup messages are displayed as server-confirmed output.

## Acceptance ownership

| Ticket | Responsibility |
|---|---|
| HAC-128 (Sam, merged) | Reusable canonical shell, real Text/Voice adapter and conversation |
| HAC-83 / HAC-82 (Sam) | Shared context/events, consultant runtime and tool/service adapters |
| HAC-84 / HAC-85 (Yasser) | Apply visual shell, contextual cards and selection/shortlist interactions |
| HAC-77 / HAC-97 (Yasser) | Actual Vexcel city and supported Matterport/fallback interior renderer |
| HAC-88 / HAC-79 (Yasser) | Client visual-action dispatch and manual experiment controls |
| HAC-100 (Yasser) | Renderer/seek/responsive/accessibility validation |
| HAC-92 (Sam) | Connected functional journey and persistence acceptance |

A task passing in isolation is insufficient: HAC-92 verifies the complete journey on this canonical route with real renderer mounting and shared service/context wiring. Scripted fixtures may test deterministically, but actual renderer/provider readiness must be reported separately. No paid call or production mutation is approved by these images.

## Visual limitations

Generated screenshots vary slightly in camera, panel spacing and illustrative geometry. The written contract above controls consistent implementation; the images do not define API schemas, exact metrics or measured property geometry.

## Subsequent UI direction

Akshar requested the existing reactive voice orb instead of the generated waveform. Reuse `components/voice/gradient-orb.tsx` (MIT, Goldie contributors) as the visual source; the local clickable study previews state/energy without microphone or model calls. Production keeps its existing VoiceAdapter and actual audio-level input. The clickable prototype is tracked under HAC-130, separately from Frank's active HAC-129 production integration.

The onboarding question “Which areas should we favor or avoid?” uses plain typed text, without neighborhood chips, preset picks or suggested answers. Existing typed values remain editable and use the same intake save path.
