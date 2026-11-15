# Client flow UI

Spec: [client-flow-design](superpowers/specs/2026-11-14-client-flow-design.md). Plan: [client-flow-ui](superpowers/plans/2026-11-14-client-flow-ui.md). Tracking: HAC-162.

## Current entry point

Akshar rejected the exposed review controls and ambiguous comparison UX. `/review/client-flow` now redirects to `/projects/houston-coffee/workspace`; Preview state, Reset review and sample stage navigation are no longer a client entry. The current work is real property → labeled unit → explicitly add two choices → compare listing facts → optionally request modeled results. The hosted database health and actual listing search have recovered; the local simulation API still needs its own database configuration. No production credentials were copied or simulation service proxied.

The earlier sample review described below remains implementation history, not the current client route.

## Scope
This UI pass follows Akshar's accepted desktop flow while database access is blocked. It preserves the onboarding/workspace smoked-glass system. The canonical project workspace continues to use its actual services and explicit errors. The separate `/review/client-flow` page uses deterministic illustrative sample data and local state so all screens can be reviewed without credentials, data writes or paid calls.

The shared brand uses the existing project logo from `public/landing-preview/assets/bizbox-logo.png`, rendered in off-white with CSS masking, with a readable BizBox wordmark. The same asset supplies browser icons. This is brand integration, not a new identity. Concurrent onboarding files are outside this change.

Client functionality is in scope: existing comparison controller wiring, property selection, local review state, graph presentation, draft continuity, navigation and loading/retry/error states. New service/runtime implementations remain with their assigned owners.

## Screen sequence
1. Location selection and property facts.
2. Location comparison, with listing facts distinct from modeled outcome charts and ranges.
3. Outdoor what-if setup and before/after results.
4. Interior availability and stable property identity.
5. Indoor stations/staff what-if, schematic feedback and before/after metrics.
6. Nessie demo-account/cash assessment, including disconnected/empty/error states.

One review consultant area remains alongside the visualization. Its scripted sample replies do not call a model; voice-unavailable state does not imply a functioning realtime session. Review changes are temporary, not saved to the business profile or simulation database.

## Integration responsibilities
- Existing production comparison API/results remain authoritative; graph presentation consumes those payloads without recomputing evaluation math.
- Sam's HAC-161 owns unified intake/copilot routing; the review pane does not replace that runtime.
- Yasser's HAC-148/HAC-88 own real consultant screen dispatch, and HAC-79 owns experiment service control integration.
- The selected-site registry remains authoritative for actual Matterport scans; schematic review visuals are not scans. HAC-87 owns layout rendering in Matterport.
- Nessie's existing `read_nessie_cash_buffer` tool and saved result contract own real sandbox reads. Sample account numbers are not vendor results, business cash, sales, financing approval or forecast evidence.
- The aerial overview request is a separate imagery task. No provider/imagery behavior is changed by this screen pass.

## Verification
Exact-source lint, typecheck and production build passed in the isolated verification snapshot; 1,431 unit tests passed (43 existing skips). The full affected Chromium desktop suite passed 77 cases (2 existing skips), including the six-stage review test, accessibility, stale-run invalidation, cash and chat continuity, negative/zero graph scales, 500 px overflow and zero API calls from the review. The source matches the working candidate; only the unrelated preserved interrupted prototype/onboarding WIP was excluded from that snapshot. The existing recorded-example filesystem tracing warning remains.

The actual IAB on port 4201 was visually checked at 1300 px and its natural 499 px desktop pane. All stages render, property context persists, cash input 70000 survives Cash → Compare → Cash, Text/Voice keep history, and the compact document width equals its viewport. Screenshots: `/tmp/bizbox-client-flow-comparison-final.png` and `/tmp/bizbox-client-flow-cash-final.png`. The viewport override was reset.

Never describe the sample review as proof of live Jev, voice, Matterport, Nessie or database connectivity. Experiments use two fixed illustrative output states; controls do not calculate real simulation results. The real workspace receives the shared brand, comparison charts and existing-controller Compare action. The additional stages are an explicit interaction review pending assigned service integration.
