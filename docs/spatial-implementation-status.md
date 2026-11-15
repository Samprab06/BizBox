# Selected-building interior experiments

Current local status, November 15, 2026. Branch `codex/bizbox-matterport-simulation`.

## Normal product flow

The judge completes ordinary onboarding. Top locations → Compare → Results → Interior experiments → reviewed final report is the primary flow. There is no Gage onboarding shortcut, prefilled profile or replacement business brief. Coffee Port and `/cafe-counter-example` remain separate, explicitly authored references.

The selected canonical CoStar lease-space ID resolves its own interior. Generic read-only discovery projects bounded Matterport references from the selected space, parent-property attachments and normalized attachments. No address-specific code is needed. Discovery, public availability, approved display, SDK rendering, suite identity, geometry and Defurnish availability are separate capabilities. A discovered reference does not silently become an approved exact-suite scan. Akshar explicitly authorized automatic viewing of verified public CoStar-linked scans; this is a read-only viewing policy, not a registry approval write.

Existing approved public mappings open their scan. Trusted references discovered from canonical selected-site CoStar data can also open automatically after current public verification. The checker uses a fixed official endpoint, bounded requests/timeouts/response size and a short process-local cache; it never approves registry rows or unlocks private scans. If verification/access fails, the API retains floorplan/modeled provenance, while the selected-interior UI shows a concise unavailable state instead of a different 3D placement canvas. A real Houston candidate (`10888419:13425682`) now resolves its verified public property scan with registry approval still false. Gage (`15423321:13450779`) exposes five references and preserves its approved parent-property scan. The source associates Gage and Hammel addresses with the same property; the tour is not verified selected-suite geometry.

## Experiments, people and reports

One current baseline/proposal draft drives furniture edits, operational settings, customer decisions, continuous movement, FDE inspection and the final report. Four local Poly Haven CC0 furniture assets support add/move/rotate/remove/clear. Furniture affects routed obstacles and seating observations. Staffing plus service resources control effective counter capacity. Entrance/service anchors are editable assumptions. Clear removes proposed objects; photographed furniture is preserved.

Customer IDs remain stable while people walk, queue, receive service and exit. They leave the visualization after reaching an outside endpoint. Native placement uses either a verified matching model/floor/room transform or a rigid alignment anchored to actual current scan floor evidence. The latter keeps the room and operating geometry explicitly assumed; no separate modeled placement view is shown. Missing floor evidence asks for a floor point inside Matterport. Selected-suite room bounds remain approximate rectangles, not reconstructed walls, doors, infrastructure or capacity guarantees. Parent-property scans do not silently define the selected suite.

All four business adapters and LA/Houston timezones are implemented. Live Jev preparation currently supports café decisions; other categories use clearly labeled assumed previews. This is an operational scenario model, not calibrated observed customer demand. No automatic change is made to the stored exterior ranking or monthly economics. Newly discovered exact-space scans without canonical stored geometry remain viewable references; their live geometry is not promoted into receipt-validated measured layouts.

Every final interior report requires a run and review of the current revision. Source changes, furniture/settings edits and new runs invalidate stale reviews, policies and affordability. The final and printable report recompute the same saved experiment and preserve source/assumption limitations. FDE `test_interior_change` starts from the current draft and adds exactly one catalog item, keeps operational inputs and paired seeds fixed, waits for actual native loading, then prepares the current Jev policies. The resulting before/after finding can be kept and included in the report. A table does not silently add seats or demand.

## Live Jev and affordability

The dedicated `INTERIOR_JEV_API_KEY` activates only the budgeted interior route. Inputs describe synthetic café personas, route/seats/price/service/staff/capacity and queue conditions. Returned probabilities actually change join/leave decisions. Policy receipts bind the exact project, comparison, baseline/proposal and provider policies; finalization verifies them without spending again. Semantic caching, cross-worker claims and an atomic durable grant enforce the original $1 aggregate authorization. No silent provider-failure fallback is labeled Jev.

Actual application preparation, receipt verification, zero-call cache replay and read-only Nessie assessment returned HTTP 200. Conservative aggregate reservation remains **$0.079464**; the CLI handoff is sealed. No calls were made by the canceled onboarding shortcut test.

Nessie reuses the existing sandbox reader without account/payment/transaction writes. It keeps operating-day interior changes separate from stored monthly exterior cash flow, handles known buildout once, and reports missing furniture/equipment prices. It does not claim complete affordability or purchase ROI.

## Data and provider limits

The user-approved preview activation added only migration 0011's four Jev tables, the original grant and two reviewed Gage mappings. Existing business records were preserved. An import serialization defect in those two new records was corrected transactionally without weakening runtime validation. Additional registry mappings have not been approved or written; automatic verified-public viewing is independently authorized by the user.

Matterport Model API access was verified read-only using the provided credential pair and configured privately in the existing ignored server token slot. The actual approved model returns room areas/boundaries, but two of four rooms lack complete positive-height geometry; conservative normalization currently rejects incomplete dimensions. This is a geometry-completeness issue, not a missing credential. No generation, unlock, export, purchase or provider mutation was made.

Existing generated Defurnish views are discovered through SDK `View.views` and switched with `View.View.setActive(false)`. Availability is not inferred from a feature flag. Gage has no generated Defurnish view; no generation endpoint or generated empty scan is fabricated.

Public sample models do not create lease-space inventory: sampled properties at 1057 S Western Ave, 1 Hermann Park Ct and 10 Crawford St have no selectable lease-space rows in the current preview dataset. Universal address coverage, measured suite geometry, captured-furniture reconstruction, calibrated POS/dwell data and full furniture pricing remain unavailable.

## Verification

- Production build, lint and typecheck pass after removing the onboarding shortcut.
- Full Vitest: **2,363 passed, 45 skipped** across 290 files.
- Seven current Chromium checks pass. Controlled normal-flow cases cover both city/model identities, continuous movement, current experiment/report consistency, Jev receipt/failure behavior and affordability invalidation. Separate unmocked checks cover actual Gage and Houston SDK rendering and interior API responses. Both selected-building cases also exercise catalog editing, explicitly assumed modeled movement, review and the current final report. Neither claims measured scan placement. These are not a claim of a fully unmocked judge onboarding/comparison run.
- Actual native furniture loading/clear was separately inspected in the reference scan. Server-key bundle checks pass for the current build and privately configured credentials; credentials stay server-only.
- Local review server: `http://localhost:3036`. No push, merge or deployment.

## FDE-led Matterport interaction follow-up

The user explicitly removed the separate placement view and requested a prompt-driven “add another table here” experiment. The workspace now keeps only the Matterport canvas, concise contextual result controls and a small before/after finding. Provider model IDs, attachment paths and technical captions are removed from the selected viewer. Existing private OpenAI configuration is enabled locally for the already integrated FDE; no new service, deployment or external publication was added. Live native-prompt verification is recorded separately from the earlier controlled browser cases.
