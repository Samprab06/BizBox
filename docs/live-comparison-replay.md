# Live comparison and replay (HAC-57)

The comparison view reads the completed browser intake and the same site search
as the map. The founder can deselect candidates and explicitly chooses **Run
comparison**. Viewing the screen does not save snapshots or start model calls.
The browser saves a profile through `POST /api/profiles`, then submits its returned
ID and selected candidates to `POST /api/comparisons`.

`GET /api/comparisons/capabilities` reports only whether Jev is configured. An
explicit run requests Jev when configured; otherwise it uses Huff. A failed
capability check also chooses Huff. The result displays the actual demand source
and fallback reason, seeded contribution/revenue/customer/queue ranges, ties,
findings and numeric assumptions with origins. Sensitivity calls the existing
comparison endpoint for rent ±10%, ticket, market share or price and shows ranking
changes and the break-even point. These are scenario ranges, not a sales forecast.

`sitework:comparison:v1:<projectId>` stores the active comparison identity and the
serialized intake signature used for its snapshot. Reload and replay use the
stored comparison through its project-scoped GET endpoint. A changed local intake
or the server's `outdated` flag marks the result outdated; returning to the page,
focusing it or receiving a cross-tab storage event refreshes that check. New
comparisons still require the founder's explicit action. Replay links also carry
the comparison ID, selected site and weekday/weekend, so they work when browser
storage cannot save the active ID.
Completing a new run updates the comparison permalink. Sensitivity results are
owned by their comparison ID; switching comparisons clears them and rejects late
responses from the previous comparison.

`GET /api/site-runs/<encoded run ID>?projectId=...` returns a validated canonical
`SiteRun`, selected by both project and run ID. Cross-project/missing runs return
404, malformed input returns 422 and source failures return a generic 503. Both
new read endpoints use `Cache-Control: private, no-store`.

Replay uses the selected site's stored representative weekday/weekend run and
its hourly statistics. Canonical `served` starts service; `departed` completes it.
Concurrent service determines labelled schematic lanes. The player does not
invent station geometry, persona decisions or stay probabilities absent from the
stored events. Its time window comes from hourly rows and actual event bounds,
not an inferred claim about exact founder opening hours.

Without a completed intake, or on unavailable comparison/run APIs, the existing
fixtures remain available with explicit **Example data** labels and retry paths.
A successful empty site search remains an empty result. Failed sensitivity keeps
the valid comparison and presents an inline retry. Live API identity mismatches
are rejected rather than displaying another project's profile, comparison or run.

Unit tests cover the request ordering, selection bounds, saved identity, canonical
replay semantics and scoped run API. Browser tests mock all source/comparison/run
APIs and exercise live/example modes, progress, sensitivity, stale results,
weekday/weekend playback, responsive layout, keyboard and accessibility. No live
paid requests or hosted database writes are needed for verification. Production
acceptance follows deployment by the team lead.
