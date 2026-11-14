# End-to-end tests (Playwright)

Every screen is tested end to end here. Specs live in `tests/e2e/*.spec.ts` and share
the helpers in `fixtures.ts`. Things Playwright can't check well (3D canvas visuals,
native file viewers, open-ended LLM conversations) go in `tests/manual/` instead.

## Run locally

```sh
pnpm install
pnpm exec playwright install chromium webkit   # once per machine
pnpm test:e2e                                  # builds, starts the app on :3000, runs all projects
pnpm test:e2e:ui                               # interactive UI mode
pnpm exec playwright test smoke --project=chromium   # one spec, one project
pnpm exec playwright show-report               # open the last HTML report
```

The config runs three projects: `chromium`, `webkit` and `mobile-chrome` (Pixel 7).
Locally it reuses a server already listening on port 3000; otherwise it runs
`pnpm build && pnpm start`. Failures keep a screenshot and video in `test-results/`, and
the first retry keeps a trace (CI retries once, local runs don't retry). Both
`playwright-report/` and `test-results/` are git-ignored.

## Run against a URL

Set `E2E_BASE_URL` to run the same suite against a Vercel preview or production URL.
No local server is started in that case.

```sh
E2E_BASE_URL=https://<your-preview>.vercel.app pnpm test:e2e
```

## Helpers (`fixtures.ts`)

Import `test` and `expect` from `./fixtures`, not from `@playwright/test`.

| Helper | What it does |
|---|---|
| `projectId` | The example project id, `houston-coffee` |
| `gotoView(view, siteId?)` | Opens `intake`, `map`, `site`, `comparison` or `replay` using `workspaceHref`. The `site` view needs a `siteId`; example sites are `montrose` and `heights` (`SITE_IDS`) |
| `clearIntakeStorage()` | Removes saved intake sessions from `localStorage` so a test starts clean |
| `expectNoA11yViolations(page)` | axe-core scan; fails on serious and critical violations only |

## Selector rules

- Prefer `getByRole` (with `name`) and `getByLabel`. Then `getByText` for static copy.
- Scope repeated labels and location links to their named region. The project context
  bar repeats page status and location text; assert page content and shell context
  separately rather than relying on page-wide uniqueness or `.first()`.
- A successful mocked API response can still contain synthetic data. Assert its
  provenance explicitly; an API-backed screen does not imply an absent Example badge.
- Add a `data-testid` only where no accessible name exists, and say why in the PR.
- Never select by CSS class or DOM position.
- Don't hard-code `waitForTimeout`. Use web-first assertions (`await expect(...)`).

## Location plan export (HAC-37)

`export.spec.ts` covers the saved comparison → printable plan journey, interval
and site-order parity, per-row origins/citations, outdated blocking, repeatable
HTML and print-media overflow at mobile/intermediate/desktop widths. It observes
the `window.print()` callback; the current app has no automatic download or
app-selected filename. Grounded plans export saved low/high intervals, while the
comparison screen also shows means. Chromium attaches a generated PDF alongside
the complete printable HTML and a viewport-sized print-media screenshot; WebKit
checks the HTML/print flow. The visual artifact captures the top of the plan and
avoids WebKit's 32767px image limit; content assertions still cover every row.
Native Save as PDF, pagination, Preview and Chrome PDF viewer checks are tracked
separately in `tests/manual/plan-export.md` and remain unexecuted until recorded.

```sh
E2E_BASE_URL=http://localhost:3137 pnpm exec playwright test tests/e2e/export.spec.ts --project=chromium --project=webkit --workers=1
```

Start your own app on port 3137 first (`pnpm build`, then `pnpm start --port 3137`),
or substitute an already approved local URL. These specs mock synthetic data and
make no database/model writes. The generated PDF is a browser artifact, not proof
of the original ticket's download or native-viewer acceptance.

## Explore with the Playwright MCP before writing specs

Before writing a spec for a screen, drive it with the Playwright MCP: open the page,
read the accessibility snapshot, and click through the flow. Copy the roles and accessible
names you see into your selectors, and note the console output. Then write the spec,
and run it in all three projects.

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

## API contract suite (HAC-33)

`tests/e2e/api/` runs in its own `api` Playwright project (no browser).

- Without a database (CI), only validation, not-found and no-secret checks run; happy paths skip.
- With a loaded database: `pnpm db:up && pnpm db:migrate && pnpm db:load`, start the app with that
  `DATABASE_URL`, then `E2E_DB=1 E2E_PROJECT_ID=local-dev pnpm test:e2e --project=api`.
  Against the hosted DB use `E2E_BASE_URL=<deployment> E2E_PROJECT_ID=houston-coffee`; it writes test
  profiles and comparisons, so prefer local.
- `E2E_MODEL=1` also advances an investigation through the configured model.

## Pipeline integration (HAC-34)

Seed an empty **dedicated local** PostGIS database named `hac34_test_*` with `HAC34_TEST_DATABASE_URL=<loopback-url> pnpm exec tsx tests/e2e/pipeline-seed.ts`, start the app with that same `DATABASE_URL` and empty `JEV_API_KEY`/`OPENAI_API_KEY`, then run `E2E_BASE_URL=http://localhost:<port> E2E_PIPELINE_DB=1 pnpm exec playwright test pipeline.spec.ts --workers=1`.

The opt-in suite makes real HTTP/search/catchment/evaluation/storage requests;
only external map tiles are stubbed. Its three inventory rows and public observations
are invented fixtures. The separate recorded-panel case aggregates the existing
recorded Jev wire responses offline and submits the resulting
behavior rows directly to the real evaluation route (it does not test live Jev polling).
It compares all ranked metrics, intervals, representative hourly arrivals and persisted
events on a repeated evaluation, changes seeds, checks founder buildout invalidation,
and displays an actual missing-table Huff fallback. Intake collects a price tier and
staff, not a dollar ticket or station count; the latter retain their explicit defaults.
The exposed interval is monthly **served customers**, not arrival counts, so the seed
check compares served means to that interval and independently checks changed arrivals.
Timings are attached to the Playwright report against the comparison route's 60s budget;
local timings do not establish Vercel limits or hosted seeded Neon acceptance. The suite
requires a loopback app URL; configure that app with the dedicated local database.
Without `E2E_PIPELINE_DB=1` these database-writing tests skip explicitly.

### Jev capabilities smoke check (HAC-101)

`api/capabilities.spec.ts` checks `GET /api/comparisons/capabilities` returns a well-formed,
secret-free body. It passes with or without a Jev key. To also assert `jevConfigured: true` on a
deployment (Vercel Preview or Production), set `E2E_EXPECT_JEV=1`. The route only reports key
presence and never calls Jev, so it costs nothing.

```sh
E2E_BASE_URL=https://<your-preview>.vercel.app E2E_EXPECT_JEV=1 \
  pnpm exec playwright test api/capabilities --project=api
```
