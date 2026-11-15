# Client flow UI specification

Akshar requested implementing the agreed screen roadmap quickly while the database is blocked, preserving the original onboarding design system. Desktop only. This includes necessary client functionality and wiring existing controllers/APIs where available; service owners retain runtime/data implementations.

## Approach
Reuse the production workspace shell, property details, result payloads, selected-interior adapter and existing Nessie contracts. Add a clearly labeled, non-persistent `/review/client-flow` route that exercises shared presentation components with deterministic illustrative data. No silent fixture fallback in the actual workspace; no backend/API/store/provider/dependency changes. The separate review route makes blocked states and unfinished integrations reviewable without implying live success.

## Visual contract
Neutral smoked glass rgba(15,16,21,.4), off-white #f7f7fa, muted #dedee5, 32px rounded primary surfaces and fixed blur. Match existing workspace-glass.module.css/onboarding. Keep visualizations left and consultant right. No green status palette, unnecessary badges, progress prose or automatic camera movement. Controls must be keyboard usable, charts have visible values and accessible text/table equivalents. No animated blur; reduced-motion respected. Actual aerial provider issue remains separate; do not replace map imagery or fabricate geography in this task.

## Screens and acceptance
1. Brand: shared white-on-dark logo treatment using the existing project brand asset, readable wordmark, matching existing-asset favicon. Do not invent a different brand or alter unrelated onboarding WIP.
2. Property: retain exact chosen address, rent and area; grouped units; prioritize compare and interior actions. Never imply verified scan availability before registry response.
3. Compare: 2–3 review locations, source listing facts separate from modeled results. Production result presentation gets side-by-side metric bars with ranges for modeled customers and operating contribution; readable signed/zero scales and table fallback; return to correct property.
4. Outdoor experiment: compact controls for hours/staff/stations/ticket; current vs changed setup and explicit run state. Review mode uses deterministic illustrative outputs labeled sample; production services unchanged. Charts show before/after, no fake observed traffic or Jev claim.
5. Interior: stable selected-property identity; structured viewer + experiment panel, no invented Matterport scan. Show honest scan-unavailable state or a clearly labeled schematic in review, with floor plan/return actions. No third-party public scan substituted for property.
6. Indoor experiment: station/staff controls, served/wait/walkaway before/after metrics and schematic station overlay in review, labeled illustrative. Keep/discard review changes locally and visibly; no fake server persistence.
7. Cash: Nessie demo account selection, available cash/buildout/projected cash presentation; simulated banking label and clean unconfigured/empty/error states. No real banking claim or vendor write; reuse existing saved results in production when available.
8. Continuity: one review chat pane across stages, draft/history preserved; Text/Voice toggle with honest unavailable voice state. Review replies must be explicitly scripted, never described as live agent calls. Back/reset, loading/error/unavailable states testable. Changes in one stage do not silently select a different property.

## Boundaries
No production database repair, new credentials, paid calls, new traffic dataset, API/shared contracts, runtime dispatcher, map renderer, simulation math, or Matterport authorization changes. No external publish/push/merge. Preserve concurrent onboarding/prototype changes.

## Delivery
Review route shows all screens without database, shared production comparison/details use the same components where practical, and spec identifies remaining service connections. Verify desktop wide and narrow app-pane layout, keyboard controls, state continuity and meaningful graph behavior, plus repository checks in clean exact-source snapshot. Show screenshots and preview URL.
