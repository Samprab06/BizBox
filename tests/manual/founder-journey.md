# Founder journey (demo rehearsal): manual script

Ticket: HAC-39 (supports HAC-27) · Last run: not run yet · App URL: `<production Vercel URL>`

This is the stage demo, done the way a founder would do it. A human hands this file to a
computer-use agent, which runs it in a real browser on the **production** URL and records
the results. The automated version of the same journey is `tests/e2e/journey.spec.ts`
(`@journey`).

## Preconditions

- App running at the production Vercel URL. Write the exact URL and the deployed commit
  (from the Vercel dashboard) in the results header. Don't use a preview URL.
- Browser and viewport: Chrome, window sized to **1920×1080** (browser zoom 100%). If the
  projector's resolution is known, do a second pass at that size too and record it.
- Starting state:
  - **Run A:** straight after the HAC-27 demo reset (`scripts/reset-demo.ts`). Record the
    time the reset finished.
  - **Run B:** straight after Run A, with no reset in between.
  - Both runs: a fresh browser profile or incognito window, so no saved intake or
    comparison is in `localStorage`. The project is `houston-coffee`.
- Test data to type (exactly):

  | Field                    | Value                      |
  | ------------------------ | -------------------------- |
  | Business concept         | `Neighborhood coffee`      |
  | Service category         | `Coffee shop` (pre-filled) |
  | City                     | `Houston` (pre-filled)     |
  | Areas to favor or avoid  | `Any`                      |
  | Monthly rent ceiling ($) | `5000`                     |
  | Buildout budget ($)      | `60000`                    |
  | Price tier               | `Midrange`                 |
  | Target customers         | `Neighbors`                |
  | Opening hours            | `7am-7pm`                  |
  | Staff on shift           | `2`, later changed to `3`  |
  | Must-haves               | `None`                     |

- Use a stopwatch, or the screenshot timestamps, for each step's duration. Start the overall
  clock at step 1 and stop it at step 20. The demo budget for the whole journey is
  **4 minutes**.
- Take a screenshot at **every** step, named `<run>-<step>.png` (for example `A-07.png`).
- At every step, also note anything visually off: layout jumps, spinners that last more
  than 2 seconds, text that's hard to read at projector size, overlapping or clipped text.

## Steps

| #   | Do                                                                                                                                                                                             | Expected result                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open `<url>/projects/houston-coffee/intake?mode=form`.                                                                                                                                         | The **Business profile** heading is visible and **Business concept** is empty.                                                                                                                                              |
| 2   | Fill in every field from the test data table (tab out of each one).                                                                                                                            | The panel says **Form fields are filled** and no field shows a red error. Full readiness waits for the assistant’s review; known missing economics remain visible and are collected in chat.                                                                                                                                          |
| 3   | Open `<url>/projects/houston-coffee/map`.                                                                                                                                                      | A **Candidate sites** list shows at least one site, with markers on the map. Nothing is labelled **Example data**. Record the first site's address.                                                                         |
| 4   | Click the first site in the list.                                                                                                                                                              | It's highlighted in the list and on the map, and the URL ends with `?site=<id>`.                                                                                                                                            |
| 5   | Click **View details for &lt;address&gt;**.                                                                                                                                                    | The site page's heading is that address. Rent, size and catchment numbers each show where they come from. No **Example data** label.                                                                                        |
| 6   | Open `<url>/projects/houston-coffee/comparison`.                                                                                                                                               | All candidates are ticked and the **Run comparison** button is enabled.                                                                                                                                                     |
| 7   | Click **Run comparison**.                                                                                                                                                                      | Within 60 seconds a table titled **Live comparison &lt;id&gt; · monthly contribution in USD** appears, ranking the sites with 90% intervals. Record the comparison ID and the site order.                                   |
| 8   | Start the consultant investigation (see _Starting the investigation_ below), then open `<url>/projects/houston-coffee/comparison?comparison=<comparison id>&investigation=<investigation id>`. | The **Consultant activity** panel shows its steps appearing in order.                                                                                                                                                       |
| 9   | Wait on the same page.                                                                                                                                                                         | The panel's status reads **Done** and the last step is **Finished the investigation**. Record how long it took.                                                                                                             |
| 10  | Open `<url>/projects/houston-coffee/intake?mode=form` and change **Staff on shift** from `2` to `3`. Tab out.                                                                                  | The field shows `3` with no error.                                                                                                                                                                                          |
| 11  | Open `<url>/projects/houston-coffee/comparison`.                                                                                                                                               | The step 7 table is shown with **This comparison is outdated.** There's no **Export the location plan** link.                                                                                                               |
| 12  | Click **Rerun comparison**.                                                                                                                                                                    | Within 60 seconds a new table appears with a **different** comparison ID, the outdated notice is gone, and the URL has `comparison=<new id>`. Record the new ID and the new site order, and whether it differs from step 7. |
| 13  | In the new table, click **Replay weekday** on the rank 1 row.                                                                                                                                  | The replay opens with a **Play** button and the text _seed &lt;n&gt;_. Nothing is labelled **Example data**.                                                                                                                |
| 14  | Click **Play** and let it run for 5 seconds.                                                                                                                                                   | Customers move in the 3D layout and the clock and counts advance. No blank canvas and no errors.                                                                                                                            |
| 15  | Focus the **Seek to simulated time** slider and press **End**.                                                                                                                                 | The **Replay counts** line shows the end-of-day totals: `<n> served` and `<m> left`. Record both.                                                                                                                           |
| 16  | Open the **Representative hourly statistics** disclosure.                                                                                                                                      | An hourly table appears. Its served total over the day equals `<n>` from step 15 (metrics reconcile with events).                                                                                                           |
| 17  | Go back to the comparison (`<url>/projects/houston-coffee/comparison?comparison=<new id>`).                                                                                                    | The step 12 table is shown, not outdated.                                                                                                                                                                                   |
| 18  | Click **Export the location plan**.                                                                                                                                                            | The **Location plan** opens, says **Comparison &lt;new id&gt;**, and its **Why this site** rows list the sites in the step 12 order, with the same intervals as the comparison table.                                       |
| 19  | Click **Print or save as PDF**.                                                                                                                                                                | Chrome's print preview opens with the plan, without the print button. Cancel it.                                                                                                                                            |
| 20  | Stop the overall clock.                                                                                                                                                                        | The total is at most 4 minutes. Record it.                                                                                                                                                                                  |

### Starting the investigation

The app has no button that starts a consultant investigation; the panel follows one named in
the URL. Until it does, start one from Chrome's DevTools console on the comparison page
(after step 7), and paste the printed ID into step 8's URL:

```js
const saved = JSON.parse(
  localStorage.getItem("sitework:comparison:v1:houston-coffee"),
);
const r = await fetch("/api/investigations", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    projectId: "houston-coffee",
    profileId: saved.profileId,
    question: "Where should this coffee shop open? Compare my shortlist.",
  }),
});
console.log(r.status, (await r.json()).job?.id);
```

The status must be `201`. Anything else fails step 8; record the status and body.

## Results (paste into the ticket)

Fill in one table per run. Header: run (A after reset, or B straight after), date, URL,
deployed commit, viewport, browser version, total time.

| #   | Pass / Fail | Time (s) | Notes or screenshot |
| --- | ----------- | -------- | ------------------- |
| 1   |             |          |                     |
| 2   |             |          |                     |
| 3   |             |          |                     |
| 4   |             |          |                     |
| 5   |             |          |                     |
| 6   |             |          |                     |
| 7   |             |          |                     |
| 8   |             |          |                     |
| 9   |             |          |                     |
| 10  |             |          |                     |
| 11  |             |          |                     |
| 12  |             |          |                     |
| 13  |             |          |                     |
| 14  |             |          |                     |
| 15  |             |          |                     |
| 16  |             |          |                     |
| 17  |             |          |                     |
| 18  |             |          |                     |
| 19  |             |          |                     |
| 20  |             |          |                     |

Visual issues (step, what, screenshot):

-

File any failure as a `Bug` with priority **Urgent** (see _Reporting bugs_ in
`tests/manual/README.md`), and post the total time on HAC-27.
