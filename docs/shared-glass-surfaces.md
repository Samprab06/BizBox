# Onboarding, Start and workspace glass (HAC-145)

These surfaces consume the neutral smoke tokens from `app/workspace.css` and
DS-7 primitives in `components/ui`; they do not define another palette or focus
ring. The canonical material, typography, radii, contrast rules and timing remain
in `docs/design-system.md`.

- Onboarding uses `Glass` over a darkened existing city photo. Question cards use
  `Button`, area/preset toggles use `Chip`, and standard fields use `Input` or
  `Textarea`. The opacity-only question entry uses the shared
  `animate-question-in` utility. The onboarding CSS module contains spatial
  positioning only.
- Start keeps its existing project-entry decisions and uses shared glass, action
  recipes and focus. Its existing background image is unchanged.
- The assistant uses shared message bubbles, input, send/retry buttons and status
  pills. Its controlled draft, form submission, tab IDs/controls, roving focus,
  Text/Voice history, loading/disabled states and voice adapter remain owned by
  the existing conversation and shell.
- The retained LocationPanel uses backed glass over photography. Its city-photo credits,
  Example labels, metric origins, missing values, detail disclosures and links
  keep their existing meaning and data.
- The clock and curved ruler retain their geometry, pointer/keyboard handlers,
  bounds and exact typed values. SVG paint reads semantic tokens; clock CSS holds
  geometry and pointer feedback instead of local glass colors. Circular dial
  handles remain circular; normal actions use the shared control radius.

Existing onboarding, hours, workspace, Start/entry and accessibility browser
specifications cover interaction. The glass assertion in
`tests/e2e/onboarding-workspace.spec.ts` follows the shared 40% neutral fill and
16 px blur. No behavior, profile/persistence, route, service or provider contract
changes are part of this styling migration.

## Current real workspace integration

After merging main `439a0f9`, the production WorkspaceScreen remains the HAC-130
real-listing/Cesium controller, including selection/URL/camera behavior, source
readiness, explicit comparison, verified interiors and voice context. Its
presentation module now reads canonical colors, radii, font, shadow and blur;
it no longer defines local viewport or navigation palettes. Existing scene
imagery, layering and desktop layout are retained. Actions use shared Button
recipes without changing handlers or candidate identity. The old LocationPanel
is retained only for compatible existing callers, not restored as the production
workspace. This adoption adds no controller or backend changes.

The onboarding/workspace browser handoff uses the existing invented real-listing
API fixture for selected-site continuity and asserts unknown rent, floor area and
saved rent-limit origin/value. API failures instead assert Listings unavailable,
Retry and absence of fabricated preview properties. These replace obsolete
assertions for the removed budget header and example-only location panel.
