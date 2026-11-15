# Landing Location Story Implementation Plan

> **For agentic workers:** execute the approved local review scope with bounded frontend ownership and manager-owned prepared data/integration.

**Goal:** Make the café location and counter decisions understandable in the existing landing design.

**Architecture:** Add `/landing-story` using existing glass, typography, camera and onboarding components. Server-prepared deterministic location results feed an isolated story renderer; reuse the existing balanced Vexcel renderer for outdoor scenes. Preserve `/landing-demo`.

**Tech Stack:** Existing Next.js, TypeScript, React, Cesium, Vitest and CSS modules.

**Spec:** `docs/superpowers/specs/2026-11-14-landing-location-story.md`.

## Global Constraints

- Existing design and runtime dependencies; no new services, secrets, backend contracts, push or deploy.
- Inputs illustrative, results computed; same four-hour horizon; generated interiors never called Matterport.
- Native readable controls, keyboard/reverse/mobile/reduced motion; no idle render loop.

## Review Focus

- Rapid forward/reverse: deterministic chapter and node continuity.
- Provider unavailable: honest fallback, no blank page or invented aerial.
- Hidden/reduced: timers and map movement stop.
- Analytics: values, recommendation and units agree with engine output and assumptions.
- Narrow screen: cards/prompts/results remain readable and reachable.

### Task 1: Prepared location comparison (manager)

Files: `components/landing-story/location-data.ts`, `location-data.test.ts`.

- [x] Add tests for deterministic same-seed runs, shared café config, separate site inputs, correct same-horizon costs and recommendation.
- [x] Implement `createLocationStory()` using existing engine and economics; export `LocationStoryData`.
- [x] Verify engine result and cost arithmetic; no client-side engine import.

### Task 2: Story UI and route (frontend)

Files: `components/landing-story/` except manager data files; `app/landing-story/`.

- [x] Add tested pure chapter mapping and motion gates.
- [x] Implement eleven beats using existing assets/components/design and lazy actual Vexcel map.
- [x] Results consume `LocationStoryData`; consultant is separate. Preserve current counter fixture in split view and closing.
- [x] Check focused tests/type/lint and provide manager evidence and limitations.

### Task 3: Integration and verification (manager)

- [x] Review changes for scope, provenance, performance, accessibility and React boundaries.
- [x] Run lint, typecheck, full unit suite and build; browser desktop/mobile, map/fallback, reverse, reduced motion, consultant speech and split results.
- [x] Update design handoff and show local preview. No push or deployment.
