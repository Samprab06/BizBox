# Client workspace implementation plan

**Goal:** Apply Akshar's approved glass design and two connected experiment flows to the existing Next.js workspace, using actual components/services. Akshar explicitly approved implementation; no new design approval is pending.

**Spec:** Akshar's approved eight-screen storyboard and latest user direction: outdoor location comparison, selected-space interior operations, shared Text/Voice with existing reactive orb, Current setup / Proposed change, optional replay. The durable implemented flow and visual rules are recorded in `docs/client-workspace.md`. The standalone toy prototype is rejected and must not be imported.

**Architecture:** Reuse `WorkspaceScreen`, `useIntakeConversation`, `useLiveComparison`, existing VoicePanel, Neighborhood/Vexcel and the selected site's interior registry. No backend/shared server contracts, provider clients, alternate stores or simulation math. Sam owns runtime/tools; Yasser owns renderer/picking/experiment integration. API-dependent missing capabilities remain explicitly unavailable.

## Ownership

- Frontend specialist: `components/workspace-screen/workspace-shell.tsx`, `workspace-glass.module.css`, `assistant-panel.tsx` and focused assistant E2E assertions. Presentation only; existing conversation and voice adapter preserved.
- Manager: `workspace-screen.tsx`, new visualization/selection/comparison/selected-interior client components and view-model helpers; route/frame presentation; minimal additive Neighborhood `illustrativeOverlays` flag (default true) reserved on HAC-6. Do not implement competing picking/controller logic.
- Existing untracked prototype/test work remains untouched and is excluded from delivery.

## Tasks

- [x] Build full-width responsive 68/32 dark translucent glass shell; concise header/navigation; preserve conversation/draft and existing voice client/orb.
- [x] Mount actual Vexcel component in geography mode with invented traffic/demand overlays disabled; select/focus real API candidates, preserve stable site IDs, show source facts and errors rather than example properties. Current proxy is Houston-only; LA imagery remains explicitly unavailable.
- [x] Use the existing comparison controller on explicit Compare locations; show server-sourced results and provenance, never fabricated metrics. Keep the consultant mounted across views and selection.
- [x] Resolve selected-site interior API; mount only its authorized matching Matterport model or show honest floorplan/unavailable state. Preserve consultant; route to existing actual experiment surface when valid stored comparison exists. No fake Keep/Discard or unsupported operation succeeds locally.
- [x] Verify selection/results scope, source/error/loading states, Text/Voice/draft continuity, keyboard/mobile/reduced motion and existing onboarding typed preferences. Four repo checks pass for an isolated delivery-source snapshot; the unrelated interrupted untracked test is preserved. After merging current main fe99baf locally, the unit suite has 1364 passed and 43 skipped. Final integrated Chromium run: 89 passed and 2 skipped across workspace, onboarding and shell specs, including desktop/tablet/phone and accessibility checks. One pre-integration unit timeout under concurrent build/browser load passed on a sequential full-suite rerun; the integrated four-check chain also passed sequentially.
- [x] Write `docs/client-workspace.md` with remaining Sam/Yasser service dependencies; update HAC130/board during handoff. No push/merge/deploy or automated paid calls.

## Component interface

`WorkspaceShell({header, projectId, selectedSiteId?, navigation?, backdrop?, children, assistant})` takes `WorkspaceHeader` from existing model, ReactNode slots, and wraps one visualization area + persistent assistant. A single shared backdrop extends behind both panes. Scoped style classes include `viewport`, `viewToolbar`, `glass`, `primary`, `secondary`, `candidates`, `candidate`, `selectedCandidate`, `details`, `comparison`, `notice`, `viewTabs`, `muted`, `empty`, `toolbarActions`. Existing AssistantPanel props remain compatible. The corrected visual rules are recorded below.

## User-directed UI correction

The initial local-ready design at c6193df was rejected. Akshar explicitly selected the original onboarding's neutral smoked-glass visual system and narrowed this pass to UI only; there are no unresolved design questions. The existing service integration scope is frozen during this pass.

- [x] Replace blue/periwinkle dashboard chrome with the actual onboarding palette, glass opacity, white controls, soft edge and type treatment; preserve the split scene/chat and existing city-photo atmosphere.
- [x] Remove nested frames, visible status/source tags, repeated headings and explanatory prose; keep concise actions/statuses, keyboard names and evidence behind Details.
- [x] Verify the resulting desktop appearance in the actual browser against onboarding, including Text/Voice and available/unavailable content. The final desktop-only Chromium run passed 60 cases with 2 existing skips; lint/typecheck/build and 1,364 unit tests passed for the isolated delivery source. Selected/results fixture captures are explicitly invented API test data. Original service gates and the existing build tracing warning are unchanged. Concurrent onboarding work and the interrupted prototype test remain excluded. Akshar explicitly stopped phone/mobile work project-wide during this pass; preserved existing responsive behavior and stopped further phone QA/polish. Saved the directive in project AGENTS.md and on HAC-6; separate memory-worker search/save failed, so no global-memory success is claimed.

## Authorized live Vexcel connection

Akshar subsequently requested connecting Vexcel and displaying it in the location screen. Loaded the existing server key into ignored local env, ran the existing Cesium asset preparation, and visually verified real Houston mesh/tile loading. The earlier blank-renderer symptom was missing decoder WASM assets from starting `next dev` directly instead of the repository's `pnpm dev` script. Kept the corrected glass design and removed only the duplicated renderer caption (optional prop defaults unchanged elsewhere). No competing HAC77 building picker, provider collection mapping, runtime or store was introduced. Listing matching and full consultant actions are not established by this imagery check.

## Real listing options from onboarding

Akshar then authorized showing real location matches from their saved onboarding. Reuse the existing intake conversion/search engine; do not seed personal answers, widen criteria or add a recommendation engine.

- [x] Frontend owns the inventory hook/controller and workspace readiness/cards: typed loading/needs-brief/error/empty/ready state; same-tab profile changes refetch; chat-only saves do not; old results are invalidated; source facts and concise fit reasons retain provenance.
- [x] Backend owns the development-only read-through to the existing deployed `/api/sites`: exact allow-listed origin, development and absent-DB guards, original strict request/provenance preserved, bounded abort, validated real project-scoped CoStar response, no cookies/auth forwarding, no-store and sanitized errors. Production/test/default DB path unchanged. No hosted migration/import or production credentials copied.
- [x] Manager verified the original source kit read-only (3,339 properties / 3,955 spaces) and all eight supported city/category request cases through the real endpoint. Separate browser context: sample Houston $4,500 ceiling →115 matches/8 shown; $3,500 →112/8, exact changed criteria, draft retained, zero model POSTs. Original personal brief untouched. A separate local-origin QA page also visually confirmed actual listing cards over the corresponding rendered Vexcel neighborhood.
- [x] Exact isolated delivery source: lint/typecheck/build pass; 1,405 unit tests pass with two workers, 43 existing skips. Desktop Chromium regression: 69 passed /2 existing skips. New client cases and backend proxy guards passed. Preserve unrelated onboarding/prototype work; no phone QA, push, PR, merge or deployment.

Current native QA uses a clearly identified sample brief at local port 4201; the personal workspace remains port 4197 and asks to finish a missing brief. `docs/client-workspace.md` records data semantics and the transitional development connection. Full consultant/runtime/building-picking tickets remain separate.

## Actual shortlist in a bird’s-eye view

Akshar requested the real returned locations in Cesium, specifically from above. Frontend owns the bounded listing annotation attachment, pure grouping/framing helpers, Neighborhood option and workspace selection bridge. Manager owns integration, actual-provider QA, documentation and final verification. Existing shared URL selection remains canonical; no new store, clock, provider or simulation API.

- [x] Group exact source coordinates, keep every eligible geocoded location, link numbered pins/cards, fit the unobscured map area, add All locations and honor reduced motion/manual interruption.
- [x] Preserve the single existing Viewer during selection; leave broad mesh picking/runtime to HAC-77.
- [x] Diagnose actual wide-view disappearance: empty-root Vexcel tileset stops traversal at normal screen error. Retain globe-free rendering for negative source elevations; use a bounded listing-only quality adaptation.
- [x] Complete actual-provider overview/card/pin verification, exact-source four checks and affected desktop regressions. Final source: lint/typecheck/build pass, 1,413 unit tests pass /43 existing skips, 69 desktop Chromium pass /2 existing skips. Actual scene settled with zero pending/processing tiles at about326MiB; manager approved listing-only256+128MiB budget and desired-LOD policy, retaining other consumers’ budgets. Pin/card selections retained the same canvas and selected URL/details; All locations restored overhead framing. No publication authorized.

## Address-tag visibility and coordinate follow-up

- [x] Replace small dots with centered26px numbered anchors and large clickable address tags, measured/collision-separated inside the visible map pane; screen-space leaders preserve geographic meaning. No source coordinate, camera, budget or provider changes.
- [x] Audit all four captured real CoStar coordinates against Cesium entity round-trips (error below1e-10degrees), identity tileset matrix and overhead orientation. Fresh live browser tag selection confirms expected site/URL/details and stable canvas.
- [x] Diagnose transient same-host Vercel edge reset read-only. Restore owned4201 preview via temporary process-local DNS preference, normal TLS retained. No repository transport workaround or cached-data fallback.
- [x] Final exact-source checks passed: lint/typecheck/build, 1,416 unit tests /43 existing skips, 11 affected desktop Chromium regressions. Actual live address-tag selection and overview checked; coordinate audit documented. Local commit only; no publication authorized.

## Houston map-first exploration

Akshar explicitly narrowed the next pass to Houston onboarding → real matching pins → click for details. No agentic-chat integration, simulation, analytics or LA provider work is part of this pass.

- [x] Default arrival shows the map and genuine returned property tags, without an automatic selection, property sheet or card carousel.
- [x] Explicit pin/list selection opens actual property/unit facts in a dedicated side panel; close clears selection and restores exploration. Coincident units share one pin and are distinguished by source rent/size.
- [x] Optional results list and Property/Chat controls preserve the existing conversation, and remain usable inside the narrow desktop Codex preview container without covering the map. This is desktop-window behavior, not resumed phone work.
- [x] Changed criteria invalidate stale selection; no hardcoded sample locations, fabricated coordinates or expanded search contracts. Retain the existing eight-space response limit and distinguish shown results/property groups from total matched spaces.
- [x] Verify changed Houston briefs/categories, native actual-user-tab pin/details flow, full desktop flow and exact-source checks. Preserve unrelated onboarding/prototype files; local delivery only.

Frontend specialist owns workspace components/CSS and affected regressions. Manager owns review, exact-source validation, native browser QA, documentation and handoff. Existing city annotation layer, Vexcel provider/budgets, runtime and data contracts remain unchanged.

Final exact-source evidence: lint/typecheck/build pass, 1,416 unit tests pass (43 existing skips), and 74 desktop Chromium cases pass (2 existing skips). Two legacy navigation expectations were updated because this workspace no longer propagates a fictional default site. Native actual IAB tab9 verified clear arrival, pin-to-property selection, grouped-unit rent/size/ID changes, close/query clearing and optional8of115list. Native screenshots: `/tmp/bizbox-houston-map-first-iab.png` and `/tmp/bizbox-houston-property-details-iab.png`. These use live source data, not API fixtures.

## Saved context and expanded-window repair

- [x] Reproduce actual988px expanded IAB clipping after compact layout, then verify corrected500→988transition and all four real property tags. Observe actual map/toolbar and synchronize Cesium sizing before overhead fitting; preserve manual input and one Viewer.
- [x] Suppress only obsolete leading intake opener in workspace after valid completed brief; retain original history, actual offline status and Text/Voice continuity. Show saved context without a synthetic reply.
- [x] Reproduce offline-onboarding request bootstrap and stale-draft bugs with two failing tests. Include current representable founder answers in message requests through the existing API schema; preserve form-only pending-edit synchronization.
- [x] Exact-source lint/typecheck/build passed; 1,423 unit tests /43 existing skips and 76 desktop Chromium /2 existing skips passed. Local delivery only. Source imagery coverage and local consultant configuration remain explicit limitations. No new provider, model call, runtime or production work.
