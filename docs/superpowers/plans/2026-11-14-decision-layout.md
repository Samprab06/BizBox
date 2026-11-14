# Decision layout implementation plan

> **For agentic workers:** Execute this frontend plan in the assigned worktree. The manager owns review, publication and integration.

**Goal:** Lead comparison and simulator pages with a specific decision, qualified computed answer, real scene and next action.

**Architecture:** Reuse BizBox Card/evidence primitives and one presentational `DecisionHeader`. Comparison scenes replay canonical stored events; simulator scenes use the existing engine-backed 3D viewer. Existing controllers own requests and saved identity.

**Tech stack:** Existing Next.js, React, Tailwind, Vitest and Playwright; no dependencies added by HAC-71.

**Spec:** HAC-71; `docs/design-system.md`; stable refreshed HAC-70 publication base `f4f726b` (including current main `5d3134b` and the earlier intake `fd5bf33`).

## Constraints and decisions

- Own decision components, narrow comparison/simulator mounts, opted-in wrapper, related frontend tests and docs.
- Preserve actual HAC-62 conditions and material model disagreement. Never invent a robustness threshold or sales forecast.
- A matching next action selects/focuses the existing sensitivity control; running it remains explicit.
- Preserve HAC-70 title/unknown-project/context/viewport APIs and HAC-69 navigation ownership. No global shell redesign.
- No backend, API/schema, auth, persistence, engine, analytics, package or lockfile changes by this ticket. The simulator page uses the existing store freshness read.

## Approach

The manager approved one shared presentational header, a canonical comparison
replay, and a narrow mount of the stable simulator scene. A compact wrapper is
opted into only by decision pages. It preserves navigation destinations, keyboard
reachability, context identity and accessible h1 names. Other screens retain their
existing layout.

## Implementation

- [x] Add shared header and reading-order tests.
- [x] Use exact saved robustness, honest historical/stale/loading states and visibly qualified seeded examples.
- [x] Add run-identity-checked manual comparison replay with retry and full-view link; preserve canonical service/completion semantics.
- [x] Add the actual simulator operating scene, scenario/time controls and larger viewer paths; retain original neighborhood and full replay.
- [x] Forward saved robustness/freshness through the frontend page loader; keep valid runs when freshness is unknown.
- [x] Validate sensitivity intent and focus only after the controller is ready. A deterministic production regression gates candidates until the saved result arrives first.
- [x] Adapt shell/a11y test expectations for the existing Simulator title/destination, context links and horizontally scrolling navigation without weakening reachability, axe or forecast checks.
- [x] Record final four-check and browser-matrix results for the exact candidate and inspect screenshots. Manager completion packet follows local commit.

## Review focus

Historical/unknown/stale data must remain qualified. Scene identity changes must
not display another run. Long summaries and expanded evidence wrap rather than
clip. Weekday/weekend scenes use their actual hours. Keyboard navigation and
next-action focus remain usable without a model request.

The initial phone CTA failed a real viewport assertion; supporting disclosure and
compact composition fixed the geometry. Production testing also exposed a focus
race when results arrived before candidate loading. The fix uses actual ready
state, with no delay, retry or timeout added. Early contended backend tests hit
existing five-second limits; serialized checks use `--maxWorkers=2` without
backend/config changes.

## Final local verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test --maxWorkers=2` and `pnpm build` passed; 734 unit tests passed and 19 environment-gated tests skipped.
- 69 comparison/simulator browser cases passed across Chromium, WebKit and mobile Chrome. Another 23 focused Chromium shell/accessibility cases passed, including all navigation focus styles, reachability, structure, console and responsive geometry.
- The full answer, real scene and action fit at 1280×800, 820×800 and 375×800. Mobile action bottoms were approximately y714 for comparison and y736 for simulator (WebKit y729). Both canvases/replays were visually inspected.
- Forecast, no-automatic-model-request, source-identity, unknown/stale data, manual replay, keyboard evidence, reduced-motion and axe guards remain active. No skipped acceptance test or added retry/timeout masks a failure.
- Local tests use invented fixtures and mocked comparison/run responses; stored simulator loading/robustness/freshness is covered at its frontend page boundary. Hosted database/imagery verification and publication remain the manager's delivery steps.

## Publication-base refresh

The manager requested the exact newer HAC-70 base `f4f726b`. Its runtime WebGL
fallback and upstream replay renderer updates were merged, preserving all decision
mounts, compact wrapper APIs and test adapters. The sole merge conflict was this
simulator documentation; both sections were retained.

Fresh lint, typecheck, full unit suite (734 passed, 19 environment-gated skips) and
production build passed. The affected three-engine decision/simulator matrix had
27 passes and three existing city-environment gates. That city test was then
enabled separately with a dummy local Vexcel key and intercepted imagery: the
actual neighborhood WebGL fallback and Retry passed with no page errors. Three
upstream replay/floor-plan/fallback Chromium cases also passed. No added skip,
retry, timeout or product workaround was needed for the refreshed base.

## Latest navigation and Linux WebKit integration

Integrated HAC-70 target 974e823 and main d123010 in cdbc1ca, preserving source/model metadata and three-task navigation. Compact decision pages now use a native disclosure with current-task and all group names visible; all grouped links and Next remain keyboard reachable. The original Linux WebKit CI run exposed a partly offscreen CTA (572 other E2E cases passed); shorter duplicate example copy and compact action typography preserve all qualifiers and the real160px canvas.

Fresh lint, typecheck, full unit suite (844 passed /30 gated skips) and production build passed on cdbc1ca. Production Chromium/WebKit affected matrix:228 passed and6 existing city gates initially, with6 navigation-setup failures because role locators correctly hide collapsed links. Tests were updated to explicitly open the native disclosure before navigation/history assertions; all6 reran successfully, giving234 verified cases /6 gates. New checks cover collapsed/open navigation, current task, keyboard activation and axe. First-viewport375px simulator CTA ends at717px Chromium/711px WebKit; ratio1 assertions remain intact at375/820/1280.
