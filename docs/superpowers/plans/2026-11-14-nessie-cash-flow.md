# Nessie Cash Buffer Implementation Plan

> **For agentic workers:** Use the assigned backend/frontend work orders to implement the bounded tasks below. The manager owns integration and verification.

**Goal:** Connect the comparison decision to a clearly simulated Nessie cash buffer.

**Architecture:** Read-only Next.js integration route and validated DTOs feed an isolated client panel. Pure cash-flow/projection arithmetic keeps existing site evaluations unchanged.

**Tech Stack:** Existing TypeScript, Next.js, Zod, Vitest, pnpm; no new dependencies.

**Spec:** docs/integrations/nessie.md

## Global Constraints
- Bearer header only; NESSIE_API_KEY remains server-only.
- No mutations to provider data, database schema, auth, evaluation ranking, or deployment.
- Financial amounts are safe integer cents except existing modeled USD values and Nessie bill payment_amount.
- Nessie banking is simulated and separate from CoStar evidence.

## Review Focus
- Cursor truncation/cycles must fail explicitly; backend tests.
- Account direction, reward postings and transfers cannot become operating sales; backend arithmetic tests.
- A removed/changed account cannot keep a stale snapshot; frontend request lifecycle/browser check.
- Pending holds and bills cannot be deducted twice; projection tests and clear UI labels.
- Outdated comparisons cannot produce funding guidance; panel browser check.

### Task 1: Backend integration (backend specialist)
Files: lib/contracts/nessie.ts, lib/nessie/client.ts, lib/nessie/cash-flow.ts, app/api/integrations/nessie/{handler,route}.ts and colocated *.test.ts; no frontend files.
- [x] Write failing contract/client/cash-flow/handler tests for the documented success and failure cases; run targeted Vitest and record expected failure.
- [x] Implement the public schema first and notify frontend; build the bounded read-only client, safe snapshot math and route factory with injected env/fetch/time.
- [x] Run targeted tests and typecheck; report exact results and assumptions.

### Task 2: Comparison panel (frontend specialist)
Files: components/nessie/nessie-cash-flow-panel.tsx, components/live-comparison-workspace.tsx, lib/nessie/projection.ts and projection.test.ts; optional tests/e2e/nessie.spec.ts. Do not edit backend contracts.
- [x] Write and run failing tests for projected cash low/mean/high, upfront cost, cash depletion, positive/zero contribution and unsafe amounts.
- [x] Implement the math and accessible stateful panel against the documented schema; mount after existing comparison and pass its current projection options.
- [x] Verify no model projection without current results; labels distinguish mock cash and modeled scenario.

### Task 3: Manager integration and delivery
Files: docs/integrations/nessie.md, .env.example, README.md, scripts/env-policy.ts.
- [x] Create and record implementation start on the explicitly requested Linear ticket, record its ID in spec and use codex/<ticket>-nessie-cash-flow.
- [x] Preserve root .env key; link ignored worktree .env.local to it; document key and base URL and protect bundle scanning.
- [x] Review combined diff; run required four checks and env/bundle scanners.
- [x] Run local browser checks for the real configured key (read only) and API-boundary missing-key/error/empty/success states; report the current live 401 limitation, never silently seed.
- [x] Update ticket with implementation/check summary and record evidence in spec; leave changes local for review.
