# Copilot guardrails and evals (HAC-91)

## Guardrails

`lib/agent/guards.ts` extends the HAC-24 no-invented-numbers rule to copilot chat.
Before a model reply or finding is streamed or saved, every number in it must be
grounded in something the model was actually given:

- the founder's own messages in the thread (earlier model replies never count),
- the workspace clock (`context.minute`),
- the inputs and outputs of tool calls completed in the turn (minute fields also ground
  their whole hours; cent fields ground their dollar amount).

Any other number is replaced with `[unverified number removed]`, the reply gets a short
notice, and the removed tokens are saved on the message as
`metadata.numberGuard.removed`. The turn is not retried. Identifiers such as
`scenario-3` and list markers such as `1.` are not treated as claims. Tool outputs carry
typed references rather than values, so measured values reach the founder through the
reference resolver in the UI, not through model prose.

Other guarantees are owned by HAC-83 and the scenario services, and HAC-91 tests them
(`lib/agent/guards.test.ts`):

| Guarantee | Enforced by | Test |
|---|---|---|
| Project model cost cap: no model call once the next one would exceed it | `createCopilotRuntime` ledger | cost cap test |
| Scenario run budget: over-budget runs need the founder's `confirmBudget` | `createScenarioRunner` through `run_scenario` | run budget test (real runner, `budgetUnits: 1`) |
| A model can't approve a run or the budget | strict tool schemas; runtime Run gate | self-approval part of the run budget test |
| Stale, unknown or cross-project actions can't mutate | mutation tools' scope checks; runtime proposal checks | stale/cross-project tests |
| Cancellation stops before any mutation | `signal.throwIfAborted()` gates | cancellation test |

## Eval set

`lib/agent/evals/` holds 20 scripted founder requests (`cases.ts`), each with the
expected tool calls (name, partial arguments, completed or blocked) and the expected
scenario diffs of the proposals they create. The harness (`harness.ts`) runs each request
through the real copilot runtime, the real mutation, read and run tools, the scenario
service, the preparer and the scenario runner, all over in-memory stores
(`workspace.ts`). Two Houston coffee sites open from 7:00 to 18:00 with two stations.
Nothing calls a provider.

Scores:

- **Tool-call accuracy:** the share of cases whose tool calls match exactly, in order.
- **Diff accuracy:** the share of cases whose created scenarios have exactly the
  expected changed override keys and values (and label or site changes).
- **Number-guard accuracy:** the share of cases where the guard stripped exactly the
  expected numbers.

Commands:

```sh
# Offline, scripted model (part of pnpm test and CI)
pnpm exec vitest run lib/agent/evals/evals.test.ts
# Print the offline report
PRINT_EVAL_REPORT=1 pnpm exec vitest run lib/agent/evals/evals.test.ts
# Live, against OPENAI_MODEL (paid; skipped unless both variables are set)
RUN_OPENAI_LIVE=1 OPENAI_API_KEY=... EVAL_REPORT_PATH=/tmp/live.md \
  pnpm exec vitest run lib/agent/evals/evals.live.test.ts
```

The live run sends the same requests and workspace context to
`configuredCopilotDecisionModel` and only reports its accuracy. The offline suite is the
CI gate. Following the repo's existing live tests, an `OPENAI_API_KEY` alone doesn't
enable paid calls: `RUN_OPENAI_LIVE=1` is also required.

## Report

### Scripted model (offline), November 15, 2026

- Cases: 20
- Tool-call accuracy: 100.0%
- Diff accuracy: 100.0%
- Number-guard accuracy: 100.0%

| Case | Request | Tool calls | Diff | Guard |
|---|---|---|---|---|
| open-6am-weekdays | Open at 6am on weekdays | pass | pass | pass |
| third-chair | Add a third barber chair | pass | pass | pass |
| shorter-lunch-line | Make the line shorter at lunch | pass | pass | pass |
| silver-lake | Compare with something in Silver Lake | pass | pass | pass |
| rent-10-percent | What if rent is 10% higher? | pass | pass | pass |
| counter-back-wall | Move the counter to the back wall | pass | pass | pass |
| close-8pm-weekends | Close at 8pm on weekends | pass | pass | pass |
| three-staff | Schedule three people on every shift | pass | pass | pass |
| ticket-7-50 | Raise the average ticket to $7.50 | pass | pass | pass |
| premium-tier | Try premium pricing | pass | pass | pass |
| drop-site-b | Drop site B from the shortlist | pass | pass | pass |
| add-site-c | Add the space at site C | pass | pass | pass |
| fork-lunch-rush | Save a copy called Lunch rush | pass | pass | pass |
| why-8am | Why is 8am so slow? | pass | pass | pass |
| diagnose | Diagnose my plan | pass | pass | pass |
| run-without-approval | Run that change now | pass | pass | pass |
| hours-and-station | Open at 6am on weekdays and add a station | pass | pass | pass |
| show-comparison | Show me the comparison | pass | pass | pass |
| open-30-earlier | Open 30 minutes earlier on weekdays | pass | pass | pass |
| close-hour-earlier | Close an hour earlier on weekdays | pass | pass | pass |

The scripted model returns each case's golden decisions, so this run checks the pipeline
(tool validation, scoping, approval gates, diffs and the number guard), not model quality.
A deliberately wrong scripted model scores 0%, which the suite also checks.

### Live: OPENAI_MODEL

Not run yet. This assignment didn't authorize paid provider calls. Run the live command
above with an authorized key, then paste its output here.
