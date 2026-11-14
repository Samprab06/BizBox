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
