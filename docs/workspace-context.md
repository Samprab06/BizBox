# Persistent project context (HAC-68)

The project layout mounts `ProjectContextProvider` and its context bar above the
existing page content. It keeps Sitework's navigation intact. The bar shows the
saved intake concept, selected location, **Baseline**, and data/model status.
At widths below 768 px, a one-line native disclosure expands by tap, Enter or
Space. Desktop shows all four linked fields. There is no added motion.

## Sources and truthfulness

- The concept comes from the existing device-local intake session, including an
  incomplete profile. With no concept it says **Describe your business**. Same-tab
  form events, cross-tab storage events and window focus refresh the saved value;
  no persistence behavior is changed and there is no polling.
- The selected location follows the existing route. Intake never implicitly
  selects a fixture merely because the preview project contains one. Map routes
  without a selection say **Choose a location**. A comparison with multiple sites
  identifies the set instead of arbitrarily selecting its first result.
- Search and comparison hooks optionally publish the state they already use to
  render their screens. The bar issues no network requests. Reports are scoped
  by project and full route/query identity; unmounting unregisters them.
- Known fixture locations, synthetic API candidates, synthetic comparisons, and
  replay/comparison fallback content show **Example**. Verified nonsynthetic
  sources never acquire that badge merely from their URL or project name.
- Comparison responses already contain `comparison.synthetic`; the frontend
  preserves that existing field. Older responses without it say **Comparison
  provenance unavailable**. The public API schema and server behavior are unchanged.
- The plan exporter publishes its already fetched comparison metadata and validated
  loaded plan identity. Missing, outdated, failed, synthetic and unknown-provenance
  plans are explicit. The entire context bar is hidden in print, keeping the
  existing printable fact allowlist unchanged.
- Replay also publishes its existing run-loading state. A failed or invalid run
  response shows **Example** even when its parent comparison is nonsynthetic.
  Route/run changes clear the previous run's identity while loading.
- Model output is qualified **Modeled, not a forecast**. **Live comparison** means
  a stored comparison with verified nonsynthetic provenance, not observed sales.
  Outdated comparisons are explicitly labelled.

The listing's existing name and address are used when available. Direct stored
replay links do not include an address in the current API response, so the bar
truthfully says **Site <id> · address unavailable**, with a map link. It never
substitutes an invented address or sends another inventory request.

## Destinations and future integration

Concept links to intake, location to map, and Baseline to the existing comparison
route while preserving its comparison identifier. There is no scenario switcher
in this branch. Data/status links lead to the selected site's existing evidence
(or the map when no site is selected); known evidence anchors are preserved.
Fixture evidence links use the existing `#listing-source` anchor.

The simulator route `/projects/[projectId]/simulator` receives the same bar. Its controller uses `useWorkspaceReport` to publish the loaded stored run or the actual displayed Example fallback, including the selected site and synthetic provenance. A failed stored load remains Example even when its URL names a comparison. Stored project IDs outside the bundled preview use an empty project context rather than borrowing fixture facts. An unknown route/controller remains **Loading context…**
until it supplies evidence; the shell never infers a live status. Future scenario
switching should extend the context model when that contract exists.

## Verification

`lib/client/workspace-context.test.ts` covers origin/fallback resolution,
selection, missing metadata, stale routes and project isolation.
`components/shell/context-bar.test.ts` covers semantic markup and destinations.
`tests/e2e/context-bar.spec.ts` covers all six routes, intake updates, live versus
synthetic responses, comparison adoption, replay failure/retry, late responses,
plan provenance and print exclusion, mobile disclosure, keyboard operation, axe and horizontal overflow. Test API
responses are invented fixtures; nonsynthetic mock metadata exercises the live
label independently of real services.
