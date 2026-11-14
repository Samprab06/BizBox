# Sitework design system

A clear, spatial, inspectable and practical decision workspace. Extend the existing
identity; the simulator is a dark canvas inside the warm application shell.

| Element     | Rule                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Application | Warm paper, dark ink, restrained pine primary actions                                                          |
| 3D viewport | Contained dark canvas; full screen only on demand                                                              |
| Typography  | DM Sans first in the existing sans stack; consistent headings, tabular money/numbers                           |
| Cards       | Solid surfaces; one 1 px border, 20 px padding, 12 px radius                                                   |
| Glass       | Only controls floating over a map or 3D view                                                                   |
| Scenarios   | Always **Baseline** (pine) and **Alternative** (blue); keep those names and hues in charts, replay and exports |
| Warnings    | Amber for uncertainty; red for errors or bad outcomes                                                          |
| Evidence    | Visible **Source-backed**, **Your input**, **Assumption**, **Simulation** next to the value                    |
| Motion      | Explain selection, movement, congestion or change; no unrelated continuous effects; respect reduced motion     |

## Tokens

Tokens live in `app/workspace.css` under `@theme`, giving Tailwind utilities such as
`bg-surface`, `text-ink`, `text-warn` and `border-line`. Existing page tokens retain
their values. No font request or dependency is added; DM Sans uses the existing stack.

| Token (`--color-`) | Paper     | Viewport (`--color-viewport-`) |
| ------------------ | --------- | ------------------------------ |
| `paper` / `canvas` | `#f6f5ef` | `#101b16`                      |
| `surface`          | `#ffffff` | `#172720`                      |
| `ink`              | `#1c3028` | `#f1f3eb`                      |
| `muted`            | `#50655a` | `#bac7be`                      |
| `line`             | `#d9dfd5` | `#46594c`                      |
| `baseline`         | `#1b4937` | `#a7d5b7`                      |
| `alternative`      | `#315b83` | `#a8c9ec`                      |
| `warn`             | `#754900` | `#ffe3a2`                      |
| `danger`           | `#a02828` | `#ffb4b4`                      |

Primary actions use `pine` (`#1b4937`) with `on-pine` (`#ffffff`); `mint`
(`#e2efdf`) remains a supporting surface. Scenario hues express identity, not
success or failure. Viewport tints preserve identity while remaining readable.
`--radius-card` is `0.75rem`; `--spacing-card` is `1.25rem`.

Badges use opaque `evidence-{source,input,assumption,simulation}-{ink,surface}`
token pairs. The separate viewport pairs have the `viewport-` prefix. Never apply
opacity to a badge or substitute its background independently of its text.
`components/ui/contrast.test.ts` checks all body/status/scenario text and badge
pairs against WCAG AA normal-text contrast (at least 4.5:1), including glass over
black and white underlays. Line tokens are decorative separators, not control
boundaries or text colors.

## Primitives and surface contexts

- `Card` is a solid analysis container and accepts normal div attributes. Set
  `surface="viewport"` for a standalone dark card, `surface="paper"` to reset a
  nested context, or omit it to inherit.
- `Stat` renders a description list with `label`, a tabular `value`, and optional
  adjacent `qualifier`. Optional `scenario="baseline" | "alternative"` renders
  the fixed scenario name in its identity color. Use the qualifier for units,
  uncertainty, time basis and/or an `EvidenceBadge`.
- `EvidenceBadge` takes `kind: EvidenceKind`. It renders visible text without
  relying on a tooltip, color alone or live announcements. Place it next to its
  value, never only in a footer.
- `GlassControl` requires `over="map" | "viewport"` and an `aria-label`; it is a
  labelled group for real buttons/inputs/links. It has a 94% surface fill and 12 px
  backdrop blur. It is not an analysis card, dialog, or page background. Keep
  spatial imagery behind it; supply a positioned wrapper at the call site.

For a contained dark canvas use `className="sw-viewport" data-surface="viewport"`
on the viewport wrapper. Child primitives inherit its local colors; page tokens
and the body remain warm. `GlassControl` selects its own context from `over`.
Do not add a global dark-body override. On narrow screens let cards shrink and
labels wrap; never remove evidence qualifiers to save space. These primitives
add no animation, loading states, or client JavaScript of their own.

```tsx
<Card>
  <Stat
    scenario="baseline"
    label="Modeled monthly contribution"
    value="$2,400–$3,100"
    qualifier={<EvidenceBadge kind={evidenceFor(result.derivation.output)} />}
  />
</Card>
```

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

Existing screens are unchanged by this foundation. Adopt these primitives in the
later shell, comparison, replay and simulator tickets without changing the names,
colors or provenance meaning.

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
its navigation scrolls horizontally within the page at narrow widths and remains
keyboard reachable. It removes duplicate project-name text, large title spacing
and nested content-card padding. Other views keep their default wrapper.

The simulator scene slot remains an integration boundary for DS-4.
HAC-69 owns the remaining shell/navigation. The tested two-site saved comparison's
decision, qualified answer and action fit at 1280×800 and 375×800 with the disclosure
closed; the mobile action ends at approximately y787. Expanded evidence, stale
warnings or longer multi-site summaries may need additional vertical space and
must keep wrapping naturally. HAC-71 remains in development until real scenes
mount on comparison/simulator and the complete composition is verified again.
