# Location plan export: manual script

Ticket: HAC-37 · Last run: not run in a native viewer · App URL: `http://localhost:3137` (replace with the reviewed app URL)

## Preconditions

- Start the reviewed build locally (`pnpm build`, then `pnpm start --port 3137`), or use an explicitly approved preview URL.
- Browser and viewport: Chrome, 1440×900; macOS Preview available. Record the OS and Chrome versions with the results.
- Use a saved, current comparison for `houston-coffee` with at least two sites and nonempty grounded plan data. Record its exact comparison ID, site order, displayed means and 90% intervals before starting. A local data-backed app is needed for this script; the automated suite mocks synthetic data per browser context and does not create a saved comparison in the database.
- Starting URL: `<app-url>/projects/houston-coffee/comparison?comparison=<comparison-id>`. Replace placeholders with the recorded values. Do not silently substitute a different comparison after a failure.
- Use a new local folder for artifacts. Suggested filename: `location-plan-<comparison-id>.pdf`. The filename is chosen in the browser/OS save dialog; the app does not supply one.
- Take a screenshot at every step; after saving, capture **every PDF page** in each viewer. Name evidence with the step number, viewer and PDF page number. Attach results and screenshots to HAC-37 through the manager after approval.

## Current export contract

The app's **Export the location plan** link opens printable HTML. **Print or save as PDF** calls the browser's print dialog. There is no automatic browser download, filename or MIME-type contract. HAC-37's original `download` acceptance remains a ticket/product reconciliation item; do not report a download event as passed.

Grounded plans intentionally show saved low/high scenario intervals, rather than the comparison's mean point forecasts (see `docs/grounded-location-plan.md`). Compare the displayed means on the comparison screen to the saved source data, and compare **intervals** between the comparison and plan. The plan uses site IDs where the comparison uses addresses; record the mapping. Citations currently appear as reference text, not clickable external links; source attributions contain no hyperlink. Record that limitation when checking the ticket's citation-link requirement. The current plan contains tables and text; there are no exported charts to inspect.

## Steps

| #   | Do                                                                                                                               | Expected result                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open the starting comparison URL.                                                                                                | The table caption contains the recorded comparison ID, and its site order, means and intervals match the recorded source values.                                       |
| 2   | Click **Export the location plan**.                                                                                              | The Location plan article shows the same comparison ID; the URL includes `comparison=<comparison-id>`.                                                                 |
| 3   | Inspect **Why this site** from top to bottom.                                                                                    | Sites appear in the saved ranking order; each site's monthly contribution interval matches the comparison's 90% interval.                                              |
| 4   | Inspect every table's value and origin/source columns.                                                                           | Every numeric value has an origin label and a comparison/metric reference; available evidence references remain visible.                                               |
| 5   | Inspect **Sources** and all citation text.                                                                                       | CoStar, Census/LEHD and Overture attributions are present; citation strings are readable. Record that clickable citation links are unavailable in this implementation. |
| 6   | Click **Print or save as PDF**.                                                                                                  | Chrome opens its print preview with the plan content and without the print button or duplicate page heading.                                                           |
| 7   | In print preview, select **Save as PDF**, A4 portrait, 100% scale, default margins, headers/footers off, background graphics on. | All pages show legible text and full-width tables without horizontal clipping; record the page count.                                                                  |
| 8   | Inspect every page boundary in print preview.                                                                                    | No glyphs, table values or citations are cut off, hidden, overlapped or missing across page breaks. Long tables may continue on later pages.                           |
| 9   | Save the PDF in the artifact folder with the suggested filename.                                                                 | A nonempty `.pdf` file exists at the selected path. Record its actual filename and byte size.                                                                          |
| 10  | Open the saved PDF in macOS Preview.                                                                                             | The file opens successfully; its page count matches Chrome print preview.                                                                                              |
| 11  | Inspect each page in Preview at 100%, taking a screenshot of each page.                                                          | Fonts, punctuation, ranges, tables and citations are legible; no text is clipped or missing. There are no charts in the current export.                                |
| 12  | Inspect citation references and source attributions in Preview.                                                                  | Reference text matches the HTML. Record citation hyperlink support as unavailable, rather than claiming a successful link test.                                        |
| 13  | Open the same saved file in Chrome's PDF viewer.                                                                                 | The PDF opens with the same page count, comparison ID, site order and intervals as Preview.                                                                            |
| 14  | Inspect each page in Chrome's PDF viewer at 100%, taking a screenshot of each page.                                              | Fonts, table boundaries, values and citations remain readable without clipping or overlap.                                                                             |
| 15  | Print the opened PDF to a second PDF using the same paper settings.                                                              | The second PDF opens with all original text, tables, ranges and sources intact; compare every page.                                                                    |
| 16  | Return to the unchanged plan HTML and save another PDF using the same settings.                                                  | Its plan text, comparison ID, site order, intervals, origins and citations match the first export; PDF metadata may differ.                                            |
| 17  | Open an independently known outdated comparison URL.                                                                             | Its comparison screen labels it outdated and offers no **Export the location plan** link. Record the outdated comparison ID.                                           |
| 18  | Open `<app-url>/projects/houston-coffee/plan?comparison=<outdated-id>` directly.                                                 | An outdated warning and rerun link appear; no plan article or print button appears.                                                                                    |

## Results (paste into the ticket)

Browser/OS: ___ · Reviewed commit: ___ · App URL: ___ · Current comparison ID: ___ · Outdated comparison ID: ___

| #   | Pass / Fail | Notes or screenshot                                              |
| --- | ----------- | ---------------------------------------------------------------- |
| 1   | Not run     | Requires saved local comparison and desktop check.               |
| 2   | Not run     |                                                                  |
| 3   | Not run     |                                                                  |
| 4   | Not run     |                                                                  |
| 5   | Not run     | Citation hyperlinks are unsupported; report the ticket mismatch. |
| 6   | Not run     | Native print dialog has not been exercised.                      |
| 7   | Not run     |                                                                  |
| 8   | Not run     | Page-break review remains outstanding.                           |
| 9   | Not run     | No native saved-file result recorded.                            |
| 10  | Not run     | Preview has not been exercised.                                  |
| 11  | Not run     |                                                                  |
| 12  | Not run     | Citation hyperlinks are unsupported.                             |
| 13  | Not run     | Chrome's native PDF viewer has not been exercised.               |
| 14  | Not run     |                                                                  |
| 15  | Not run     |                                                                  |
| 16  | Not run     |                                                                  |
| 17  | Not run     |                                                                  |
| 18  | Not run     |                                                                  |

Automated evidence is separate: `tests/e2e/export.spec.ts` checks the synthetic comparison-to-plan flow, per-row origins/references, deterministic HTML, outdated blocking, print-media cell overflow at 390/768/1440px, and the print callback in Chromium/WebKit/mobile Chrome. A Chromium run attaches a generated PDF; this confirms PDF generation only, not native Save as PDF or manual page-break/viewer acceptance. Test reports also attach the complete printable HTML and a viewport-sized screenshot of the plan's top in print media. The image is deliberately bounded to avoid WebKit's 32767px screenshot limit; all row assertions and complete HTML/PDF artifacts remain. No manual result should be inferred from automated evidence.

For a real failure, send the manager the exact step, comparison ID, reviewed commit and screenshots for duplicate triage and the repository's Bug template. Do not mark the script passed or HAC-37 complete until the native checks have been run and results posted.
