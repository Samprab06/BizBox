# Grounded location plans (HAC-24)

`buildLocationPlan` in `lib/agent/plan.ts` renders an immutable profile snapshot
and its saved HAC-22 comparison. It needs no model configuration or provider
credit. It checks project, profile/version, comparison and run scope before
rendering. Outputs are scenario recommendations, **not sales forecasts**.

## Read a plan

```text
GET /api/comparisons/<comparisonId>/plan?projectId=<projectId>
GET /api/comparisons/<comparisonId>/plan?projectId=<projectId>&investigationId=<investigationId>
```

This read-only endpoint loads existing scoped artifacts; it does not poll Jev,
invoke OpenAI, create comparisons, or persist new rows. An investigation ID must
own the comparison through a verified `evaluate_sites` milestone for its latest
successful profile snapshot and current attempt. Foreign or unresolved artifacts
fail instead of becoming plan claims. Invalid requests return the existing
structured API errors; database errors do not expose stored/private payloads.

The additive `GroundedLocationPlanSchema` wraps the existing canonical
`LocationPlanSchema` unchanged:

- `plan`: canonical compatibility payload with conditional recommendation,
  source comparison citation, conditions and next steps;
- `status`: `recommended`, `tie`, `no_site_meets_budget`, or `budget_unknown`;
- `runnerUpSiteId`, `tiedSiteIds`, and cited `why` intervals for each site;
- `leaseTargets`, `staffingAndStations`, `buildoutBudget`, `firstNinetyDays`;
- `assumptions`: every saved assembly assumption and profile assumed value,
  plus otherwise untracked numeric/qualitative evaluation inputs conservatively marked
  `default`; each has a related sweep result or an explicit `not_tested` result;
- `sensitivity`: tested ranges and adjacent tested flip brackets, not an exact
  interpolated break-even promise;
- `findings`: source limitations and verified tool findings, each anchored to
  the scoped comparison; `demand`: requested/actual source, fallback reason and
  full-ranking Huff agreement;
- `facts`: server-owned reference registry; `narrative`: absent by default.

Every numeric fact has a comparison/metric reference, range, units, origins and
available evidence IDs. Forecast-like metrics expose saved low/high intervals,
not mean point forecasts. Equal input bounds represent known scenario settings
(such as a staff count or lease term), **not predictive confidence intervals**.
Do not display an input as a forecast. Missing evidence remains unknown, not zero.

Budget screening applies supplied rent, buildout/startup and modeled monthly
operating ceilings. The operating screen conservatively uses upper-bound COGS
with scenario lease and labor cost. It is **not** proof of complete startup
affordability: deposits, financing, permits, contingency and working capital are
not modeled. This limitation stays in findings. A tied result has no decisive
canonical recommended site. If no budget is supplied, no lease recommendation
is issued.

Related sensitivity is not an independent test of every contributing input.
Defaults without an applicable sweep stay `not_tested`, never implicitly robust.
For Jev-primary comparisons the builder runs the seeded Huff-only evaluator from
saved inputs locally, with no provider calls. For Huff-primary/fallback results,
`huffAgreement` is `not_independent`: agreement with itself is not corroboration.

## Investigation handoff

The configured planner finalizes `finish_investigation` deterministically, saving
the payload in `summary.output.locationPlan` through the existing checkpoint JSON.
No new database table or migration is needed. Missing evaluated comparisons leave
the existing explicit missing-input handoff intact. Finalization errors fail the
step instead of saving an ungrounded plan; abort signals are honored around reads.
Budget-exhausted/missing-input jobs can still be read through the plan endpoint
when an eligible saved comparison exists.

New business milestones retain `summary.toolFindings` separately from
`summary.modelFindings`. Plans read only verified tool findings and structured
assembly findings. Legacy mixed `job.findings` and finish/model prose are not
promoted into grounded claims. Artifact selection ignores other attempts and
stale profile snapshots.

## Optional narrative

`annotateLocationPlan(plan, invoke)` is explicit opt-in. The provider-agnostic
adapter supplies only approved templates and a reference inventory. Responses
must use the closed `PlanNarrativeSchema` vocabulary and registered references;
arbitrary prose, numeric fields, digit/spelled-out numbers, unregistered metrics,
namespace swaps and foreign artifact IDs fail. The server resolves references
with `resolvePlanReferences`, never model-authored values or arbitrary object
paths. Failed annotation does not mutate the deterministic plan.

Offline scripted-model tests cover valid annotations and rejection cases.
The bounded live test runs **only** with both `RUN_LIVE_PLAN_NARRATIVE=1` and
`OPENAI_API_KEY`; it is skipped in normal CI. No live call is needed for plans or
for ordinary verification. No additional production environment variable is
introduced.
