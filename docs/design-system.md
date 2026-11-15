# BizBox design system

BizBox uses neutral smoked glass, readable light text and white controls. Glass is
the primary material for the consultant workspace and onboarding; there is no green
in the application token palette. Keep the project header minimal and let the
visualization and persistent consultant lead the workspace.

## Authority and source values

Akshar explicitly confirmed **“Neutral smoked glass and white controls”** for
HAC-133 on November 14, 2026. This supersedes the historical periwinkle language
in [HAC-133](https://linear.app/hackprinceton/issue/HAC-133/ds-6-stage-2-design-tokens-and-design-doc-rewrite)
and the [HAC-130 layout direction](https://linear.app/hackprinceton/issue/HAC-130/client-workspace-approved-glass-ui-over-real-map-interior-and).
The palette decision is resolved; do not reintroduce the rejected blue dashboard.

Exact material values come from the [HAC-130 handoff](https://linear.app/hackprinceton/issue/HAC-130/client-workspace-approved-glass-ui-over-real-map-interior-and),
the [onboarding neutral-smoke CSS](design-prototypes/bizbox-onboarding/dark-glass.css)
and the local production handoff `components/workspace-screen/workspace-glass.module.css`
at HAC-130 revision `fe31a1e` (November 14, 23:18 UTC). That module is on HAC-130's
branch, not introduced by this token change. The earlier CSS comment “not a brand
lock” describes the study's historical status; Akshar's later confirmation governs
this foundation. See the [onboarding handoff](design-prototypes/bizbox-onboarding/HANDOFF.md)
for integration seams and the [reference README](design-prototypes/bizbox-onboarding/README.md)
for the static prototype.

## Tokens and surfaces

`app/workspace.css` is the sole application foundation. Its `@theme` namespaces
produce Tailwind utilities; examples include `bg-canvas`, `bg-glass-fill`,
`border-glass-edge`, `text-ink`, `bg-accent`, `text-on-accent`, `rounded-panel`,
`backdrop-blur-glass`, `shadow-glass`, `duration-question` and `ease-question`.
`app/layout.tsx` imports it and marks the body `data-bizbox-theme="smoke"`.
The unused `app/globals.css` is removed. The static landing CSS is a separate surface
and is not rewritten by this foundation.

| Token (`--color-`)         | Screen value            | Use                                                                     |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `canvas`                   | `#101115`               | Base page or spatial fallback                                           |
| `glass-fill`               | `rgba(15,16,21,.4)`     | Translucent material over the dark canvas                               |
| `glass-edge`               | `rgba(255,255,255,.48)` | Visible control/panel boundaries                                        |
| `panel-raised`             | `#18191f`               | Opaque analysis/readability backing; the fallback's exact base hue      |
| `glass-fallback`           | `#18191fee`             | Backed floating controls over arbitrary imagery or without blur support |
| `field`                    | `rgba(12,13,18,.38)`    | Inputs over a raised/dark surface                                       |
| `ink`                      | `#f7f7fa`               | Primary text                                                            |
| `muted`                    | `#dedee5`               | Secondary text; preserve its contrast                                   |
| `line`                     | `rgba(255,255,255,.19)` | Decorative separators, not required control boundaries                  |
| `accent` / `accent-hover`  | `#f3f3f6` / `#ffffff`   | White primary controls and text links                                   |
| `on-accent`                | `#17181d`               | Dark text on white primary controls                                     |
| `focus-ring`               | Alias of `accent`       | One keyboard-focus color                                                |
| `warn` / `danger`          | `#f0d7af` / `#ffbfbf`   | Uncertainty and errors                                                  |
| `baseline` / `alternative` | `#f3f3f6` / `#dedee5`   | Explicitly named scenario identities                                    |

The 40% glass fill requires a controlled dark underlay. It is not a readability
guarantee over arbitrary bright map/photo crops. Floating `GlassControl` uses a
94% raised-surface backing and the source-backed `glass-fallback` without blur;
both ink and muted text are tested over black and white imagery. Use the raised
panel for dense analysis, long evidence and errors. Keep the field within a dark
surface. Use the subtle line for table separators and `glass-edge` for required
control boundaries. Do not lighten a backing or lower text opacity independently.

Control, panel and sheet radii are 14 px, 32 px and 36 px, from HAC-130. Glass blur
is 16 px; the panel shadow is `0 18px 48px -24px #0009, inset 0 1px 1px #ffffff85`.
The existing card padding stays 20 px. Motion comes from the existing
[question transition](design-prototypes/bizbox-onboarding/simple-motion.js):
120 ms, ease-out, content opacity only. Reduced motion changes that duration to
0 ms. Keep glass fill/blur stable; no unrelated continuous or ornamental motion.

### Typography and remaining font criterion

The foundation uses HAC-130's existing system stack: `"Avenir Next", Avenir,
"Segoe UI", sans-serif`. Use tabular numbers for money, timing and metrics.
The former DM Sans declaration was never loaded.

**Remaining HAC-133 blocker:** the ticket's `next/font` criterion needs an approved
font family and source/bundled asset. No such asset or hosted fetch is approved.
This change preserves the accepted UI stack without adding a network font request,
service or dependency. Do not claim that the `next/font` criterion is complete;
load it after the chosen source is supplied.

### Evidence, scenarios and legacy compatibility

Evidence pairs use `ink` over white at 9%, as in HAC-130. The visible labels
**Source-backed**, **Your input**, **Assumption** and **Simulation** carry meaning;
neutral colors never substitute for the words. Place labels beside their values.
The fixed **Baseline** and **Alternative** names remain visible. Their primitive
labels also use solid and dashed leading borders to distinguish them in monochrome.
Charts must keep names/legends and existing non-color cues when adopting these tokens.

All old utility names remain aliases until DS-8–DS-10 migrate their consumers:

| Legacy name        | Canonical value                                           |
| ------------------ | --------------------------------------------------------- |
| `paper`            | `canvas`                                                  |
| `surface`          | `panel-raised`                                            |
| `pine` / `on-pine` | `accent` / `on-accent`                                    |
| `mint`             | `field`                                                   |
| `viewport-*`       | Corresponding shared text/surface/scenario/evidence token |
| `radius-card`      | `radius-panel`                                            |
| `spacing-card`     | Existing 20 px padding                                    |

`[data-surface="paper"]` and `[data-surface="viewport"]` keep their public names
and now share the same neutral system. The `--sw-*` local variables continue to
support `Card`, `Stat`, `EvidenceBadge` and `GlassControl`; no component API changes.
`Card` retains an opaque analysis backing. `GlassControl` remains a labeled control
group over a map/viewport; the broader shell may use glass without abusing this
primitive as a dialog or page wrapper.

A narrow compatibility rule maps legacy white `header`, `section`, `input`,
`select` and `textarea` backgrounds, plus `button.border-line.bg-white`, to the
raised surface. Legacy input/select/textarea `border-line` boundaries use
`glass-edge` for 3:1 control contrast. It leaves onboarding's white action buttons and marks intact.
Legacy `.bg-pine.text-white` actions (including the existing aria-current page
variant) use `on-accent`. Remove these bridges as DS-8–DS-10 replace hard-coded
white backgrounds/text with semantic tokens; do not expand into a blanket white
utility override. The compact decision replay and comparison chart literals now
use semantic text/station/baseline tokens, and detailed intake validation uses
`danger`; these narrowly scoped fixes keep existing content readable after the
surface change. Chart data, series dash patterns, labels and behaviors are unchanged.

### Print and contrast verification

`@media print` switches both application and viewport aliases to white canvas/panels,
solid light-gray fields/evidence, dark `#17181d` text, dark primary actions and white
action text. Warning/error text keeps the old proven dark amber/red print values.
Glass loses transparency, blur and shadows. Scenario names, solid/dashed cues and
evidence labels remain visible on paper. Screen and print tokens are tested separately.

`components/ui/contrast.test.ts` resolves aliases, solid/alpha hex and RGB/RGBA,
then composites supported surfaces against explicit underlays. It checks every
normal text/status/scenario pair and all evidence pairs at **4.5:1**, accent/hover
action text at **4.5:1**, focus/boundaries at **3:1**, the backed glass extremes,
the light print palette and Tailwind generation for every foundation token.
Malformed/missing/circular/unsupported colors fail tests instead of silently
skipping a pair. Parser fixtures are test data, not new palette approvals.

The current project-workspace QA directive is desktop-only. Landing responsiveness
is separate work. These tokens do not add loading/error behavior or change data,
provenance, persistence or consultant state.

## Evidence mapping and HAC-61

`lib/ui/evidence.ts` is a pure UI adapter, not a change to persisted contracts.

| Origin or derivation value                               | Badge         |
| -------------------------------------------------------- | ------------- |
| `costar`, `public`, future `matterport`                  | Source-backed |
| `founder`                                                | Your input    |
| `default`, calibration `none`                            | Assumption    |
| `synthetic_personas`, `jev`, `huff`, `modelled_arrivals` | Simulation    |

HAC-61's chain is inputs → synthetic personas → behavioral model → calibration →
modelled arrivals. Label each chain element using its own value. For a modelled
result, use `evidenceFor(derivation.output)` even when its inputs are public or its
calibration is founder-supplied. A leaf `default` remains an **Assumption**; it
cannot by itself identify a modelled result. Historical outputs without a chain
need their known simulation context at the call site, never an inherited
**Source-backed** label. Source-backed describes provenance, not guaranteed truth.

The helper's map exhaustively checks the canonical origin and derivation types.
The schema-driven test also inspects exported contracts, including nested inline
origin enums, and fails on an unmapped value. Unknown runtime strings throw
instead of silently gaining an evidence label. Adding a new origin requires an
explicit mapping and test review. `matterport` is anticipated only by this adapter;
it is not newly accepted by any stored origin schema.

Existing screens inherit the neutral foundation through compatibility aliases.
Later shell, comparison, replay and simulator tickets migrate those aliases and
component styling without changing scenario names or provenance meaning.

## Decision-first composition (HAC-71, comparison portion)

`components/decision/decision-header.tsx` composes a specific `decision`, supplied
`answer`, visible `qualification`, optional real `scene`, and `nextAction` in that
reading order. It uses the solid `Card` surface and inherited tokens, wraps long
addresses, and never clamps the answer or qualifications. The component does not
compute results, fetch data, or start an experiment. Supply a scene only when a
real replay or simulator is available; an absent slot invents no spatial evidence.

Saved comparisons lead with the HAC-62 robustness headline before candidate setup.
Keep provenance, Jev/Huff disagreement and stale-result warnings visible alongside
the answer. Tested stable assumptions and missing-information items remain in the
keyboard-operable **Decision evidence** disclosure.
The next action selects and focuses the matching sensitivity control; running it
is a separate explicit action. Unknown conditions or historical results without
robustness lead to the evidence instead. Outdated results offer an explicit rerun.
The synthetic example identifies its source and uses only its computed ranges;
it does not imply that the live robustness sweep ran.

The comparison scene reads its leader's canonical stored representative run,
validates project/profile/site/day/run identity, and renders a manual 160 px
schematic replay. Canonical `served` starts service and `departed` completes it.
The scene has a time slider, counts and a full-replay link; it invents no measured
floor geometry. Loading, unavailable and retry states never substitute another
run. Examples reuse their existing seeded engine events.

`WorkspaceView` accepts opt-in `decisionLayout` for comparison and simulator only.
It retains navigation destinations, current state, the context bar and an h1;
its complete three-task navigation opens from a native compact disclosure and remains
keyboard reachable. It removes duplicate project-name text, large title spacing
and nested content-card padding. Other views keep their default wrapper.

The simulator mounts the same header before the neighborhood and full replay.
Its decision scene uses the existing run-backed 3D operating scene in a 160 px
viewport, with scenario/time controls, native fullscreen and a full-replay link.
The compact scene's optional `cameraZoom` fits the shop; default scene zoom,
quality budgets and visibility suspension stay unchanged elsewhere.

Stored simulator answers use the actual saved HAC-62 headline and most-influential
condition. Model disagreement stays visible. The loader uses the existing profile
version read to identify stale snapshots; a failed freshness read retains the valid
stored run and visibly says freshness is unknown. Example answers report the
computed service difference and contribution direction for the existing seeded
station experiment, explicitly identifying untested demand robustness. They never
pretend to have a saved robustness sweep or show a single sales forecast.

Decision-page acceptance checks cover the complete decision, answer, real scene and
next action at 1280×800, 820×800 and 375×800. Supporting evidence uses disclosures;
longer summaries, stale/unknown warnings and expanded evidence keep wrapping rather
than clipping. The expanded viewer and full evidence remain scrollable.

On compact decision pages, the task disclosure names the current task and all three task groups before expansion. Opening it exposes the same grouped destinations, current-step/current-page states and Next link. Other workspace pages retain their expanded navigation.
