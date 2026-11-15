# BizBox consultant integration with Capital One Nessie

Ticket: [HAC-106](https://linear.app/hackprinceton/issue/HAC-106/nessie-add-a-simulated-banking-cash-buffer-to-bizbox-comparisons). Review: [PR #86](https://github.com/Samprab06/BizBox/pull/86). Branch: `codex/hac-106-nessie-cash-flow`.

## User-visible behavior

Nessie is a tool the consultant can use during an investigation, not a separate banking form. For a cash-buffer or site-affordability question, the consultant calls `read_nessie_cash_buffer`, receives validated mock banking evidence and, when a current site comparison is supplied, a server-calculated cash scenario. A read-only card appears within **Consultant activity** after the completed tool step. The user never puts a key or Nessie-specific command in their prompt.

The earlier standalone comparison panel was removed following Akshar's clarified workflow. Its provider client, cash-flow arithmetic, projection math, HTTP diagnostics and tests are reused. No changes to demand, site ranking, existing evaluation costs, authentication, database schema or deployment policy.

## Sponsor and provider

The official [On-Site Hacker Handbook](https://docs.google.com/document/d/1sifGjJ_WePpTG7EaCPkWB89p3g1qEEyEvNmJ8Ef191A/edit), linked in HackPrinceton Discord, lists Best Usage of Nessie and $250 per person for first place. Its resource is [Nessie v2](https://v2.nessieisreal.com). This is a shared mock banking sandbox, not an actual owner's bank connection, measured sales evidence, financing approval, or a qualifying CoStar data layer.

Provider contract checked November 14, 2026: [v2 documentation](https://v2.nessieisreal.com/docs) and [OpenAPI JSON](https://v2.nessieisreal.com/openapi.json), version 2.1.3.

## Configuration and provider client

- `NESSIE_API_KEY` is server only. Obtain a v2 key with GitHub sign-in at https://v2.nessieisreal.com/account and put it in ignored `.env.local`.
- `NESSIE_BASE_URL` defaults to `https://v2-prod-api.nessieisreal.com`. Only that exact HTTPS origin is accepted; credentials, alternate paths, query strings and fragments are rejected. Keys travel in an Authorization Bearer header, never in query parameters or client code.
- The app/consultant client uses native read-only fetches with no-store, no redirects, a total deadline and caller cancellation. This runtime client performs no seeding, account creation, settlement, payments, resets, automatic writes or POST retries.
- Traverse `/accounts` at 100/page, `/transactions` at 5000/page and `/bills` at 100/page. Validate DTO subsets with Zod; null item arrays mean empty. A 20-page limit, repeated cursor or conflicting duplicate IDs fails explicitly rather than silently truncating financial data.
- Return sanitized errors, never raw provider response bodies, keys, account numbers, customer PII or transaction descriptions. Missing configuration, empty data and provider errors are explicit states, never fabricated zero cash.

## Cash evidence and scenario meaning

Checking and savings accounts are eligible. Credit cards are excluded because their balance is debt and their available amount is borrowing capacity. With exactly one eligible account, the tool explicitly identifies it as the sole available demo account. With multiple accounts and no ID, return a selection question and safe choices. Never sum accounts or claim their ownership. Any supplied ID must be in the configured sandbox's returned list.

The snapshot includes selected-account, completed, balance-medium transactions in the inclusive UTC interval `[asOf - 30 days, asOf]`. Deposits are attributed to payee; all other non-transfer postings use payer, per v2. Deposits, interest credits and refunds are inflows; purchases, withdrawals, bill payments, fees and chargebacks are outflows. Transfers are excluded and counted separately. Pending/declined/cancelled transactions and rewards are excluded. Available cash already reflects pending holds. Cash movement is not sales or profit.

Upcoming bills include this account's pending/recurring records due in the next 30 days. Date-only values include the whole UTC calendar day at either boundary, including today. Timestamp values use exact instant bounds. Bills use dollar `payment_amount`, converted to safe integer cents. Cancelled/completed/overdue/invalid-date bills are excluded. All financial arithmetic rejects unsafe cents and aggregate overflow.

With a valid stored comparison/site, the tool derives upfront buildout from `evaluation.request.sites[].config.lease.buildoutUsd`, not a founder budget or model-supplied amount. Monthly operating contribution comes from that site's `evaluation.result.sites[].monthlyContributionUsd` before buildout amortization. One-month cash = available cash minus modeled upfront buildout plus modeled monthly operating contribution. Low/high are scenario percentiles; the arithmetic mean may lie outside them. Coverage is cash after buildout divided by mean modeled loss only when that loss is negative. Depleted cash and no modeled loss are explicit states. Recent cash flow and upcoming bills remain context only; they are not matched to site costs or deducted again. These are conditional scenarios, not forecasts.

## Consultant tool and durable contract

- `InvestigationToolSchemas.read_nessie_cash_buffer` accepts optional `account_id` and paired optional `comparison_id`/`site_id`. It accepts no balances, contribution values, costs, arbitrary URLs or keys.
- `lib/nessie/consultant.ts` supplies the server-only reader. `lib/agent/tools-postgres.ts` binds it into the actual configured investigation runtime. Tool execution, planning, findings and UI use the existing registration and checkpoint flow.
- A site scenario must use a comparison produced by this investigation's current attempt after its latest saved profile. Stored request/result project, profile/version, comparison and site identities must agree. Foreign, stale or missing comparisons return a safe limitation without a cash recommendation.
- `NessieConsultantResultSchema` / `NessieConsultantResult` in `lib/contracts/nessie.ts` validates saved output. It includes kind `nessie_cash_buffer`, source `nessie`, synthetic true, investigation/attempt/project/profile identity, status/message, safe account choices, nullable selected account/snapshot, and nullable scenario with comparison/site IDs, modeled upfront buildout, contribution interval and cash projection.
- Missing key, empty sandbox, provider errors, invalid/ambiguous accounts and stale comparisons are nonfatal financial limitations. They do not fail an otherwise useful location investigation or establish affordability.
- The planner allowlist/instructions expose this tool for cash/affordability/financing questions. Site affordability requires evaluated site evidence first. The tool uses the existing durable step budget, argument validation, input hashing, duplicate-step guard, resume and cancellation. No expanded filesystem/delegation permissions, budget or paid-provider limits.
- Only completed, typed, current-attempt/profile banking output may be used as evidence. Newest Nessie evidence supersedes prior account questions/cash claims in model context, displayed notes and the grounded-plan handoff. Retry preserves unrelated findings but drops superseded banking findings. Historical milestones remain durable; they are not active financial guidance.

## Consultant UI and public diagnostics

`components/ConsultantPanel.tsx` retains milestone summaries, validates job identity and renders `components/nessie/consultant-cash-card.tsx` using the newest scoped tool result. `consultant-results.ts` filters identity, attempt, latest save_profile, preceding evaluation and malformed/foreign output. Old investigation responses cannot overwrite the active one. Outdated/running comparison context suppresses financial guidance and prompts rerun; a valid consultant-owned scenario can display without an unrelated external comparison.

The card shows simulated-source labels, the assessed demo account, available cash, recent inflow/outflow/net, upcoming bills and snapshot time. Scenario evidence adds the assessed site/comparison, modeled upfront buildout, cash after one month with interval, cash coverage and an explicit scenario limitation. Missing/empty/error/selection states are read-only consultant findings. There are no standalone account/upfront controls or direct browser Nessie calls.

Consultant activity is mounted once in the shared comparison workspace for live and example routes, using the existing investigation URL context. Existing polling/advance/retry behavior, design tokens, responsive layout and evidence labels remain.

`GET /api/integrations/nessie?accountId=...` remains a read-only integration diagnostic: absent key returns200 unconfigured; no cash accounts returns200 empty; ready accounts/optional snapshot returns200; malformed/duplicate ID422; unknown/credit-card account404; provider failures use safe502/503/504. The HTTP diagnostic performs no default account selection and returns no ownership assertion. The consultant uses the server reader directly rather than making a browser or loopback request to this endpoint.

## Verification and known limits

- The original panel iteration passed lint/typecheck/build, 750 tests with 19 optional skips, 12 browser tests, secret scans and independent review. It was revised because Akshar clarified that Nessie belongs in the consultant tool flow.
- The original old-format key returned 401. Akshar replaced it with a v2 key; direct account reads and the actual app route returned 200 with an empty sandbox. Authentication and empty live data are verified. No populated live snapshot or live paid model execution is claimed; no seeding was performed.
- Consultant revision acceptance: scripted financial question -> real tool registry/provider transport -> durable milestone -> checkpoint/resume without duplicate read -> grounded numerical findings; scoped comparison and missing/error/account cases; saved UI evidence with stale-note/attempt/profile/identity handling; no direct banking fetch or standalone form; responsive/accessibility browser checks; full four repo checks and secret scans. Final results recorded after integration below.
- No PR merge or deployment is authorized. Akshar approved revising the existing PR; retain its explicit do-not-merge instruction.

### Consultant revision verification — November 14, 2026

- Checked against current main at `b871537`; resolved only the overlap in comparison activity placement and server-env scanning, preserving upstream Jev labels and Matterport token policy. No target-branch PR merge occurred.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` passed. Full suite: 97 test files / 928 tests passed; 35 optional tests skipped. The build retains an upstream warning in `lib/panel/recorded-example-loader.ts` about dynamic filesystem tracing. No local env files appeared in server trace manifests.
- Production-build browser checks: 32 passed across Chromium and mobile Chrome, including existing consultant polling/retry behavior, saved/scoped results, newest-only evidence, stale accumulated notes, old attempts/profiles, outdated/running comparisons, investigation races, a11y and 390/768/1440px widths. No standalone banking form or direct browser Nessie request.
- Scripted model/provider transport verification exercised actual tool registration, real cash/projection arithmetic, durable milestones, cutoff/resume without repeated provider fetch and numerical grounded-plan findings. No live paid-model calls.
- Independent review's two stale-evidence findings were reproduced in failing tests, fixed, and re-reviewed with no remaining material findings. Fresh manager targeted check: 87 tests passed before latest-main integration; final full suite and browser checks passed afterward.
- Actual new server consultant reader, using the saved v2 key, returned typed `empty`, source `nessie`, synthetic true, zero accounts, no snapshot/scenario. No populated live data or owner bank connection is claimed.
- Environment-file/public-env/client-bundle scans passed, with zero configured-secret byte matches in emitted client assets. Secrets remain ignored. No provider writes/seeding, migrations, added dependencies, deployment or PR merge.

## Guarded sandbox seed follow-up

Sam's Lead requested a minimal, idempotent demo seed on HAC-6 comment 9acc8334-fc1c-4ee9-807b-9303d74129d4; Akshar asked this chat to recheck and carry out the remaining work. The follow-up is limited to the named mock-data setup; merge, deployment and remote secret configuration remain separate.

Optional activity: add `--with-activity` (`pnpm nessie:seed --confirm --with-activity`) to also create a fixed set of fictional deposits, purchases (at one `BizBox Demo Supplier` merchant) and bills so the cash card shows non-zero flows. It writes only to a demo account with no existing transactions or bills (otherwise it reports `skipped_existing` and writes nothing), because the provider has no idempotency token. Deposits are cash movement, not sales, and purchases lower the account balance. `--dry-run --with-activity` prints the plan offline.

`pnpm nessie:seed --dry-run` prints the offline plan without using a key or making requests. `pnpm nessie:seed --confirm` is a manual-only CLI: it refuses missing confirmation, CI execution and alternate provider origins. It creates or reuses one dedicated fictional BizBox customer and one checking account named `BizBox Demo - simulated funds`, initially funded with 5,000,000 cents ($50,000 explicitly simulated). It never resets or tops up an existing account, modifies other accounts, retries an uncertain POST, or runs from the app/build/CI. Repeat invocations re-list and reuse the exact demo records; ambiguous duplicates fail without guessing. Concurrent cross-machine execution cannot be made atomic without provider idempotency support, so run one controlled invocation at a time.

The CLI loads the existing ignored local env, uses Bearer auth, validates paginated reads and created responses, and outputs the account ID/reuse status without credentials or account numbers. Partial creation or an uncertain network response is recovered by re-listing on the next explicitly confirmed run, not by blindly repeating a POST. Tests use injected transport and fake data only. No private key is posted.

Oracle server and Vercel Production credential setup remains a separate action for Sam or Akshar, privately and with explicit approval. The script does not distribute secrets. PR #86 stays unmerged pending Akshar's explicit merge approval.

### Seed verification — November 14, 2026

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` passed on the follow-up: 98 test files / 941 tests passed, 35 optional tests skipped. The same inherited recorded-example-loader tracing warning remains.
- All 13 seed tests and focused independent review passed. Actual offline dry-run reported zero requests; `CI=true` confirmed execution refused before loading credentials or making provider requests. The seed is absent from app/build/CI invocation paths.
- Ran `pnpm nessie:seed --confirm` exactly once. It created the dedicated fictional customer and checking account `acct_01m7dq1910qhas6jq1qw173aza` with 5,000,000 cents ($50,000 simulated). No existing balances were reset or topped up; no transactions or bills were created.
- The actual server consultant reader then returned `ready`, `source: nessie`, `synthetic: true`, one eligible account, 5,000,000 available cents and a validated snapshot. Its transaction count/inflow/outflow/upcoming bills are zero, matching the newly created account. No site comparison was supplied to this read-only smoke, so scenario was null; the stored-comparison scenario path remains covered by the existing workflow/browser tests. No live paid-model execution is claimed.
- Environment-file/public-env/client-bundle checks passed. Consultant UI behavior is unchanged from the 32 passing browser checks above. Oracle/Vercel private key setup remains with Sam or Akshar; no remote secret configuration, deployment or PR merge was performed.
