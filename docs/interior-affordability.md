# Reviewed interior sandbox affordability

`POST /api/projects/[projectId]/interior-affordability` reads the existing Nessie consultant integration for an exact selected-site experiment. It accepts comparison/site identity, baseline/proposal drafts, the current run/review revision, optional signed Jev policies/receipt, and an optional returned sandbox account ID. It never accepts balances, purchase prices, contributions or model-authored financial results.

`assessInteriorAffordability` loads the owned stored comparison, verifies project/site/profile/city/category and current profile version, recomputes the spatial experiment, and verifies any Jev receipt and claimed scan binding before reading Nessie. Existing `createNessieConsultantReader`, typed accounts/snapshots and `projectCashBuffer` handle banking. No account creation, seeding, payment, transfer, provider write or database mutation occurs.

The response's SHA-256 fingerprint binds the exact input snapshots and account choice. The client must invalidate it on edits, new runs/reviews, site/comparison/policy changes and account changes. Finalization re-reads the assessment so a changed canonical stored cost or sandbox balance cannot be exported merely from a previous browser snapshot. `assessedAt` identifies the read time. The internal consultant result uses a deterministic `interior-assessment-<fingerprint>` request identity; it does not claim a persisted investigation job exists.

## Accounting

- Stored `SiteEvaluation.monthlyContributionUsd` is operating contribution **before** buildout amortization. It includes COGS, labor, rent and opex. `monthlyContributionAfterBuildoutUsd` is a different field and is not used here.
- The base cash projection subtracts stored modeled upfront buildout once and applies stored monthly operating contribution once. Historical cash flows and upcoming bills remain context, not additional deductions.
- The reviewed spatial engine has its own synthetic arrivals. Its contribution difference is shown per modeled operating day, separately from the exterior monthly projection; it is not multiplied and added to an unrelated demand model.
- For a stored calendar with zero weekend operating days, a separately labeled proposal scenario repeats the reviewed spatial weekday over the stored weekday count. Existing `computeMonthlyEconomics` applies edited hours/staff/wage/COGS and stored lease/calendar inputs. It uses operating contribution before amortization and subtracts known upfront buildout once through the existing cash helper.
- With weekend operating days, no proposal monthly projection is produced because this spatial experiment has no separate weekend outcomes.
- Proposed furniture prices and incremental counter/equipment installation costs are unavailable. They are listed as missing, never assigned zero or invented. `completeAffordability` is always false; these partial scenarios cannot establish a complete startup budget, purchase ROI, or financing approval.

## Availability and verification

Nessie remains shared **simulated sandbox funds**, not a real bank connection or proof of the founder's account ownership. Unconfigured, empty, provider-error, account-selection-required and account-not-found statuses reuse the existing contracts; unavailable states contain no cash guidance or proposal projection. Multiple accounts are never summed or silently selected.

Current-task private discovery found an already configured Nessie key/base URL in the existing `nessie-cash-flow` worktree. A bounded read-only smoke using the existing consultant reader returned `ready`, one checking/savings account, and a snapshot. No keys, account identifiers or balances were printed and no writes were made. The manager owns copying only those two authorized values to the current ignored local environment; secrets are not committed.

Verification: targeted tests cover pre-amortization accounting, one-time capex, unknown catalog costs, exact version fingerprints, stale/foreign scope rejection before sandbox access, weekday-only proposal projection, honest missing configuration, safe errors, cancellation propagation and rejection of browser/model-authored money fields. This is a scenario comparison rather than a sales forecast.

## Integrated client/FDE/report path

The selected-site stage can request the read-only assessment only after a current run and review. The FDE's `read_interior_affordability` tool accepts site/account selection only; its server port calculates the assessment and queues a scoped screen action. A local model cannot author balances, cash projections or known purchase prices. A furniture/layout/operating edit, new run, policy or source change clears the assessment. Asynchronous responses must still match the exact project/comparison/layout/policy/review fingerprint.

Finalization re-reads the assessment from canonical sources and Nessie before including it, and the outer full-snapshot guard rejects results completed after an intervening edit. The final report includes the assessment's exact version, source, periods and missing costs. Nessie figures are simulated sandbox funds, not a real bank connection. Configuring the existing sandbox credential is sufficient; no seeding or provider writes are performed.
