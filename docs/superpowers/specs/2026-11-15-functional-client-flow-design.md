# Functional client flow — discussion draft

Intent: Akshar requested actual data/service integration across supported onboarding choices, not curated locations or another sample UI. Implement in the current client workspace after resolving the product decisions below. This turn is read-only audit/design; no implementation, import, activation or generation is authorized by this draft.

## Verified current coverage
Approved development DB: Houston1758/LA1581 properties; active retail spaces145/349 before founder filters. Positive area/coordinates exist for all494. Required known rent+supported opex inputs narrow this to51/130 before other filters. Source comparison is operational, but full Jev panel has not been approved/run; only one real request succeeded.

Raw source JSON retains Matterport IDs covering59/61Houston and147/149LA eligible retail buildings. Exact-suite raw references cover4Houston/2LA active retail spaces. Active-space floorplan references19/48. References alone do not verify access, current content, permitted display or suite correspondence. Normalized attachment registry, approved Matterport registry, measured dimensions and layouts currently have zero rows. Licensed display is deliberately inactive in the current runtime. Both currently selected suites return kind:modeled; their parent buildings have raw model IDs.

## Required real flow
Saved supported brief → real matching units → selected unit's available source assets → actual/planned operating setup → one-unit run or optional two-unit comparison → stored scenario → metrics and visualization tied to that exact unit/profile/run. Keep chat alongside and dispatch the same identities to existing tools.

1. Apply supported onboarding fields consistently; expose unsupported choices/notes honestly. Verify Houston/LA ×coffee/quick_food/salon/fitness plus budget/requirements changes, empty results and missing inputs. Search eligibility is not verified zoning or business viability.
2. Verify/extract/import real asset references idempotently, preserve source provenance and exact property/suite scope, establish approved access and explicitly activate the existing resolver. No arbitrary sample scan replacement. LA map collection/coverage remains a separate necessary connection.
3. Prefill known owner settings. Ask only missing operating inputs (especially current/planned service stations and service duration). Keep current setup separate from estimated physical maximum. Marketed area is not measured usable layout area.
4. Repair station planning: current assembly starts stations at the same area-derived maximum that the experiment forbids exceeding, yielding no_effective_variants for both selected units. Do not choose an artificially low starting count solely to make an experiment look successful.
5. Use actual Jev responses/cache and the existing seeded engine for modeled outcomes; maintain cost limits, long-run progress/recovery and truthful model source. A single-unit experiment must not require choosing a second location.
6. Connect selected-unit scan/geometry and existing MatterportView/run/playback interfaces where verified; show aggregate operational results when measured geometry is unavailable. Spatial paths/placements cannot be represented as measured without data.
7. Route consultant tools to current profile/unit/scenario/run; existing Sam/Yasser tickets retain their runtime/dispatcher/renderer responsibilities. Nessie is optional simulated sandbox banking, never a real bank connection.

## Open product decisions
- May an authorized building-level tour be shown as explicitly “Building tour — selected unit unverified”, while spatial/unit-capacity claims remain unavailable until exact-suite geometry is verified? Recommended for broader useful coverage.
- Define starting service-station inputs and which business-specific operational experiments are valid. Require owner confirmation for missing setup rather than silently filling the space to its area-derived maximum.

## Delivery boundaries
No invented property-specific values or silent fallback to unrelated locations; real inputs may be listing/public data, verified provider measurements or owner-entered plans, with model assumptions identified. Stored outputs are modeled estimates, not observed traffic or guaranteed sales. No paid full Jev panel, hosted schema/import changes, external publishing or asset-display activation without the applicable authorization. Coordinate existing ticket owners before editing shared contracts/interfaces.
