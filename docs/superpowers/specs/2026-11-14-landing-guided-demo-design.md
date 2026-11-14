# BizBox guided landing demo — design draft

Status: implementation authorized by Akshar on November 14, 2026. Keep onboarding at 6–8 seconds per the latest correction. Use the proposed overhead staffed-counter comparison for this revision.

## Intent and agreed direction

The landing demonstrates the complete business workflow through one preconfigured Houston cafe example. Akshar wants a quick animated onboarding sequence, the MacBook initially showing onboarding, then “Understand your business”, “Find a location”, property details, interior and a decision simulation. The landing must feel like a complete website, with an upper liquid-glass navbar, deliberate typography and smooth motion. Existing prototypes/assets remain available.

Use generated visual mockups for this landing demo. Remove the live Vexcel embed from this revision's playback path; the actual product remains separate and interactive. Exact final UI parity comes after the product UI is settled. No live onboarding submissions, paid agent calls or changes to a visitor's saved product session occur during the presentation.

## Approaches

Previously discussed: live product embed (real but loading/rendering competes with landing motion); flat generated screenshots throughout (controlled but limited text clarity/interaction); curated demo with generated imagery and animated UI overlays (recommended and accepted direction). GPT Image supplies visual scenes/screen mockups. Text and controls that animate may be DOM overlays for sharpness, while matching the real interface. This is a bounded illustrative example, not claimed live listing/simulation output.

## Proposed sequence

1. Hero: Houston sunset, fixed glass navbar, centered MacBook initially showing the real onboarding design's first question. Proposed hero copy remains “Test your business / before you commit.” Use deliberate line breaks. Header: BizBox, demo navigation and Open BizBox. Avoid an extra hero button.
2. Understand your business: enter the display as its preconfigured answers animate. Show category/concept, Houston and budget, then the completed brief. Reuse the actual question wording and control design; compress the eleven existing questions into readable beats rather than requiring the visitor to complete a form. Remaining details are prefilled and appear in review. Akshar clarified that this must be rapidly quick but understandable: target 6–8 seconds for the prefilled montage, with business/city/budget readable as three visual beats and a brief completed-summary hold. Avoid long character-by-character typing; judge exact timing in a motion preview.
3. Find a location: generated oblique 3D-style Houston map with two example candidates and the existing assistant design. Candidate selection reveals the property details before moving inside. Preserve one chosen example space through subsequent scenes.
4. Explore the space: consistent interior imagery for that example cafe, with a restrained camera move and a pause at its service area. If this revision uses generated interior imagery, identify it as an illustrative demo. Do not call it Matterport or represent it as a real walkthrough. Real matched Matterport footage remains a separate source-readiness dependency.
5. Test a decision: proposed treatment below.
6. Return: zoom back out to the same MacBook, retaining the final comparison screen. “Test your business idea.” and Open BizBox. Final CTA uses the canonical product entry flow when integrated with current main.

## Decision scene

A single concrete question: “What if I add a second staffed counter?” Start with one active counter and a morning queue. Transition from the interior to an angled overhead view of the same cafe so service points, customers and their paths are legible. The consultant introduces the change; a second staffed counter activates; customers split between service points. Show the queue effect beside the added staffing cost. The story is a tradeoff, not an automatic claim that adding staff increases profit.

Scroll plays the first comparison in order. A small One counter / Two counters control can replay it afterward. Keep floor geometry, camera and demand consistent between states. Customer movement is a deterministic animation over one stable generated scene, not independent generated frames morphing unpredictably. Any numerical results must come from a validated existing example run; otherwise show a clearly illustrative qualitative comparison, not invented predictions. Exact camera treatment is the next design decision.

## Builder-owned details and constraints

- One progress/stage contract; no competing autoplay clocks. Onboarding can have a short bounded play sequence at a stable chapter boundary, with skip/replay and a static reduced-motion version.
- Calm background and short readable headings. Akshar requests a consistent liquid-glass system across navbar, onboarding, assistant, property controls and results: visible refracted backdrop, beveled luminous rims and soft reflections, rather than blur alone. Keep scenes visible around these surfaces. Prototype the glass treatment early and verify motion smoothness before applying it throughout; avoid stacking expensive full-viewport effects.
- Preserve the sourced MacBook and attribution. Evaluate prerendered laptop entry/return versus its existing lightweight runtime only after the visual storyboard is settled; do not promise that asset substitution alone fixes all jank.
- Generated map/interior must read as illustrative example content. No fabricated provider captures or real-property claims.
- No new dependencies, hosted services, push, merge or deployment authorized by this design draft.
- Verify perceived motion smoothness, loading fallbacks, phone composition and typography as well as functional checks. The previous passing tests did not establish visual quality.

## Existing experiment context checked

`lib/sim/experiment.ts` supports seeded pure preview changes to planned stations, staff headcount, average ticket, operating hours and demand multiplier. `components/simulator/demo.tsx` already frames a second staffed station comparison with actual replay/economic outcomes. The landing should reuse a prepared result from that path, not invent output or create a second simulation engine. `lib/insights/station-experiment-fixture.ts` contains separate aggregate examples, including 2-to-4 station variants; those values must not be relabeled as a 1-to-2 counter result. Capacity and staff headcount are separately modeled, so this story must explicitly change both and include the staffing cost. The existing curated narration may describe this prepared example without pretending it is a live agent response.

## Next

Implement the accepted guided demo with the overhead comparison, keeping the older prototype and product routes intact. Verify the complete visible journey and smoothness in a browser.

## Subsequent visual revision — implementation approved

Akshar identified the specific existing client background: `public/onboarding/houston-real.jpg`, the blue-hour Houston skyline with the Ferris wheel. Inspected and confirmed against the client asset/manifest. Use it inside the MacBook/onboarding, replacing the repeated generated sunset there; retain the existing photograph/source credit. This supersedes the proposed plain dark screen background. Outer hero background is a separate surface.

The MacBook must fill the viewport completely before “Understand your business” reveals and the onboarding clock starts. The current `progress >= 0.2` start is too early because camera entry ends at 0.22; correct this in the next motion revision. Keep the montage at 6–8 seconds (target 7), with clear business/category, concept, Houston, budget, staffing and completed-brief beats. Preserve one anchored glass panel and a stable content area; use short outgoing/incoming crossfades and small vertical motion rather than abrupt content swaps or panel jumps. Headings reveal words at a readable pace. Reduced motion exposes the completed brief.

Other pending requested visual changes from the prior discussion: replace Blender-derived hardware with a photorealistic GPT 2D MacBook asset; replace the cramped headline type with a more open sans serif; reveal each heading word by word; improve the navbar's liquid-glass edge/refraction treatment and simplify its navigation. Preserve old assets. Exterior versus interior experiment scope is still being discussed; do not invent an accepted exterior experiment.

## Consultant and sandbox narrative refinement — implementation approved

Akshar rejected the current location/property beats as visually static and unclear, the side panels as inconsistently structured, the glass as too opaque, and the standalone “Explore the space” framing as making BizBox look like a property-viewing wrapper. The central product story must be consultant + sandbox.

Requested direction:

- Refine the two location/property beats with meaningful visible progression and a closer generated view of the selected location. A changed heading over the same map is insufficient.
- Use concise action/result labels and remove explanatory marketing prose. Actual demo prompts and short consultant findings may remain where they explain the decision.
- Animate rent from 1 to its prepared final value (currently $3,000) as the property comes into focus. Keep units visible and number width stable. Count-up is a supporting cue, not the story itself; reduced motion shows the final amount.
- Replace disconnected floating cards with one consistent product layout: an anchored consultant rail and a concise aligned property/assumptions inspector. Use a shared type hierarchy, spacing and unit formatting.
- Glass must be more translucent, with a clear center, localized lens-like edge refraction, thin bright rims and controlled reflections; the current gray opaque panes and generic noise displacement are not the accepted final visual treatment.

Proposed story for discussion: first beat shows a brief becoming a shortlist through consultant investigation, then the camera selects and approaches one building; second beat establishes that building's facts and turns it into the starting scenario, flowing through a matching exterior/interior into the staffed-counter test. The interior is context for testing business decisions, not a separate property-tour feature. No new exterior experiment or ranked recommendation result is accepted or fabricated by this note; any numerical evidence must retain its prepared-data provenance.

Akshar approved implementing the complete visual/narrative refinement with “ok do this”. Exterior establishes location/context; one interior staffed-counter experiment remains the main decision demo.

Project-wide UI priority update from Akshar (Agent Board, 2026-11-14 23:15:51 UTC): desktop-only for current UI work. Preserve responsive fallback and shared checks; skip phone-specific work/screenshots/QA until he resumes it. The current refinement follows that priority.
