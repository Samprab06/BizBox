# BizBox landing content and structure — discussion draft

Implementation is paused at Akshar's request. The next step is to agree on this wireframe and the information it communicates before changing the landing prototype further.

This is the earlier content proposal, retained for comparison. The later full-screen walkthrough discussion and unresolved MacBook transition are recorded in [the checkpoint handoff](README.md#latest-discussion--not-implemented). The right-exit instructions below are proposals, not a settled implementation requirement. The simulator figures below describe the separate comparison prototype, not the replay route bundled on main.

## Intent

Explain the product clearly to someone encountering it for the first time. The approved headline is “Test business decisions before committing.” The audience includes people planning a business and owners evaluating operational decisions. The page should explain the inputs, the experience, and the comparison a visitor can make, with a specific café example carrying the demonstration.

Every section needs a clear claim, one short sentence of context if the visual cannot convey it alone, and product evidence. Removing all context made earlier versions ambiguous. Essential product explanation, control labels, provenance, and units earn their space; filler eyebrows, generic badges, repeated slogans, and decorative metrics do not.

## Proposed structure

1. **Explain the product.** The approved headline plus “Explore locations, walk through real spaces, and simulate a business day. Compare your options before you spend.” Centered MacBook shows a concrete decision in the actual workspace. Primary action: Try the demo. On leaving the hero, the MacBook exits to the right; this supersedes the earlier camera-entry request.
2. **Understand the location.** “Find a location that fits your business.” Show the product's map and selected candidate, with rent, size and neighborhood context. Example locations remain labeled as examples rather than live search findings.
3. **Inspect the interior.** “Walk through a real space in Matterport.” Show an actual interactive Matterport viewer, not a Blender café or generated room. A short sentence explains the purpose. For a public demo scan, name it and keep attribution. Do not claim that The Coffee Port is a Houston candidate property.
4. **Understand the simulation.** “See how a business day could play out.” Show customer arrivals, staffing, service, queues, a clock and timeline. The caption says this is modeled activity. A tour alone is not a simulation, and the page must make that distinction understandable.
5. **Compare a concrete change.** “Would a second staffed counter pay off?” Run the same demand in both plans; show service gains alongside additional staffing and included costs. The comparison prototype documents 55 versus 80 served across a four-hour run, 110 generated arrivals, and one added employee at $18/hour. These are illustrative fixture outputs, not real customer observations or a forecast for the displayed scan. Keep evidence/assumptions accessible in place.
6. **Start.** “Test your next business decision.” The same Try the demo action opens the actual example. Starting a personal business question follows in the product; do not promise a separate onboarding flow until its destination is chosen.

## Layout rules

- One centered content axis throughout: heading, short context line, product surface.
- A consistent product-window position/size across the middle sections. No alternating left/right marketing layout.
- City photography remains the surrounding environment. The storefront/interior transition supports context but does not replace a real product view.
- Only the introduction needs hardware. It exits right instead of dominating every chapter.
- The primary demonstration occupies the most space. No feature-card grid, unsupported testimonials, pricing plan, logo wall, or decorative KPI section.
- Keep meaningful section names in navigation so a visitor can understand and jump through the page; unlabeled progress dots alone are insufficient explanation.
- Set animation choreography after this structure is agreed. Snappy controls and liquid-glass treatment are retained design preferences, not substitutes for explaining the product.

## Open decisions for discussion

- Confirm the sequence and whether the location section deserves full prominence for the broader business-decision positioning.
- Confirm one staffed counter versus two as the example that anchors the page.
- Confirm whether Try the demo is the primary action or whether a real Start a business decision entry should become primary once that flow is ready.

The accompanying neutral wireframe is a content proposal. It changes no application, live preview, data, or production state.
