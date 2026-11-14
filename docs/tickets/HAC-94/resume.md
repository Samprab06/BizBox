# HAC-94 resume handoff

Outcome: implemented and verified locally, still In Development because no new-ticket publication approval/PR is assumed. No remaining confirmed code-review findings. User requested issue handoffs without granting additional push/merge/deploy approval.

Branch: `hac-94-sim-10-customer-insights-peak-hours-dash`.
Worktree: `/Users/aksharkakkad/.codex/worktrees/hac-86-typed-layout/HackPrinceton` (reused name; original HAC-86 branch preserved and merged through PR76).
Source: `c0ec85db58b4f7b18fd0b8b01c96a283e10600a4`; subsequent commit only records this delivery evidence. Core checkpoints ee5a764,6b5ceb2,420b397,8c5de74,cd81437,34ba769,c0ec85d include approved API and simulator foundations. Current parent topics: HAC-81 PR85 and HAC-71 PR88 (which is stacked on HAC-70 PR79).

Surfaces: optional versioned SiteEvaluation.insights; true all-seed hourly/cumulative/combined-walkaway aggregates; factual peak/quiet callouts; bounded explicit-origin hex maps; pure runtime model and separate authored fixture builder; Recharts charts/tables; site fixture and canonical GET-only saved-data mount; lazy native city drawer via existing Neighborhood controls/fallback. No scene rewrite, database migration, auth change or automatic model run.

Checks on c0ec85d: lint/typecheck/build;945 tests passed,40 gated skips; frozen lock and supply-chain checks; env/client guards; migration-chain and diff checks.27 browser cases pass across Chromium/WebKit/mobile. Logs `/tmp/hac94-c0ec85d-*.log`; screenshots `/tmp/hac94-evidence/`. Independent backend and manager source review complete. Only inherited warning: recorded-example-loader dynamic filesystem tracing.

Limitations: actual served-origin geography is unavailable without explicit sampled origins; legacy representative runs do not supply seed bands. Simulator fixture has one seeded day, so its drawer reports unavailable; actual site fixture displays a separately labeled12-seed example. Stored-city DB path is covered by seeded-record server-boundary and modal-warning tests, while actual site GET/browser flow and actual city unavailable/native controls are browser-tested. HAC-102 station recommendation is separate and awaits a lead decision.

Resume:
1. `cd /Users/aksharkakkad/.codex/worktrees/hac-86-typed-layout/HackPrinceton`; `git status --short`; `git log -1`.
2. `agentorch board unread`; `agentorch ticket show HAC-94`; inspect PR85/88/79 states with `gh pr view` before choosing the eventual base. Do not overwrite another chat's branch.
3. Obtain Akshar publication approval for this new ticket if none has arrived. Present current exact delivery/base; do not infer it from the handoff request. Publish a small stacked PR only after its API/simulator bases are aligned; preserve full reviewed behavior when resolving dependencies.
4. If source changes, rerun the four pnpm checks and `pnpm exec playwright test tests/e2e/insights.spec.ts` against an owned local production/dev server for Chromium/WebKit/mobile. No hosted database or paid provider is necessary for those checks.
5. After an authorized PR: `agentorch ticket done HAC-94 --pr <url>` and post the scoped DONE/CONTRACT handoff. Keep it open until that real PR handoff.
