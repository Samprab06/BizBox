# Client flow UI Implementation Plan

**Goal:** Implement and demonstrate the remaining client screens without waiting on the database, preserving the existing design system.
**Architecture:** Shared production presentation components plus an explicit isolated review route; deterministic sample view models, no API fallback or runtime/provider changes.
**Stack:** Existing Next.js, TypeScript, CSS modules and inline accessible SVG/CSS charts; no dependencies.
**Spec:** docs/superpowers/specs/2026-11-14-client-flow-design.md

## Constraints and review focus
Desktop only; preserve unrelated WIP. Distinguish source facts/model results/sample data. Check negative/zero graph values, changing selected sites, draft continuity, unavailable providers, keyboard access and narrow desktop pane overflow. No external publishing.

## Work
- [x] Frontend: read spec, implement shared comparison chart/results, property action improvements and structured experiment/interior/cash presentation with explicit review states. Own components/workspace-screen except workspace-shell.tsx, components/client-flow-review/, app/review/client-flow/, tests/e2e/client-flow-review.spec.ts and own pure helper tests.
- [x] Manager: existing logo review; shared brand component/favicon, workspace-shell header integration. Own components/brand/, public/brand/, app/icon.svg and workspace-shell.tsx. No edits to concurrent onboarding.
- [x] Frontend: review route with deterministic fixtures, same shell/glass, flow navigation/selection/compare/control changes, scripted chat/draft continuity, honest voice/scan/Nessie states. Unit test chart math and meaningful interaction regressions.
- [x] Manager: inspect final integration, run exact-source lint/typecheck/unit/build and affected desktop browser regression, fix material findings with owner, update docs/spec status, capture actual preview/screenshots, local delivery only.
