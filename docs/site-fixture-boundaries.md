# Site detail example and live-data boundaries (HAC-175)

At the pinned `439a0f9` baseline, `SiteScreen` already selects an example by membership
in `project.sites` before mounting `LiveSiteDetail`. The demo project explicitly
contains `montrose` and `heights`; generated projects start without example sites.
An arbitrary nonnumeric identifier is not automatically an example.

The example branch renders `SiteDetail` with authored listing facts, synthetic
resident/worker estimates and explicitly synthetic Insights. Its illustrative floor
plan is DOM content, not an image fetched from the live floorplan endpoint. It does
not mount live catchment, interior or scene loaders. Saved intake does not change
that site identity or turn these examples into source-backed listing results.

The reported failing requests could not be reproduced on that baseline. HAC-175
therefore adds request-level regression coverage without a runtime bypass or API
identifier change. Canonical CoStar IDs such as `201:301` continue through the live search and
catchment path. A failed catchment remains an alert with Retry, retains the actual listing
facts and does not substitute example demographics. Optional example details remain
a separately labeled disclosure.

When extending these pages, retain the explicit example/live presentation split.
Do not send authored site IDs to APIs accepting only numeric CoStar identities, and
do not broaden those API validators to accommodate a demonstration. An illustrative
layout or example estimate must retain its example provenance rather than appear as
a verified scan, listing floorplan or source-backed demographic result.

`tests/e2e/site-fixture-boundaries.spec.ts` checks both example sites with and without
a complete saved intake. It intercepts the catchment, interior, scene and interior
floorplan endpoints and asserts zero requests after the page and Insights controls
settle. A separate numeric-site case returns a mocked service failure, verifies the
visible error and confirms Retry requests the same real identity. All provider and
listing responses used by these checks are local browser mocks.
