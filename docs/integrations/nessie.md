# Nessie cash-flow integration for BizBox

Ticket: [HAC-106](https://linear.app/hackprinceton/issue/HAC-106/nessie-add-a-simulated-banking-cash-buffer-to-bizbox-comparisons). Local branch: `codex/hac-106-nessie-cash-flow`, based on `origin/main` at `2e15874`.

## Intent and approach
Akshar requested a spec, Linear ticket, and implementation after reviewing the Capital One challenge. Add a bounded, read-only sponsor banking layer to the existing site comparison. Use the existing Next.js/TypeScript/Zod stack and UI tokens; no dependencies, database migrations, auth changes, or changes to site ranking. Alternatives considered: a standalone banking dashboard would distract from the decision flow; replacing demand with mock transaction data would misrepresent the data. The manager chooses a comparison panel attached to existing modeled economics.

## Sponsor and API source
The official On-Site Hacker Handbook linked in Discord lists Best Usage of Nessie, $250 per person for first place, and https://v2.nessieisreal.com. Reference: https://docs.google.com/document/d/1sifGjJ_WePpTG7EaCPkWB89p3g1qEEyEvNmJ8Ef191A/edit . Current docs: https://v2.nessieisreal.com/docs ; machine contract: https://v2.nessieisreal.com/openapi.json (v2.1.3, checked November 14, 2026). This is mock banking, never an actual owner bank connection, sales evidence, or a CoStar data layer.

## Server contract
- GET /api/integrations/nessie optionally accepts one accountId; no project ownership mapping is claimed. This is the shared configured Nessie demo sandbox.
- Server-only NESSIE_API_KEY and NESSIE_BASE_URL (default https://v2-prod-api.nessieisreal.com). Bearer header only. Production base URL is restricted to this exact HTTPS origin, no credentials/path/query overrides. No automatic writes, seeding, settlement, or POST retries. Native fetch, no-store, bounded timeouts; safe errors without key, raw upstream body, URLs containing secrets, or stack traces.
- Key absent: HTTP 200 status unconfigured, accounts [], snapshot null, meaningful message. Configured but no cash accounts: status empty. Success: status ready, checking/savings accounts and optionally selected-account snapshot. Malformed/duplicate accountId: 422; unknown or credit-card accountId: 404; bad key/provider failure/malformed response/timeouts: safe 502/503/504.
- Public schemas live in lib/contracts/nessie.ts. Response schema NessieCashFlowResponseSchema exports type NessieCashFlowResponse. Shape: {status: 'unconfigured'|'empty'|'ready', source: 'nessie', synthetic: true, accounts: NessieAccount[], snapshot: NessieSnapshot|null, message: string}. Account shape: {id, nickname, type: 'Checking'|'Savings', balanceCents, availableCents}. No account numbers/customer PII/raw descriptions returned.
- Snapshot shape: {accountId, asOf, windowStart, windowEnd, windowDays:30, inflowCents, outflowCents, netCashFlowCents, completedTransactionCount, excludedTransfersCount, upcomingBillsCents}. All monetary fields integer safe cents (balance and net may be negative); inflow/outflow/bills nonnegative. Timestamps ISO UTC, windowEnd=asOf. Fetch selected account data only after selection.
- Traverse /accounts (100/page), /transactions (5000/page), /bills (100/page), all with documented cursor pagination. Validate upstream DTO subsets with Zod, accepting null items as empty. Bound pagination at 20 pages and reject incomplete/repeated-cursor data rather than silently truncate. Dedupe or reject conflicting transaction IDs. Reject arithmetic overflow. Honor caller cancellation and a total request deadline.
- Read-only account list excludes Credit Card because its balance is debt and available amount is borrowing capacity. No automatic account choice or ownership claim. An account must be in this key's returned list before data access.
- A 30-day snapshot includes only selected-account completed balance-medium transactions in [asOf-30 days,asOf]. Deposits, interest credits, refunds are inflows; purchases, withdrawals, bill payments, fees, chargebacks are outflows. All transfers are excluded and counted separately: internal funding is not operating revenue. Pending/declined/cancelled and rewards are excluded. Validate transaction direction with payer_id/payee_id and never include another account's transactions. Ledger flows are cash movement, not sales or profit.
- Upcoming bills: this account's pending/recurring bills with a valid upcoming_payment_date within [asOf,asOf+30 days]. Date-only values include the whole UTC calendar day at either boundary, including today. Bills use USD payment_amount: safely convert to cents. Cancelled/completed/overdue bills excluded. No double subtraction from projections.
- Snapshot output remains a read-time comparison aid, not persisted into evaluations. Explicit refresh replaces the displayed snapshot. Existing deterministic evaluation is unchanged.

## UI contract
- components/nessie/nessie-cash-flow-panel.tsx exports NessieCashFlowPanel with props { projections: Array<{siteId:string,label:string,monthlyContributionUsd:{low:number,mean:number,high:number}}>, outdated?:boolean }. components/live-comparison-workspace.tsx mounts it after the comparison screen and passes controller.payload.result.sites with candidate addresses. If no current comparison, snapshot still works but projection is unavailable; no fabricated comparison values.
- Section heading Cash buffer; visible Capital One Nessie / simulated banking label; loading, missing configuration, provider error with Retry, empty sandbox, account selection, explicit refresh, snapshot timestamp and period.
- Show available cash, last-30-day inflow/outflow/net and upcoming bills separately. Explain transfers excluded and pending payments reflected by available balance. Never describe deposits as sales or available credit as cash.
- After a current comparison exists, choose a site and enter nonnegative upfront cost in USD (default zero, explicitly entered assumption). The percentile interval need not contain the arithmetic mean. Calculate projected cash after one month = availableCents - upfrontCostCents + monthlyContributionUsd * 100 for low/mean/high, rounded to cents; allow negative result. Model scenarios, not forecasts. Show cash coverage months only for negative operating contribution; no-loss and depleted-cash are explicit states. Historical net flow and upcoming bills are context only, not matched to site costs; the projection uses available cash, entered upfront cost, and modeled contribution only. Outdated comparisons disable projection and prompt rerun.
- Pure projection math in lib/nessie/projection.ts is client safe; no imports of server client or env. Existing typography/colors/responsive classes only, keyboard labels and status announcements. Abort requests on unmount/account change; do not show a previous account's snapshot as the next one's. Refresh clears/reconciles removed accounts and old snapshots.

## Acceptance and verification
1. No key still renders the comparison and an honest unavailable panel.
2. A configured key loads only its checking/savings accounts and produces a selected-account validated snapshot from actual v2 responses.
3. Cash arithmetic and projection tests cover pending/rewards/transfer exclusion, unrelated accounts, credit cards, window boundaries, refunds/chargebacks, USD bill conversion, cursor traversal/cycles/caps, unsafe inputs/overflow, missing/bad key, malformed responses, timeout, and cancellation.
4. Browser check panel and responsive interaction; mock upstream at the HTTP boundary in tests; one live read-only smoke when key is supplied. Do not seed automatically if sandbox is empty.
5. pnpm lint, pnpm typecheck, pnpm test, pnpm build and env/client-bundle checks pass or pre-existing failures are documented.
6. Update .env.example, server secret bundle scanning policy, README setup, and this spec with ticket/verification. Never commit local .env files.
7. No push, merge, deploy, production mutation, or public publishing in this task.


## Verification record — November 14, 2026

- Branch: `codex/hac-106-nessie-cash-flow`; base `2e15874`.
- Clean baseline: 73 test files / 702 tests passed, 19 optional tests skipped.
- Completed: `pnpm lint`, `pnpm typecheck`, `pnpm test` (78 files / 750 tests passed; 19 optional tests skipped), `pnpm build`.
- Environment-file policy, public-env policy, client-bundle server-name scan, and direct emitted-client scan against configured secret values passed with no credential matches.
- Targeted browser tests: 12 passed across Chromium and mobile Chrome. Covered missing configuration, empty sandbox, provider failure/retry, account switch/races, deleted-account refresh, current/stale scenario projections, upfront-cost validation, serious/critical Axe checks, and 390/768/1440px widths. Successful banking responses in browser tests were mocked at the API boundary; they are not evidence of a live provider connection.
- Manager visually checked the real configured-key error on desktop and 390px mobile, with no horizontal overflow. Local route rejects POST with 405 and duplicate accountId with 422.
- Independent read-only review: no material findings; fresh 48 targeted tests passed.
- Live limit: the key saved by Akshar is present, but two direct v2 account reads returned HTTP 401. The actual app route translates this to a safe 503 `nessie_auth`. A successful live snapshot remains unverified until a v2-accepted key is provided; no fallback to the older API or sandbox seeding was performed.
- No dependencies, migrations, provider mutations, push, merge, deployment or publication.
