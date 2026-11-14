# Nessie Consultant Tool Implementation Plan

> For agentic workers: backend and frontend specialists own the bounded tasks below; the manager owns integration and final verification.

**Goal:** Let the consultant call Nessie and show saved cash-buffer evidence inside Consultant activity.

**Architecture:** Reuse the read-only v2 client and pure financial helpers. Register an optional investigation tool, persist validated output in existing milestones, and render its newest scoped result. The prior standalone panel is superseded and removed.

**Tech Stack:** Existing TypeScript, Next.js, Zod, Vitest, Playwright and pnpm. No new dependencies/services/migrations.

**Spec:** docs/integrations/nessie.md

## Global Constraints
- Server-only Bearer key, shared mock banking clearly labeled simulated.
- No provider writes/seeding, auth changes, demand/ranking changes or deployment.
- Model arguments contain IDs only; financial inputs come from provider data and the trusted stored evaluation.
- Reuse existing step budgets, checkpoint/resume and transport cancellation.
- Current attempt/profile/latest banking evidence governs cards, findings and model context. No fallback to old cash after a newer failure/malformed result.
- PR #86 must remain unmerged.

## Review Focus
- Same-attempt/current profile/project and stored site identity: tool tests.
- Sole/multiple/foreign accounts and optional empty/error states: reader tests.
- Financial evidence and derived model notes retained through retry or superseded reads: findings/planner/job tests.
- Outdated or running comparison and investigation/profile switch races: helper/browser tests.
- Real production dependency binding and saved numerical final-plan evidence: scripted workflow and binding tests.

### Task 1: Backend specialist
Files: lib/contracts/nessie{,.test}.ts, lib/nessie/consultant{,.test}.ts, lib/nessie/findings{,.test}.ts, lib/agent/{tools,tools-postgres,investigation-planner,plan-artifacts,jobs}.ts and related tests.
- [x] Write failing meaningful contract/registry/reader tests and publish the typed result contract before frontend integration.
- [x] Register read_nessie_cash_buffer with optional account_id and paired comparison_id/site_id; derive modeled buildout and contribution exclusively from a current stored evaluation.
- [x] Bind the actual server reader and planner allowlist/instructions; retain nonfatal empty/provider/selection limitations.
- [x] Prove scripted financial question -> provider transport -> durable milestone -> resume without duplicate fetch -> grounded numerical findings.
- [x] Remove superseded financial notes from retry/planner context while preserving unrelated findings; verify latest-only final-plan handling with observed red->green regressions.

### Task 2: Frontend specialist
Files: components/ConsultantPanel.tsx, components/nessie/consultant-results.ts, components/nessie/consultant-results.test.ts, components/nessie/consultant-cash-card.tsx, components/live-comparison-workspace.tsx, components/comparison/comparison-screen.tsx, comparison page and tests/e2e/nessie.spec.ts.
- [x] Remove standalone controls and mount Consultant activity once for live/example comparison contexts.
- [x] Retain validated milestone summaries and show the newest scoped saved cash result; no direct browser banking request.
- [x] Add meaningful identity/attempt/profile/checkpoint/switching tests and read-only scenario/limitation rendering with accessibility and responsive checks.
- [x] Verify raw findings and outdated comparison cannot leak old cash guidance after the review fixes.

### Task 3: Manager integration and delivery
Files: docs/integrations/nessie.md, this plan, README.md, lib/agent/README.md; conflict resolutions limited to preserving current main and this feature.
- [x] Record Akshar's revised acceptance criteria on HAC-106 and the Agent Board; retain do-not-merge instruction.
- [x] Review the combined tool/provider/checkpoint/card paths and re-review material fixes independently.
- [x] Sync the PR branch with current main, preserve concurrent work, and run pnpm lint/typecheck/test/build plus browser and secret checks on the integrated result.
- [x] Recheck real Nessie read-only connection/empty data; do not claim populated live data or paid-model execution.
- [x] Update final spec/verification and PR description, commit and push the approved consultant revision to existing PR #86, update HAC-106, and confirm PR remains open/unmerged.
