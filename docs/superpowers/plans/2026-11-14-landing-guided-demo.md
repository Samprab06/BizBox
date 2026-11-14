# BizBox Guided Landing Demo Implementation Plan

> **For agentic workers:** Use the existing bounded frontend specialist for presentation; manager owns prepared experiment data, asset authoring, integration and verification. Akshar explicitly requested implementation in this session.

**Goal:** Deliver the complete liquid-glass landing demo with 6–8 second onboarding, location/property/interior and staffed-counter experiment.

**Architecture:** Add a standalone Next.js `/landing-demo` route using prepared GPT scenes and a prerendered sourced MacBook. No live Vexcel, Matterport or agent requests in demo playback. Existing product and earlier prototypes remain intact.

**Tech Stack:** Existing React/Next.js, CSS modules, existing deterministic simulation helpers; Blender MCP and built-in GPT Image at authoring time. No dependency additions.

**Spec:** docs/superpowers/specs/2026-11-14-landing-guided-demo-design.md

## Global Constraints

- Onboarding is 6–8 seconds, preconfigured and readable.
- Visible refraction/rims/reflections across glass UI; fallback and reduced motion.
- Generated scenes are illustrative example content, not real listings or Matterport footage.
- One prepared same-demand comparison; no invented numerical results or live paid calls.
- Preserve previous assets/routes; local only, no push/merge/deploy.

## Review Focus

- Fast scroll and reverse seeking must not leave headings or scenes missing.
- Reduced motion must expose equivalent content without forced autoplay.
- Phone composition must retain legible UI and accessible navigation/controls.
- Asset loading must have a coherent visible fallback and never reveal a blank screen.
- Experiment selection must change both visual state and the matching actual metrics.

### Task 1: Prepared scenes and experiment contract — manager

**Files:** `public/landing-assets/guided-demo/*`, `design/landing/guided-demo/*`, `components/landing-demo/demo-data.ts`, `demo-data.test.ts`.
**Produces:** typed `DEMO` export: business {name,category,concept,city,area,rentLimit,buildout,staff,hours}, property {name,area,rent,size,note}, experiment {current,proposed}, source. Each experiment setup: {label,stations,staff,served,walkaways,p90WaitMin,revenueUsd,laborUsd,contributionUsd}. All values from a shared seeded same-demand existing engine path; precise metric definitions documented.

- [ ] Generate map/interior/overhead GPT scenes and prerender sourced MacBook with transparent screen; save prompts/provenance.
- [ ] Write comparison invariants tests, observe failure, then implement prepared fixture using existing engine; verify deterministic provenance and cost.

### Task 2: Complete landing — frontend specialist

**Files:** `components/landing-demo/landing-demo.tsx`, `landing-demo.module.css`, `timeline.ts`, `timeline.test.ts`, `app/landing-demo/page.tsx`.
**Consumes:** DEMO contract and asset names from Task 1. MacBook manifest gives normalized screen quad for source image; use its quadrilateral mapping or equivalent flattened screen alignment.

- [ ] Implement/test pure reversible chapter selection, onboarding timing 7000ms, reduced-motion endpoints and seek/replay.
- [ ] Build glass navbar, calmer hero/headline and MacBook with initial onboarding UI.
- [ ] Implement complete guided onboarding, location, property, interior, comparison and return, with real DOM controls/text over generated scenes.
- [ ] Provide pause/replay/skip for bounded onboarding animation; same comparison state survives closing return. CTA uses existing supported product entry route.
- [ ] Verify phone/desktop layouts, keyboard controls, asset fallback, no live provider requests and no idle animation loop after demo settles.

### Task 3: Integration and delivery — manager

- [ ] Serve the new Next route through the existing local preview entry while preserving `/story/v1` for the earlier prototype; do not replace homepage.
- [ ] Browser review every chapter, rapid/reverse seeks, 390px phone, reduced motion, actual refraction treatment and comparison metrics.
- [ ] Run pnpm lint/typecheck/test/build plus environment/client bundle checks, review diff and resolve material issues.
- [ ] Update ticket/handoff with exact commits, assets, limitations and run instructions. Local commits only.
