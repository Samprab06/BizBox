# Consultant mockup implementation plan

> **For agentic workers:** use the project's manager/frontend workflow. Akshar approved the storyboard and explicitly requested implementation. Steps use checkbox syntax.

**Goal:** Make the approved consultant workspace clickable with example data and the existing reactive voice orb, and replace onboarding area suggestions with typed input.

**Architecture:** A standalone design-only HTML/CSS/ES-module prototype under `docs/design-prototypes/consultant-workspace/interactive/`. Reuse existing local Three.js for illustrative 3D scenes and adapt the existing MIT-licensed GradientOrb shader, without live API or microphone access. A separate small production onboarding adjustment uses the existing raw `areas` draft/save path.

**Tech stack:** Existing JavaScript, CSS, HTML and Three.js; existing React/TypeScript for the narrow onboarding edit. No new dependencies.

**Spec:** `docs/design-prototypes/consultant-workspace/storyboard-2026-11-14/README.md`, approved eight images, and Akshar's reactive-orb/plain-typed-area instructions.

## Global constraints

- UI/UX-only consultant prototype. Production backend, stores, contracts and provider calls remain with assigned tickets.
- Use the actual shader in `components/voice/gradient-orb.tsx`; preserve its MIT notice and record the source commit.
- Desktop approximately 68/32 visualization/consultant; responsive layout, keyboard support and reduced-motion/static graphics fallback.
- Explicit example-data/source labels; Vexcel/Matterport production surfaces are not claimed connected.
- Preserve existing onboarding, unrelated changes and interrupted `simulation-preview.test.ts`.
- No push, merge, deploy, paid calls or credentials changes.

## Review focus

- Switching Text/Voice must retain chat, composer draft, selected space and scenario.
- Pause and seek must control one timeline; comparison/Keep/Revert must preserve baseline and current location.
- Hidden tab/reduced motion/WebGL failure must avoid uncontrolled animation and preserve controls.
- Small widths must remain readable and scrollable without horizontal overflow.
- Typed area preferences must preserve the full existing text and unsaved draft when navigating back, without neighborhood suggestions.

### Task 1 — Clickable workspace (frontend ownership)

**Files:** create only `docs/design-prototypes/consultant-workspace/interactive/*`; read storyboard and existing orb source.

**Interface:** one local preview state for stage, location, view, chat mode, draft, scenario and playback minute; no production API interface is introduced. Host from repository root at `/docs/design-prototypes/consultant-workspace/interactive/`.

- [ ] Implement shared dark-glass shell, semantic controls and illustrative 3D city/interior, with usable fallback.
- [ ] Connect selection/details/interior/proposal/Run/playback/comparison/Keep-Revert using deterministic example fixtures; no arbitrary generated outcomes or claims of real results.
- [ ] Adapt orb to demo listening/thinking/speaking/muted states, stop background animation and honor reduced motion.
- [ ] Check syntax and verify complete browser journey at desktop/intermediate/mobile, draft persistence, keyboard, graphics fallback and reduced motion. Save useful screenshots and document local launch/production handoff.

### Task 2 — Plain area text (manager ownership)

**Files:** `components/onboarding/onboarding-flow.tsx`, relevant section of `tests/e2e/onboarding.spec.ts`, `docs/design-prototypes/bizbox-onboarding/app.js` and handoff.

**Interface:** existing `QuestionStep = areas` and `onCommit(key, value)` remain unchanged. Store exactly the user's typed area text through existing drafts.

- [x] Remove neighborhood chip presentation and parsing from the guided UI; use one labeled free-text textarea with neutral placeholder. Preserve existing raw saved values.
- [x] Update the existing journey assertions to type a custom preference, assert suggestions absent, and verify persistence/back navigation.
- [x] Make the standalone reference plain text as well, preserving legacy stored preferences when feasible without adding new UI suggestions.
- [x] Run relevant browser checks and four repository checks; inspect final diff and document any pre-existing failures.

### Task 3 — Delivery (manager ownership)

- [ ] Inspect frontend packet/screenshots and ensure local UI contains no provider calls or second production store.
- [ ] Record current tickets accurately, update HAC-130 and coordinate the onboarding boundary with Frank/HAC-129.
- [ ] Leave a local preview open and give Akshar its URL and verified scope/limitations.
