# Café interior simulation implementation plan

> **For agentic workers:** Follow the ticket scope and test-first implementation steps below. The manager integrates and verifies the frontend specialist's work.

**Goal:** Show how one staffed counter versus two changes customer flow in BizBox's modeled café.

**Architecture:** Extend the existing operating replay and its shared playback clock. The existing deterministic engine produces both scenarios; a pure presentation helper derives customer and employee sphere positions and current metrics from those events. Keep stored-run provenance and the existing city integration intact.

**Tech stack:** Next.js, TypeScript, React Three Fiber, Three.js, Vitest, pnpm.

**Spec:** [HAC-104](https://linear.app/hackprinceton/issue/HAC-104/cafe-counter-comparison-with-3d-customer-and-employee-dots), including Akshar's subsequent dots-only and selected-site context clarifications. Akshar explicitly requested implementation after reviewing the flow and branch.

## Constraints and design

- Use the existing blue-customer / purple-employee direction, with role labels and an additional visual distinction for employees. No humanoids or cars in the modeled scene.
- Reuse the same 110 seeded arrivals and service requirements for both fixture plans. A second active service point has a second employee; expose the associated labor and buildout assumptions.
- Keep one clock for both panels and the existing neighborhood. Preserve play, pause, seek, speed and customer inspection; add explicit reset.
- Derive queue, service and departure visuals from replay events. Any short entry/exit path is illustrative, not observed movement or an engine estimate of walking speed.
- Reuse geometries/materials and demand rendering. No new dependencies, service, API, environment variable, shared contract or schema.
- Existing stored weekday/weekend runs are not a paired staffing experiment. Preserve their labels, context and provenance; do not invent employee telemetry or claim identical demand for them.
- First delivery is a labeled modeled interior with toy demand. Matterport access/viewer work remains HAC-14/96/97, general editing HAC-87, and full city camera transitions HAC-99.

## Review focus

1. Seeking backward must remove later events and reproduce earlier counts/positions.
2. Closed, empty and zero-station runs must not create fictional customers or employees.
3. Queue and service sphere counts must equal replay state; recent departure dots must not count as people inside.
4. WebGL failure must leave controls, counts and inspection available.
5. Mobile controls and side-by-side scenarios must remain readable without horizontal page overflow.

## Task 1: Deterministic interior presentation and tests

**Files:** `components/simulator/fixture.ts`, new `components/simulator/interior-state.ts` and colocated tests (names may follow the existing implementation conventions).

- [x] Write failing tests for identical paired workload/service requirements, staffing counts, replay counts, departures and backward seek.
- [x] Run targeted Vitest and confirm the new behavior is absent.
- [x] Expose only the fixture metadata needed for presentation and implement a pure replay-derived interior frame, retaining the existing engine outputs.
- [x] Rerun targeted tests and inspect stored-run compatibility.

## Task 2: Interior dots and comparison controls

**Files:** `components/simulator/scene.tsx`, `components/simulator/demo.tsx`, focused helper components if needed.

- [x] Replace capsules with shared low-poly spheres, add distinguishable employee dots, remove modeled cars, and render a usable entrance/queue/counter/exit arrangement.
- [x] Add the role legend, current busy-counter/wait readouts, staffing/cost assumptions, explicit reset, modeled/toy provenance and accessible inspection.
- [x] Reuse existing clock and selection state for all views. Keep error/fallback behavior usable without 3D.
- [x] Run focused unit/lint/type checks; visually verify customer inspection and playback at desktop, intermediate and mobile widths.

## Task 3: Integration and delivery

**Files:** affected simulator documentation and implementation above.

- [x] Manager reviews the actual diff and confirms that scope, labels and economic assumptions match the ticket.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` against the integrated candidate, plus relevant environment/client guards.
- [x] Record observed browser behavior and remaining Matterport/city-transition limitations in durable simulator documentation.
- [x] Commit only this ticket's files on `codex/hac-104-interior-simulation`. Preserve other branches, configuration and data.

No merge or deployment is included. Remote delivery follows Akshar's applicable approval instructions.

## Verification result

- Required lint, typecheck, production build and environment/client guards passed.
- Full Vitest suite: 564 passed, 15 existing gated skips.
- Production browser checks: 9 passed across Chromium, WebKit and mobile Chrome.
- Visual review confirmed purple employees are visible in default and focused framing; a closing-time regression was reproduced and fixed before final checks.
- Manager reviewed the scoped diff and React boundaries. No API, schema, environment, dependency or neighborhood changes. No merge or deployment.
