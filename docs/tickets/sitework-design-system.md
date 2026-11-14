# Sitework shell and design system: ticket plan

Draft tickets for the HAC team. They are not yet in Linear and have no owners. They belong
in a new Linear project, **Sitework shell & design system**. Companion files:
- [`city-sim-and-insights.md`](./city-sim-and-insights.md): the SIM-* tickets, project "City
  simulation & insights"
- [`agentic-business-plan.md`](./agentic-business-plan.md): the AGT-* tickets, project
  "Agentic copilot"

Each ticket has the same sections as the Linear tickets: Context, Scope, Files, Acceptance,
Links and Suggested owner. When a ticket is imported, prepend the standard "Product
context" and "Stack" blocks.

**Links** become Linear relations on import:
- **Blocked by**: can't start until that ticket is done.
- **Blocks**: the reverse relation. Set it on one side only; Linear mirrors it.
- **Related**: coordinate with or read; there's no hard dependency.

HAC tickets marked ✓ were already Done on 2026-11-14.

## Why

The app currently has two separate visual identities:
- **The workspace** (`app/workspace.css`) uses warm paper (`--color-paper #f6f5ef`), dark
  ink, pine-green actions, DM Sans and restrained cards. It has five flat tabs: Intake, Map,
  Site detail, Comparison, Replay (`lib/client/workspace-routes.ts`).
- **The simulator** (`simulator-visualization` branch, `components/simulator/`) is a
  standalone `/simulator-demo` page. It has:
  - a near-black background
  - frosted glass on every panel
  - emerald and indigo glow
  - a full-screen neighborhood view, with the business question below it

Together they feel like separate projects. This project keeps the name **Sitework**, already
in the app metadata, and builds one calm business decision workspace around it. The
simulator becomes a dark **mode** inside that workspace.

The design language should feel **clear, spatial, inspectable and practical**.

| Element | Rule |
|---|---|
| Main application | Warm off-white surfaces, dark ink, restrained pine-green primary actions |
| 3D viewport | A dark canvas contained in the same workspace |
| Typography | One family (DM Sans), consistent heading sizes, tabular numbers for money |
| Cards | Consistent border, padding and radius; solid surfaces for analysis |
| Glass | Only for controls floating over the map or 3D view |
| Baseline vs alternative | The same color and name in charts, cards, replay and exports |
| Warnings | Amber for uncertainty; red for errors or bad outcomes |
| Evidence labels | Explicit text: **Source-backed**, **Your input**, **Assumption**, **Simulation** |
| Motion | Explains selection, movement, congestion and change; no unrelated continuous effects |

The interface is organized around three founder tasks. The routes stay the same.

| Current screens | Founder task |
|---|---|
| Intake, map, site detail | **Find a location** |
| Comparison, replay, sensitivity, simulator | **Test the plan** |
| Findings, recommendation, plan, export | **Make the decision** |

## Coordination

- **HAC-61** (Todo) separates input, transformation, behavioral model and calibration in
  demand provenance. DS-1's evidence labels are how those categories appear on screen, so
  agree on the mapping before either ticket merges.
- **HAC-62** (Todo) makes the comparison lead with a robustness statement. DS-5 decides
  where that statement sits; HAC-62 computes it.
- **HAC-63** (Todo) loads stored runs into the simulator. **HAC-65** (In Development) makes it
  fast. Both edit `components/simulator/`. DS-4 goes after both of them and before SIM-6.
  The order is **HAC-65 → HAC-63 → DS-4 → SIM-6**.
- **HAC-25** (Yasser) owns `components/replay/` and `components/comparison/`. DS tickets
  change styling there only after it merges, or in agreement with its owner.
- **HAC-31 ✓** (shell, navigation and accessibility E2E) asserts on the current tabs. DS-3
  updates those specs in the same PR.
- **HAC-27** (integrate, reset and rehearse) owns the demo story. Its decision story should
  follow DS-5's layout: problem, two real spaces, pressure test, challenge an assumption,
  next action.
- Contract changes that need a `[CONTRACT]` post first: DS-1's `EvidenceKind` type, if it
  lives in `lib/contracts/`.

## Dependency order

```
DS-1 ─┬─► DS-2 ─► AGT-5
      ├─► DS-3
      ├─► DS-5 (+HAC-62)
      └─► DS-4 (+HAC-65, HAC-63) ─► SIM-6
```

DS-1 can start now.

---

## DS-1 Design tokens and evidence labels

**Context.** Every later ticket needs the same tokens, card styles and evidence badge.
Otherwise each screen invents its own.

**Scope.**
- Extend `@theme` in `app/workspace.css`:
  - surface, ink and line tokens (some already exist)
  - `pine` for primary actions
  - `warn` (amber) and `danger` (red)
  - **baseline** and **alternative** identity colors
  - **dark-mode tokens** for the 3D viewport, kept separate from the page tokens
- Primitives in `components/ui/`:
  - `Card`: solid surface, one border, padding and radius
  - `Stat`: tabular numbers, a label, and an optional qualifier slot
  - `GlassControl`: the only glass surface, used for controls over the map or 3D view
- An `EvidenceBadge` with exactly four kinds: **Source-backed**, **Your input**,
  **Assumption**, **Simulation**.
  - A pure `evidenceFor(origin)` maps the existing origins (`costar`, `public`, `founder`,
    `default`, later `matterport`) and HAC-61's categories to those four kinds.
  - The badge sits next to the value it describes, never only in a footer.
- A short `docs/design-system.md`: the rules table above, the token list, and when to use
  glass.

**Files.** `app/workspace.css`, `components/ui/*` (+ tests), `lib/ui/evidence.ts` (+ test),
`docs/design-system.md`.

**Acceptance.**
- [ ] Every origin value in `lib/sim/contracts.ts` and `lib/contracts/` maps to exactly one
      evidence kind, and a test fails if a new origin isn't mapped.
- [ ] Both the paper and dark-viewport token sets pass WCAG AA contrast for body text and
      badges.
- [ ] Baseline and alternative keep the same colors and names across these primitives.
- [ ] Existing screens still render; no visual changes beyond adopting the tokens.

**Links.**
- Blocked by: none
- Blocks: DS-2, DS-3, DS-4, DS-5
- Related: **HAC-61** (provenance categories), HAC-10 ✓ (page shell), SIM-7, SIM-10, AGT-5
  (all use these primitives)

**Suggested owner.** The frontend lane (HAC-10 author).

---

## DS-2 Persistent context bar

**Context.** A founder should never have to wonder whether they're looking at a real
listing, the Montrose example, or a different simulated operating plan.

**Scope.**
- A bar at the top of every workspace page with four parts:
  - **business concept**, from the intake profile
  - **selected location**: the CoStar suite and address, or a clear **Example** badge for
    fixtures such as Montrose
  - **scenario**: "Baseline" until AGT-1 exists, then the active scenario's label
  - **data/model status**, for example "Live comparison", "Example data", or "Modeled, not a
    forecast"
- Each part links to where it can be changed: intake, map, the scenario switcher or the
  evidence view.
- On phones it collapses to one line that expands on tap.

**Files.** `components/shell/context-bar.tsx` (+ test), wiring in
`app/(pages)/projects/[projectId]/layout.tsx`.

**Acceptance.**
- [ ] Every page in the workspace shows the bar, including the simulator once DS-4 merges.
- [ ] Fixture data always shows the **Example** badge, and live data never does.
- [ ] It works at 375 px and passes axe checks.

**Links.**
- Blocked by: DS-1
- Blocks: AGT-5 (the scenario switcher feeds the bar)
- Related: HAC-10 ✓, AGT-1 (scenario label), HAC-63 (Example vs stored run), HAC-31 ✓
  (shell E2E)

---

## DS-3 Three-task navigation

**Context.** The five flat tabs don't tell the founder why they're moving between screens.

**Scope.**
- Group the existing routes under three tasks: **Find a location**, **Test the plan** and
  **Make the decision** (see the table in Why). Routes and URLs don't change.
- Show which task the founder is in, and what the next step is ("Next: compare your
  shortlist").
- Add the simulator (the city view after SIM-6) under **Test the plan**.
- Update `lib/client/workspace-routes.ts` so the grouping is defined in one place.

**Files.** `lib/client/workspace-routes.ts` (+ test), `components/shell/*`, and the HAC-31
specs in `tests/e2e/shell.spec.ts` and `tests/e2e/a11y.spec.ts`.

**Acceptance.**
- [ ] Every existing route is reachable from the new navigation, with the same URL.
- [ ] HAC-31's shell and accessibility E2E specs are updated in the same PR and pass.
- [ ] Keyboard navigation and axe checks pass at 375 px and desktop width.

**Links.**
- Blocked by: DS-1
- Related:
  - **HAC-31 ✓** (its specs change here)
  - HAC-10 ✓
  - HAC-43 (pick-a-site empty state on site detail)
  - SIM-6 (the city route goes under Test the plan)
  - AGT-5 (the dock sits beside this navigation)

---

## DS-4 Simulator inside the shell, with honest labels

**Context.**
- The simulator runs at a standalone `/simulator-demo` route with its own dark identity.
- Its overlays look authoritative over a realistic city mesh, but they're illustrative:
  - "Traffic heatmap" comes from time-of-day curves and invented offsets.
  - "Apartments / Offices / Transit" are hand-placed anchors.
  - "Monthly gain" hides its time basis.

**Scope.**
- Mount the simulator inside the workspace, under **Test the plan**, with the shell and the
  context bar (DS-2).
  - The 3D view is a dark canvas inside the page, using DS-1's dark-viewport tokens.
  - It is full-screen only on demand, through an "Expand" control.
  - `/simulator-demo` redirects to it.
- Glass only on controls floating over the 3D view. Analysis cards use solid DS-1 surfaces.
- Remove the emerald and indigo background glow, and any continuous effect that doesn't
  explain something. Keep the sky and clouds, but make them optional and off by default
  when HAC-65's low-quality setting is active.
- Relabel the overlays, with the qualifier **next to the control or legend**, not in the
  footer:

  | Current label | New label |
  |---|---|
  | Traffic heatmap | Illustrative traffic pattern |
  | Apartments / Offices / Transit pulses | Assumed activity by time of day |
  | Arrivals (in the café) | Modeled arrivals |
  | Monthly gain | Modeled monthly contribution change, with "22 weekdays · ingredients, labor, rent, buildout amortization" available in one tap |

- The same baseline and alternative names and colors as the comparison screen.

**Files.** `components/simulator/demo.tsx`, `components/simulator/neighborhood.tsx`,
`components/simulator/glass.ts` (replaced by `GlassControl`), a workspace route for the
simulator, and the `/simulator-demo` redirect.

**Acceptance.**
- [ ] The simulator renders inside the shell with the context bar and three-task navigation.
- [ ] No overlay or stat uses the words "Traffic", "Demand" or "gain" without its qualifier
      next to it.
- [ ] Keeps HAC-65's measured frame rate, and HAC-63's stored-run loading still works.
- [ ] Fixture data shows the **Example** badge (DS-2), and stored runs don't.
- [ ] Works at 375 px; the Expand control is keyboard-operable.

**Links.**
- Blocked by: DS-1, **HAC-65**, **HAC-63**
- Blocks: SIM-6
- Related: DS-2, DS-3, HAC-61, HAC-64 ✓ (the fixture's hardcoded service time should follow
  it; coordinate with HAC-63)

**Suggested owner.** Whoever owns `components/simulator/` after HAC-65, so the folder stays
with one person.

---

## DS-5 Decision-first page layout

**Context.** The simulator page opens with a full-screen neighborhood, and the operating
question ("Does a second station pay off?") is below it. In a two-minute demo, that spends
the most valuable time before the product is explained.

**Scope.** On the **Test the plan** and **Make the decision** pages, these four things are
visible without scrolling, in this order:
1. **The decision**, phrased specifically, for example "Does a second staffed station
   justify the cost?"
2. **The current answer**: the computed result with its qualification, using HAC-62's
   robustness statement ("Site A leads under current assumptions; Site B leads if demand
   falls below 0.7×").
3. **The scene**: the 3D view or replay that explains the answer physically.
4. **The next action**: change an assumption that could flip the answer, or open the
   evidence.

The layout is shared between the comparison page and the simulator page.

**Files.** `components/decision/decision-header.tsx` (+ test), and mount points on the
comparison page and in the simulator (after DS-4).

**Acceptance.**
- [ ] At 1280×800 and at 375 px, the decision, the answer and the next action are visible
      without scrolling.
- [ ] The answer uses HAC-62's computed conditions and never shows a single sales forecast
      (the existing E2E guard).
- [ ] The "change an assumption" action opens the matching lever (SIM-8) or sensitivity
      control.

**Links.**
- Blocked by: DS-1, **HAC-62** (the robustness summary)
- Related:
  - DS-4
  - SIM-8 (the levers the next action opens)
  - SIM-10 (callouts must agree with the answer)
  - AGT-11 (the plan uses the same header)
  - HAC-25 (comparison screen ownership)
  - HAC-27 (the demo story follows this layout)
