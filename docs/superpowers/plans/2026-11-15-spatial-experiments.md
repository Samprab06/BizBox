# BizBox Spatial Experiments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Use parallel work only in the disjoint ownership below.

**Goal:** Deliver the first FDE-controlled furniture experiment stage between exterior comparison and the final report, with reusable spatial/behavior contracts and honest city/data readiness.

**Architecture:** Extend Scene 1 with an interior step. Use a provider-neutral curated Poly Haven catalog, immutable local draft snapshots, deterministic spatial experiments and explicit decision provenance; reuse existing simulation/events where applicable. Persist/report only through verified scoped paths; never treat preview/production as a development database.

**Tech Stack:** Existing Next.js, TypeScript, Zod, React/Three.js, Vitest; no new package or hosted service.

**Spec:** ../specs/2026-11-15-agent-spatial-business-simulation-design.md

## Global Constraints

- Exterior → interior experiments → final report; both stages contribute findings.
- Existing FDE controls edits and experiments; optional direct controls use identical commands.
- Poly Haven assets are source-backed render geometry; business costs/behavior defaults remain assumptions.
- Matterport photographed furniture cannot be individually removed by an ordinary overlay.
- Live Jev spend at most $1 total, only after a verifiable per-request ceiling is established.
- No push, deployment, production mutation or proprietary uploads.
- Stop and ask about unexpected material failures; do not invent vendor data.

## Review Focus

- Cross-project/site/scenario leakage: reject mismatched identifiers and do not reuse another space's experiment.
- Stale interior evidence: reset completion and report eligibility after exterior or interior changes.
- Unavailable providers: show missing/assumption readiness; never label synthetic policies Jev.
- Geometry edits: reject blocked/out-of-room placement; empty room remains runnable only with required resources.
- Reporting: finalization requires current exterior and interior review, preserving explicit skipped/unavailable cases rather than silently claiming success.

## Ownership and interfaces

Data specialist owns scripts/prepare-furniture-catalog.ts, lib/furniture/catalog.ts, public/furniture/, fixtures/spatial-data-readiness.json and docs/spatial-data-readiness.md. Catalog exports `FurnitureCatalogItem` and `FURNITURE_CATALOG`. Each item: id/name/sourceUrl/license/provider/assetUrl; widthM/depthM/heightM; role ('seating'|'table'|'storage'|'decor'|'service'); seats; dimensionsStatus; optional model dimensions metadata. Notify consumers before finalizing shape. Actual model transforms/units must be verified; no price invention.

Backend specialist owns lib/spatial/* and new lib/contracts/spatial.ts. Provides versioned Draft/Command/ExperimentResult schemas and pure create/apply/run helpers. Coordinate exact interfaces with frontend before coding; no edits to existing shared agent/flow contracts. Reuse catalog module. Cover seeded decision/action records, routed travel/obstacle effects, bounded readiness and aggregate paired experiment output. No live provider calls without manager budget guard.

Frontend specialist owns lib/contracts/agent.ts, lib/client/flow-steps*, lib/client/agent-jobs*, components/workspace-screen/*, new components/interior/experiment-*.tsx and relevant tests. Adds interior step and renders/edit/run/inspect/review surface consuming spatial backend. Coordinate narrow shared types with backend, tell manager consequential choices. Do not modify lib/agent/* or report exporter (manager ownership).

Manager owns lib/agent/* FDE tools/bindings, report integration outside frontend files, integration checks and final review. Agent-generated commands must be validated and scoped; no fabricated metrics.

## Tasks

### 1. Data and asset preparation
- [ ] Inspect official asset metadata/file manifests and select a small furniture set across seating/tables/storage.
- [ ] Write tests for ingestion transform/units and source/asset consistency; observe failure before implementation.
- [ ] Implement bounded preparation and curate downloadable glTF assets with dependencies/license/source metadata.
- [ ] Inventory LA/Houston source data and scan mapping availability locally, recording verified versus unavailable fields.
- [ ] Run targeted tests and validate assets locally; no bulk unbounded download or hosted writes.

### 2. Spatial experiment domain
- [ ] Agree typed interface with frontend; record limits and causal semantics.
- [ ] Write failing tests for add/remove/clear, blocked placements, reproducibility, changed routes/decisions, neutral edits, conservation and paired deltas.
- [ ] Implement distinct bounded adapters for coffee/quick_food counter service, salon chair/staff service and fitness session/equipment occupancy; cover Houston and Los Angeles with correct city timezones and explicit assumptions.
- [ ] Expose saved events/results and readiness, preserve distinct seed streams and no provider-in-frame calls.
- [ ] Run targeted tests; test all eight city/category combinations, document adapter limitations and live calibration requirements.

### 3. Interior flow and visualization
- [ ] Write failing flow tests: exterior result → interior; stale edits invalidate interior approval; final report requires current interior review.
- [ ] Add interior step, source labels and selected-site draft; preserve existing glass UI and consultant.
- [ ] Add catalog instances, layout clearing/editing, results and customer inspection with saved event clock.
- [ ] Bind structured edit/evaluation effects to the shared backend helpers; local drafts explicitly identified until durable integration verified.
- [ ] Run targeted tests and browser check on desktop with honest provider fallback states.

### 4. FDE and final report integration
- [ ] Write failing tests for scoped interior tool actions, capability/readiness inspection, invalid commands and report order.
- [ ] Bind interior tools on user-message turns, add current interior state to validated context, prevent browser-event mutations.
- [ ] Include verified reviewed interior findings in the final report alongside exterior comparison; reject mismatched/stale snapshots and never merge model-authored metric text.
- [ ] Test full path exterior → FDE edit/run → interior review → report.

### 5. Verification and remaining gates
- [ ] Run pnpm lint, pnpm typecheck, pnpm test, pnpm build and targeted browser flow.
- [ ] Independently review actual diff and causal claims, correct material findings and rerun affected checks.
- [ ] Attempt live Jev only with approved hard budget accounting; record zero spend if cost cannot be bounded.
- [ ] Update design/readiness documentation with implemented scope, actual source coverage, limitations and next phases. No complete-generalization claim for unimplemented models/data.

## Execution record

2026-11-15: User approved implementation and parallel subagents; selected Poly Haven library; authorized at most $1 live Jev; requires stopping for unexpected issues. No production access authorized. Local dependency install uses frozen existing lockfile.

## Final review corrections

- All four existing categories and both cities are required, not a café-only deliverable. Per-category operational rules must be tested.
- Actual asset bounds must agree with rendered transforms; source metadata remains separately preserved if dimensions differ. An unverified asset is not activated.
- FDE context is scoped to owned exterior comparison and matching project/site drafts. Server-side tools recompute results rather than trusting browser metric claims.
- Reviewed interior snapshots are included in both final summary and printable report; stale revisions invalidate finalization.
- Decision policies must key all behavior-relevant observations. Synthetic defaults never claim to be live Jev.

## Latest scope override

Akshar requested a working limited case first and specifically selected the already-defined café counter comparison. Immediate acceptance is `/cafe-counter-example`: exterior assumptions, existing paired counter replay, selected plan, and final printable report, with real browser verification. Broader city/category/furniture work remains local scaffolding and follow-up integration; do not hold the defined case hostage to acquiring all city data or claim that generalization is delivered.
