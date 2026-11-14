# Hourly insights data (HAC-94)

`SiteEvaluation.insights` is optional versioned visualization data, persisted inside the existing `comparisons.evaluation` JSON. New evaluations compute it while every seed's weekday/weekend engine events are available. Existing economic metrics, simulation behavior, model version and canonical replay events remain unchanged. Legacy records are valid without insights; `insightsForSite` reports them unavailable and never reruns or fabricates bands from representative replay data.

## Statistical basis

Each day contains 24 ordered hour buckets, its actual seed count and `mode: "aggregate"`. Numeric estimates are `{ mean, p5, p95 }`: equal-weight seed observations with nearest-rank empirical quantiles, not confidence intervals. A single seed has a degenerate empirical band; it does not measure uncertainty across different seeds.

Arrival, join and balk counts use arrival time; served and revenue use completion time; reneging uses abandonment time. Waits include customers who completed service, assigned to their service-start hour. `meanWaitMin` and `p90WaitMin` each have their own seed distribution. The customer p90 within each seed/hour is distinct from the p5/p95 uncertainty band across seeds. Hours without completed wait observations remain null, with `waitObservedSeeds` indicating how many seeds contributed waits. Closed hours contain zero counts and null waits. Events at closing time follow `hourlySeries`'s final-open-hour convention.

Cumulative revenue is first accumulated within each seed, then summarized across seeds. Total `walkaways` likewise sums that seed/hour's balks and reneges before summarizing. Summing marginal p5/p95 values is incorrect because observations are correlated: two seeds with (1 balk, 0 reneges) and (0 balks, 1 renege) both have one walk-away, so the total band is [1,1], not [0,2]. Mixes and map cells likewise use zero samples for absent seed categories/cells; their means reconcile with totals, but summing their quantile endpoints generally does not.

Capacity is nominal customers per bucket: resolved station count × actual open minutes / a known configured mean service time. Partial hours are scaled; open-hour capacity is null when the mean is not retained. Input origins are nullable when not known; no founder/source origin is inferred from a naked configuration number. This formula is an input-derived capacity proxy, not guaranteed completions.

## Mix and geography

Mixes count modeled arrivals, not catchment weights or served-only customers. Kinds are resident, worker, pass-by and explicitly unknown identity. Distance uses straight-line modeled-persona location to the site, with buckets <0.5, [0.5,1), [1,3], >3 miles and unknown. These are not driving-route distances or observed customer addresses. Live assembly's existing exclusion of uncalibrated pass-by inputs is preserved.

`servedOriginMap` is geographic data, separate from source provenance. It is unavailable unless the caller supplies explicit per-seed customer origins and a local metric hex-grid frame. Only completion events count; missing customer coordinates contribute to `unmappedServed`. The hex projection is approximate and bounded to 256 cells. A finer grid exceeding that bound becomes unavailable rather than silently dropping customers. No trajectories are retained. `buildFixtureInsights` provides clearly labeled authored synthetic origin points, not measured geography or substituted persona jitter.

## Callouts and compatibility

`generateCoreCallouts` copies raw hour values without rounding: peak means maximum positive mean arrivals; quiet means minimum modeled utilization among open hours; ties use the earliest hour. Quiet is a factual comparison, not closing advice. Counts of balks and reneges are separate; dividing clock-hour reneges by that hour's arrivals would confuse different arrival cohorts. Formatting and the “Modeled, not a forecast” caption belong to the chart surface. HAC-102's station experiment is a separate optional module.

Both the evaluation schema and the UI availability adapter reject cross-site insights. The schema checks day/seed consistency and observed wait seed counts. Comparison rerun metric equality excludes this additive visualization field so enriching a legacy result still reports unchanged economic metrics as reproduced. There is no database migration, new endpoint, service dependency or automatic backfill.
