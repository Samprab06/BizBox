# Client flow UI

Spec: [client-flow-design](superpowers/specs/2026-11-14-client-flow-design.md). Plan: [client-flow-ui](superpowers/plans/2026-11-14-client-flow-ui.md). Tracking: HAC-162.

## Current entry point

Akshar rejected the exposed review controls and ambiguous comparison UX. `/review/client-flow` now redirects to `/projects/houston-coffee/workspace`; Preview state, Reset review and sample stage navigation are no longer a client entry. The current work is real property → labeled unit → explicitly add two choices → compare listing facts → optionally request modeled results. The hosted database health and actual listing search have recovered; the local simulation API has subsequently been connected to the approved development database and verified through an actual two-unit run. No production credentials were copied or simulation service proxied.

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

## Development comparison connection verified

Akshar supplied the approved development connection. It is configured only in ignored `.env.local` files for the working checkout and owned port4201 preview, with permissions0600; no value is documented or committed. Health confirms connected/PostGIS. Read-only checks found the current project and required tables,3339properties/3955spaces and populated public inputs. No migrations, imports, data replacement or new proxy were needed.

The actual user UI saved its profile201, created comparison201 and read stored results200 for the chosen Westheimer/Bellaire Unit1 pair. The stored result is nonsynthetic/current, uses the existing Huff model over30seeds and returns the exact chosen IDs. Jev/OpenAI remain unconfigured; these are modeled estimates, not measured traffic or a validated business forecast. Native screenshot `/tmp/bizbox-connected-comparison-results.png`; viewport override reset. No product code changed for this configuration fix.

## Jev configuration follow-up

The project already had a Jev key in the base checkout, but root/preview environments did not load it. The approved existing key was copied privately into ignored env files only; trusted GET/v1/models returned200 and lists jev-latest/jev-preview, and local capabilities now reports jevConfigured:true. No generation requests were made during diagnosis.

A read-only rebuild of the current two-unit plan requires50personas ×4orders ×2sites =400distinct requests. None match the800 usable cached answers from other contexts. Existing HTTP retries3 and panel retry1 permit up to3200 transport attempts. Generation is pending Akshar choice of a one-request connectivity test or the full panel. Do not describe configuration/model-discovery success as a verified Jev-backed comparison. Offline client/panel/assembly validation passed38tests with1 gated live test skipped. No product code, migrations or schema changes.

## One-request Jev live verification

Akshar approved one request first. Exactly one generation HTTPPOST from the original current panel plan succeeded: status200,152ms, requested jev-latest and received jev-1.14.0. The existing client validated all9requested answers. HTTP retries were0, concurrency1, timeout20s, redirects rejected and a second-attempt guard enforced the one-request limit. The successful exact response was saved through the existing project-scoped cache adapter. No full panel/comparison or additional generation requests were run, and no product code changed. This verifies provider/auth/wire compatibility, not a completed Jev-backed location comparison.

### Area preference selections

The guided intake’s “Which areas should we favor or avoid?” question uses a flat,
white street-outline map centered on the selected Houston or Los Angeles city.
Nine curated neighborhood/place anchors per city come from the existing provider’s
OpenFreeMap/OpenStreetMap z14 `place` tiles (snapshot `20261101_080013_pt`).
Curated anchors keep central neighborhoods visible even when lower-zoom vector
tiles omit them. Sparse labels use those real geographic anchors,
with a small dot paired to each name and collision spacing to keep them apart.
Labels sit above selection fills and do not intercept selection gestures.
Choose green **Favor** or red **Avoid**, then drag a rectangle over an area.
Add any number of rectangles; there is no selection cap. **Erase** removes
selections under a click or intersecting a dragged box. **Reset** clears them.
Arrow keys move the cursor; Space/Enter sets the first corner and then the second
corner, and Escape cancels. Existing typed preferences remain visible and preserved.

Geographic rectangle bounds use compact coordinate arrays in the existing intake
`areas` answer, restoring on return and remaining attached to the map when resized.
Legacy brush marks remain visible and erasable. Review shows a readable summary;
changing city clears selections from the previous city. There is no silent truncation.
Very large answers remain subject to existing downstream intake message limits;
this UI does not add spatial filtering or ranking enforcement to the backend.

The existing OpenFreeMap/OpenStreetMap vector provider requires internet and WebGL.
No imagery or terrain is loaded. Attribution is available from the small info button
in the map corner. If loading fails, the existing skip action remains available.
