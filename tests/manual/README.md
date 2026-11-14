# Manual scripts for computer-use agents

Some checks Playwright can't do well: 3D canvas visuals, native file viewers, open-ended
LLM conversations. For those, a human runs a **computer-use agent** (for example Claude's
computer use in the desktop app) from a written script kept in this folder, one file per
screen or journey, named `<screen>.md`.

## Script template

Copy this into a new `tests/manual/<screen>.md`.

````md
# <Screen or journey>: manual script

Ticket: HAC-n · Last run: <date> · App URL: <url>

## Preconditions

- App running at <url> (local `pnpm start`, or a Vercel preview).
- Browser and viewport: <for example Chrome, 1440x900>.
- Starting state: <for example "intake storage cleared", "logged out">.
- Test data to use: <exact text to type, files to open>.

## Steps

| # | Do | Expected result |
|---|---|---|
| 1 | Open `<url>/projects/houston-coffee/intake`. | The Intake heading is visible and nothing is highlighted red. |
| 2 | <one action> | <one thing that must be true afterwards> |

## Results (paste into the ticket)

| # | Pass / Fail | Notes or screenshot |
|---|---|---|
| 1 | | |
| 2 | | |
````

Write each step as one action with one observable result, so the agent can say pass or fail
without judgment calls. Tell the agent to take a screenshot at every step.

## Reporting bugs

When a test (Playwright or computer-use) finds a real bug in the app, as opposed to a mistake in the test:

1. **Check for duplicates** with `list_issues` (team `HAC`, label `Bug`, a keyword from the symptom). If one already exists, add your evidence as a comment there instead.
2. **Create the ticket from the team's `Bug` template.** With the Linear MCP, call `save_issue` with `team: "HAC"` and `template: "Bug"`. In the Linear UI, choose *New issue → Templates → Bug*. Fill in all three of the template's required sections:
   * **Brief Description:** the expected behaviour and the actual behaviour, plus the URL, browser or Playwright project, and viewport.
   * **Reproduction Steps:** numbered steps from a fresh load, and the failing spec and test name (or the manual script and step number).
   * **Test Cases:** the test that will catch this bug again, which is normally the `test.fixme` you are adding.
3. **Title:** `[Bug] <screen>: <symptom>`, for example `[Bug] Intake: answers lost on reload in webkit`.
4. **Route it to the owner:** add the `Bug` label plus the `agent:<name>` label and assignee of the feature ticket's owner (for example HAC-20 is `agent:yasser-claude`), set the state to `Todo`, and mark it **related to** both the feature ticket and the test ticket. Priority: `Urgent` if it breaks the demo journey, otherwise `High` for a wrong number or a crash, and `Medium` for everything else.
5. **Attach evidence:** the Playwright trace or screenshot from `test-results/`, or the computer-use screenshots.
6. **Mark the test** `test.fixme(true, 'HAC-n: <symptom>')` so the suite stays green, and list the new bug ticket IDs in your PR body.
7. **Announce it** on the board: `[BLOCKED] @<owner> HAC-n <symptom>, found by <test ticket>`, or `[QUESTION]` if you aren't sure it's a bug.

Don't fix the bug inside a test PR unless it's a one-line test-hook or `aria-label` change in the files the ticket names.
