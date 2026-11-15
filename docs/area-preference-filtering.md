# Area preference filtering

Approved behavior: green rectangles prioritize eligible listings; red rectangles exclude
listings, including green/red overlaps. Outside-green listings remain eligible. Existing
city, active listing, retail use, rent, size and required-feature rules remain enforced.

Drawn bounds are carried as optional structured `areaPreferences` in the canonical profile.
The saved map answer is decoded strictly by the client; invalid geometry and legacy brush
marks require redraw instead of silently widening the search. Changing city clears the
previous city's mapped areas. Free-text neighborhood names are preserved but not geocoded.

The inventory search applies red exclusions before sorting and the eight-listing limit.
Green matches form the first preference bucket; existing rent-known, pre-score and ID
ordering applies within each bucket. The economic score and simulated profitability are
unchanged. Rectangle edges are included. When red selections exist, unknown-coordinate
listings are excluded because their eligibility cannot be established. Green-only searches
retain unknown-coordinate listings as nonpreferred. Filter counts, founder evidence and
candidate flags describe these decisions.

Browser edits and flow events synchronize the latest geometry, including empty selections.
Assistant text replies cannot replace drawn bounds, and model tools cannot invent geometry.
Map changes invalidate the client comparison fingerprint; saved history remains available.
Profiles use the existing JSONB persistence, with no migration or new service. Older
read-through development backends must support the new profile field; geometry must never
be stripped or applied after an upstream limited shortlist.

## Measured data

This change adds deterministic geographic filtering only. It does not turn model outputs
into observations. A later calibration flow can accept dated actual customer counts or
sales/average ticket, service times and observed waits, use the existing `calibrateScale`
helper, then compare predictions with held-out observations. Observations, calibrated
estimates and uncalibrated estimates must remain distinguishable. No new measurement
provider, purchase, ingestion, or production mutation is part of this change.
