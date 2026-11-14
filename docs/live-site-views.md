# Live map and site detail (HAC-55)

The map reads the completed browser intake at
`sitework:intake:v1:<projectId>` and posts its converted `BusinessProfile` to
`POST /api/sites`. Site detail uses the same shortlist plus
`GET /api/sites/<encoded listingId:spaceId>/catchment` with project, category and
the default radius. Comparison/replay remain outside this integration.

The browser-to-contract adapter is `lib/client/intake-business-profile.ts`.
It validates actual form completion, converts dollar budgets to cents, maps the
four service categories and price tiers, and parses one explicit same-day opening
range. Ambiguous/overnight hours are not guessed. Uncollected average ticket,
startup budget and operating budget remain explicit unknowns; category operating
defaults retain their default origins. The concept is reused verbatim as the
display name, because the form does not collect a separate business name.

Supported must-have flags come from explicit feature text; optional/negated
features do not become mandatory. Area preferences and additional requirements
are retained verbatim for review, rather than falsely claiming a structured
neighborhood filter. This client-side profile is not a persisted/versioned database
snapshot and is used only for listing search.

Live views retain returned values, nulls, origin labels and evidence references.
Monthly base rent is distinct from the estimated NNN/lease total. Missing
coordinates do not become zero coordinates. Catchment pass-by is vehicles/day,
not people or customers, and co-tenant role labels remain heuristic defaults.
Search diagnostics describe sequential filtering effects.

Without a completed usable intake, or when live APIs are unavailable, the existing
fixture views remain available with explicit **Example data** labels. A successful
empty search remains an empty result with diagnostics. Missing real candidates
are not silently replaced with another live candidate. Unknown projects and
malformed/unknown fixture-style site IDs keep their existing 404 behavior.

Canonical space IDs retain `listingId:spaceId` and are URL-encoded in links.
Next.js can preserve percent escapes in route params, so page/catchment boundaries
decode a component exactly once before numeric-ID validation. Double-encoded,
slash-bearing and malformed identifiers remain invalid; API contracts are unchanged.

Vitest covers conversion boundaries and the catchment ID regression. Browser
tests mock schema-valid search/catchment responses, so CI requires no database
or model credentials. Local browser checks use a dedicated port and preserve
the existing visual system. These tests establish UI wiring and fallback behavior;
they do not claim that the new UI has already been deployed to production.
