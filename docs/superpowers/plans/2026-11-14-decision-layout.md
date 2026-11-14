# Decision layout implementation plan

> **For agentic workers:** Execute this bounded frontend plan in the assigned worktree. The manager owns review and integration.

**Goal:** Put the saved comparison's qualified decision and next action before setup.

**Architecture:** Reuse Sitework Card/evidence primitives. A presentational header accepts decision, supplied answer, qualification, optional scene and action. Existing controllers keep ownership of requests and saved identity.

**Tech stack:** Existing Next.js, React, Tailwind, Vitest and Playwright; no dependencies added.

**Spec:** HAC-71 and the manager-approved bounded comparison portion; `docs/design-system.md`.

## Constraints and decisions

- Own header, comparison mounts, focused frontend tests and related docs only.
- Use the actual HAC-62 headline and most-influential assumption; never invent a sales forecast or flip threshold.
- Focus the sensitivity control without sending a request. Preserve candidate selection, stale warnings, retry and existing ranges.
- Reuse an optional scene slot; DS-4/simulator and HAC-69 shell edits are owned elsewhere.
- This is a coherent partial implementation. Full HAC-71 acceptance remains pending real scene integration and another complete-composition viewport check.

## Approaches

The manager approved a small presentational header and bounded mounts. A replay embed would add automatic run reads and cross another owner's surface; a shell redesign would overlap HAC-69. Neither belongs in this portion.

## Review focus

- Historical results without robustness must identify that gap.
- Stale/busy results must identify the saved answer's state.
- Unknown influential assumptions must lead to evidence.
- Long addresses must wrap at 375 px without hiding qualifiers.
- Keyboard activation must focus the correct control without a model call.

## Task 1: Shared header and comparison integration

- [x] Add `components/decision/decision-header.tsx` and its SSR reading-order test.
- [x] Mount before live setup; preserve HAC-62 address naming, model disagreement and supporting information.
- [x] Lift sensitivity selection and focus ref; add matching action and honest missing/stale states.
- [x] Use the header for the labelled synthetic example and its visit-frequency anchor.
- [x] Add `tests/e2e/decision-layout.spec.ts` for focus, request guard, reading order, missing robustness and stale state.
- [x] Run lint, typecheck, full Vitest suite, build, existing comparison E2E and new browser tests. Record actual viewport limitations.
- [x] Update design-system and live-comparison docs with boundaries and dependent work.
- [ ] Return the completion packet to the manager for diff review; no push, merge or deploy.

## Verification and remaining acceptance

- Lint, typecheck and production build passed. Final full Vitest run with `pnpm test --maxWorkers=2`: 660 passed, 19 skipped. Initial high-contention runs hit the existing 5-second backend comparison-handler timeout; no backend or timeout settings changed.
- All 54 targeted browser tests passed across Chromium, WebKit and mobile Chrome, with screenshots visually inspected. Existing comparison tests preserve ranges, provenance, saved identity, ties, explicit requests, sensitivity retries and the no-single-sales-forecast guard.
- The 375×800 CTA initially ended at y851; a real viewport test failed. Retaining visible model disagreement and consolidating supporting details into **Decision evidence** moved it to y747–787 without shell edits. The corrected viewport test is an ordinary passing assertion, not an expected failure.
- The desktop test requires the entire decision, answer and action to be within 1280×800. Mobile checks enforce no horizontal overflow and a complete CTA within 375×800. Keyboard tests open supporting evidence and focus matching sensitivity without a POST; axe scans include expanded evidence and reduced motion.
- These bounds cover the tested two-site live comparison with evidence closed. Longer addresses/tied-site lists, stale warnings and expanded evidence naturally grow; qualifications are never clipped. The real scene slot and simulator mount remain unimplemented dependencies. Keep HAC-71 in development.
