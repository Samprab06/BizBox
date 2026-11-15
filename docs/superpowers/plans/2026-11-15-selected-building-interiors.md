# Selected-building interior experiments implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Preserve the existing checkout and prior work; no push or deployment.

**Goal:** The selected candidate resolves its own interior and shares one furniture/layout experiment between visualization, simulation, FDE and report in either supported city.

**Architecture:** Reuse canonical candidate site IDs and the existing interior resolver. Replace the automatic Coffee Port wrapper with a selected-site stage; retain the public café only as an explicitly separate example. Native room bounds can initialize an approximate rectangular experiment and a metric scan transform, while missing geometry remains an explicit modeled fallback.

**Tech Stack:** Existing Next.js, TypeScript, Zod, seeded spatial engine, Matterport SDK, Vitest and Playwright. No new dependencies. Live café Jev calls are bounded by the user's original $1 aggregate grant.

**Spec:** User's November 15 direction in this chat and `docs/superpowers/specs/2026-11-15-agent-spatial-business-simulation-design.md` sections 4, 8, 12 and 14. User has already directed execution and parallel work; no additional design approval is needed.

## Global constraints

- Never substitute a reference café for the selected candidate's scan.
- Keep SDK application keys distinct from private server tokens.
- The user explicitly authorized read-only automatic viewing of verified public CoStar-linked selected-candidate scans. This does not change registry approval, establish suite identity, or permit private-model unlocks.
- Live Jev calls use only the original $1 aggregate grant. User-approved preview writes are limited to the budget/cache schema, grant and reviewed Gage mappings. No provider generation mutations, purchases, additional hosted approval writes, push or deployment.
- Axis-aligned bounds are an approximate envelope, not complete walkable room geometry. Entrances, service locations, inventory and operating behavior remain explicit assumptions unless supplied.

## Review focus

- Switching buildings during a slow request must never apply the previous building's source or transform.
- An edited or reviewed proposal must not be silently replaced by arriving geometry.
- Property-level scans must not become verified selected-suite dimensions.
- Defurnished view unavailability must not be mistaken for a generated empty scan.
- Playback, reported metrics and final report must come from the current layout's same deterministic experiment.

### Task 1 — Backend selected-model resolution (backend specialist)

Files: `lib/interior/runtime.ts`, resolver/repository/provider tests and `docs/interior-api.md`.

- [x] Test approved/public selected mapping, denied mapping, unavailable database/provider and key/token separation.
- [x] Activate only existing approved mappings through app-owned configuration; fetch geometry read-only and bounded when authorized credentials exist. Do not write a provider cache or approve imported rows implicitly.
- [x] Inspect actual Western/Gage mappings and model accessibility. Use only an isolated local database if setup is available; document precise unavailable inputs.
- [x] Run targeted API/runtime tests.

### Task 2 — Shared preparation/provenance and report (manager)

Files: `lib/interior/prepare-spatial.ts` and tests; `lib/contracts/spatial.ts`, `lib/client/flow-steps.ts`, `components/workspace-screen/interior-experiment-state.ts`, plan snapshot/report and FDE source descriptions.

Interfaces: `spatialScanCalibration(response, draft): InteriorCalibration | null`; `prepareInteriorFlow(current, response): InteriorFlowState`.

- [x] Test two different model coordinate origins, missing/unsupported dimensions, property scope, existing edits and source invalidation.
- [x] Initialize supported 4–30 m room bounds in native meter coordinates; preserve all operational assumptions. Extend room provenance with `matterport-bounds`.
- [x] Store interior source in the scoped flow/report. New geometry invalidates old run/review; repeated source loads are stable; existing edits are preserved.
- [x] Test report snapshots and FDE descriptions preserve selected source without importing reference metrics.

### Task 3 — Generic viewer and experiment (frontend specialist)

Files: new selected-site stage, `matterport-view.tsx`, scoped native spatial scene/defurnish helper and tests; workspace integration and E2E.

- [x] Load the selected site endpoint with request cancellation and full source-scope guards.
- [x] Render the actual selected model or explicit fallback; use current spatial experiment instead of `makeDemo`.
- [x] Display proposed assets and saved customer movement from the same spatial result using shared metric calibration.
- [x] Detect actual provider defurnished views and support view switching when available. Do not invent a generation API or claim a view exists.
- [x] Preserve add/move/rotate/remove/clear, invalidate stale results and require current run/review before final report.
- [x] Test separate buildings/cities, scope races, invalid placement, furniture effects, unavailable views and report consistency.

### Task 4 — Integrated delivery (manager)

- [x] Review source/provenance, request races, shared result paths and server credential boundaries.
- [x] Run targeted suites, lint, typecheck, full bounded Vitest and production build.
- [x] Browser-check selected-site flow, valid fallback, edits/run/review/report and actual SDK view where available.
- [x] Update implementation status with actual verified coverage and remaining account/data gaps. No claim of universal address coverage.

## User steering — live Jev in this same feature

The user's side-chat instruction adds live Jev-backed café decisions before delivery. Initial operating scope is furniture/layout, employee count and a second staffed counter. Keep the generic LA/Houston selected-site pipeline; other category adapters retain explicitly assumed previews until their live behavior is validated.

- [x] Prepare policies server-side through `/api/projects/[projectId]/interior-policies`, after owned-comparison/site/city verification. Customer-visible route, seats, price, staff/capacity and queue/wait observations feed three typed persona states; returned probabilities alter actual join/leave transitions under existing seeded draws.
- [x] Cache semantic requests with model/epoch provenance and signed receipts bound to exact snapshots. Verify receipts before reporting provider-backed results through FDE or finalization. Every layout/operating edit clears stale coverage and results.
- [x] Atomically reserve against the original $1 grant, including historical 26,864 microUSD conservative reservation. Disable hidden retries, deduplicate in-flight work, propagate cancellation, retain failed-attempt reservations and fail closed when persistence/key/grant is unavailable.
- [x] Prepare Drizzle budget/cache schema and grant initialization for an explicitly approved writable development database. No hosted write is implied by code preparation.
- [x] Run one bounded live synthetic baseline/proposal check using the same policy-preparation service and a durable tooling-only ledger. Record actual model, probabilities, decisions, metrics, tokens and aggregate reservation. A CLI-to-DB budget handoff must be one-way and retain the latest aggregate reservation.
- [x] Browser-test controlled provider policies through edit → preparation → run → inspection → report, and verify an unavailable provider never silently substitutes assumed behavior.

## User steering — existing Nessie read-only affordability

Reuse the existing Nessie reader, cash card and projection helpers after current interior review. The scoped endpoint accepts experiment identity/snapshots and optional demo account selection; balances, stored costs and monetary results are server-owned. Preserve operating-day versus monthly units, subtract known upfront buildout once and never add an interior daily delta blindly to exterior monthly estimates. Unknown furniture/equipment prices keep complete affordability/ROI unavailable. Re-read before final report and invalidate on any experiment/source/policy change. No accounts, seeding, payments, provider writes or new banking product are included.

## Current focus — normal onboarding and generalized selected interiors

The judge completes normal onboarding. Do not add a Gage onboarding shortcut or replace the founder's answers with a saved demo profile. Selected-candidate resolution reads available canonical CoStar model attachments in both cities, distinguishes source discovery from approved viewing and measured suite geometry, and keeps furniture/operating experiments in the normal comparison→interior→report flow. Additional hosted registry/display approval writes remain outside the scoped authorization. The user subsequently approved automatic viewing after a bounded current public check for trusted CoStar-linked references, without approval writes.
