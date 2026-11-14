# Station experiment UI

The existing Insights panel places the selected station recommendation beside its
peak/quiet callouts. The backend chooses the highest positive mean added monthly
revenue among tested alternatives with added effective stations; ties use fewer
added station-hours, then stable ID. The UI does not rank candidates or infer an
equipment purchase cost. A revenue winner can reduce contribution, and that
negative contribution remains prominent beside revenue.

## Sources and presentation

`StationCallout` consumes the lightweight shared summary contract. It renders the
helper's raw mean in HTML data elements and displays mean/p5–p95 revenue and
contribution, without clamping negative values. Planned and effective stations,
staff count, both whole-day hour ranges, station-hours capacity proxy and actual
helper staff-hours remain separate. Computed outcomes carry Simulation badges;
recorded input origins map through the existing evidence adapter. The proposed
+1/+2 station and staff increments are labelled assumptions.

Whole-day settings do not imply a 7–10am staffing window. Walk-away changes count
balked plus reneged customers and are shown separately in the evidence disclosure;
additional revenue includes all extra completed services. The selected-day metric
always names its own weekday/weekend tag. Monthly results are not a sales forecast
or confidence interval, and do not claim maximum profit.

The site server page forwards only that site's static, offline-generated fixture
summary from `lib/insights/station-experiment-fixture.ts`. It uses the same 12
paired schedules/configuration as the adjacent authored charts and changes the
staff count with the station increment. The UI never generates fixture numbers,
imports the engine, or runs the experiment during rendering. Weekday/weekend
changes select their corresponding static summary without any POST.

## Explicit, resumable execution

Live site Insights and the open saved-city drawer mount `StationCalloutController`,
including saved records whose older chart aggregates are unavailable. The one-day
simulator example keeps its explicit unavailable state and starts no controller.
It reads GET `/api/projects/{projectId}/station-experiments` for the selected
comparison/site and fixed weekday tag. Reading a plan, opening a drawer, changing
focus and changing chart days cannot execute configurations. The recommendation
is monthly and stays independent of the chart-day toggle.

The controller displays each returned configuration's whole-day settings, actual
status, cached marker and simulation budget cost units. An explicit Run may
sequentially POST baseline/+1/+2 while each previous configuration succeeds and
the next remains planned. Each POST names exactly one configuration. A queued or
running partial job stops the sequence and offers explicit Continue. Confirmation
stops the sequence, retains completed progress and shows the backend's real next
cost/remaining units; Confirm authorizes that configuration only. A later option
can require its own confirmation.

The batch is not atomic: baseline may have completed before another option needs
confirmation or fails. A failed/unverified HTTP write retains known progress and
requires explicit GET reconciliation before continuing. A 70-second response
deadline enters this unknown-status state without aborting the write; late
responses cannot overwrite recovered progress. No automatic retry or
polling write occurs. Writes have no abort signal: navigating away is not
represented as cancelling or refunding reserved work. Read requests abort on
unmount/source change. Generation checks discard obsolete write responses and
prevent subsequent configurations from starting for an abandoned source.

Source validation checks original comparison/project/site/profile and seed
identity and known synthetic/model-version provenance, confirmation/progress consistency and the selected result against its
new evaluated baseline and alternatives. Original source comparison and newly
evaluated baseline IDs remain distinct. Saved Huff fallback, outdated profiles
and unknown freshness stay visible, including inside the city modal.

## Verification

Meaningful unit tests began red before the card/client existed. They cover exact
helper values and negative contribution, sequential execution, per-configuration
confirmation, partial/failed stopping, source invalidation and malformed response
identity. Browser fixtures compute real evaluator/helper outputs offline; product
code never uses those test fixtures as fallback data.

Browser checks exercise authored summaries at 375/768/1280 px on paper/viewport,
keyboard disclosure and confirmation, reduced motion, axe, console/page errors,
no horizontal overflow, exact raw values and no automatic model writes. Live
fixtures exercise completed baseline + confirmation + partial continuation,
failed-write reconciliation, unavailable/unknown freshness and mismatched source
rejection. Screenshots use `/tmp/hac102-station-{width}-{surface}-{browser}.png`.
Final full checks and the browser matrix are recorded in the manager handoff.

Final local packet:54/54 browser cases passed on functionaldd449b6; full integrated suite1015 passed/40 gated skips, lint/frozen-lock/migration/env guards pass. Copy-only57cb0d0 passed focused SSR/lint/9tests, then required typecheck/build/public-env/client guards. Manager reviewed mobile negative contribution and live confirmation screenshots. Later dependency merge changes only documentation; no runtime edit follows those checks. GitHub CI and hostedDB verification are not inferred from these local results.
