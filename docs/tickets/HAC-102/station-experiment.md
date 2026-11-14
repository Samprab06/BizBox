# Station experiment summaries (HAC-102)

`summarizeStationExperiments(input, dependencies?)` consumes completed HAC-79
`ExperimentResult` observations and returns unranked `StationExperimentCallout[]`.
It imports the existing `experimentDelta` and `summarize` functions, which can be
injected for deterministic verification. It never invokes `runExperiment`.

```ts
type StationExperimentInput = {
  baseline: readonly ExperimentResult[];
  alternatives: readonly {
    id: string;
    results: readonly ExperimentResult[];
  }[];
  origins: readonly Origin[];
};
```

Ownership is `lib/insights/station-experiment.ts` and its tests. HAC-94 owns core
callouts, frontend owns mounting, and the manager owns their integration. This
adapter starts no simulation, worker, provider call, persistence or budget change.
Callers must supply already computed fixtures or results obtained through the
existing approved execution boundary.

Each result includes `siteId`, `dayType`, the whole-day baseline/alternative station
and staff settings, unrounded `MetricSummary` values for monthly revenue,
contribution and walk-away change, and a separate displayed-day walk-away summary.
`source` contains `mode: "aggregate"`, seed count, sorted seed IDs and
`outputKind: "simulation"`. Supplied origins are copied without inferring new ones.
Added station-hours and helper staff-hours are signed alternative-minus-baseline
values. Alternative order is preserved and carries no preference or ranking.

All samples in a baseline or alternative must share one setting and input model
apart from their seed. Paired alternatives may change only planned station count
and staff headcount. Site, displayed day, exact seed set, price, opening hours,
demand inputs, calendar, geometry/capacity policy and other costs must match.
Arrival workload checks compare customer IDs, arrival times, service inputs,
random stay draws and input stay curves. Queue-dependent arrival decisions,
stay probabilities, service starts and other output events are not compared.
Monthly points must match helper economics computed from the completed day
metrics; marginal range objects and non-finite observations are rejected.

Contradictory, missing, duplicate or unknown seed data throws `RangeError` with a
safe diagnostic. Empty/single-seed data returns no variants because a range is
unavailable. Identical outcomes, capacity-clamped changes and staff-cost-only edits
are suppressed. Neither validation nor summarization mutates caller inputs.

The label is **Modeled additional monthly revenue** and the caption is **Modeled,
not a forecast**. Revenue is the helper's total monthly revenue difference, not
revenue attributed exclusively to recovered balked or reneged customers. Monthly
net walk-away change is the separate weekday/weekend balked-plus-reneged delta,
weighted once by the configured calendar. Customers unfinished at closing are
excluded from that walk-away count.

The helper supports whole-day station and staff counts. No 7–10am staffing window
is inferred. Added station-hours is an operating-capacity proxy, not dollars or
labor hours. Actual staff-hours change comes separately from helper economics;
the engine does not bind station capacity to staff count. Station purchase costs
are unavailable.

At least two unique paired seeds are required for an empirical p5–p95 range.
Single representative runs and marginal ranges cannot supply one. Paired
differences are summarized before percentile selection, without rounding or
clamping. Input origins must be supplied; computed outcomes remain simulations.

Ranking and a cheapest winner await the lead's decision. The initial adapter
exports numeric variants without choosing a recommendation. The HAC-94 optional
station mount remains dependent on an approved selector and paired result data.
The host should consume these summaries outside rendering and use its existing
worker boundary if handling large completed workloads exceeds the existing
50 ms interaction budget.

Targeted tests exercise real HAC-79 helper outputs over four paired seeds, exact
nearest-rank summaries, calendar weighting, separate station/staff resource
changes, capped/no-op suppression, mismatched inputs, unknown/marginal seed data,
non-finite values, supplied origins, dependency injection and input immutability.

Verification on the HAC-79 base `1fb0347`: 18 targeted adapter tests passed; the
full suite passed with 778 tests and 19 skipped using one worker. Whole-project
lint, typecheck, production build and `git diff --check` passed. These checks
verify the completed-result adapter, not a mounted end-to-end recommendation.

HAC-102 acceptance remains incomplete pending the lead-approved selection
objective, a caller supplying comparable paired observations, and the optional
HAC-94 UI integration. No cheapest winner or automatic experiment execution is
implemented in this change.
