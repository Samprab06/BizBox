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
