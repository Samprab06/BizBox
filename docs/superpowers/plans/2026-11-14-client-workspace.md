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
- [x] Verify selection/results scope, source/error/loading states, Text/Voice/draft continuity, keyboard/mobile/reduced motion and existing onboarding typed preferences. Four repo checks pass for an isolated delivery-source snapshot; the unrelated interrupted untracked test is preserved. Unit suite: 1290 passed, 40 skipped. Browser: 11 focused workspace cases passed; 78 broader onboarding/shell cases passed and 2 skipped (including 3 updated responsive assertions rerun successfully). One unit timeout under concurrent build/browser load passed on a sequential full-suite rerun.
- [x] Write `docs/client-workspace.md` with remaining Sam/Yasser service dependencies; update HAC130/board during handoff. No push/merge/deploy or automated paid calls.

## Component interface

`WorkspaceShell({header, projectId, selectedSiteId?, navigation?, backdrop?, children, assistant})` takes `WorkspaceHeader` from existing model, ReactNode slots, and wraps one visualization area + persistent assistant. A single shared backdrop extends behind both panes. It exports scoped style classes: `viewport`, `viewToolbar`, `glass`, `primary`, `secondary`, `badge`, `candidates`, `candidate`, `selectedCandidate`, `details`, `comparison`, `notice`, `viewTabs`, `activeTab`, `muted`, `status`, `empty`, `toolbarActions`. Readability, restrained periwinkle accent, no green. Existing AssistantPanel props remain compatible.
