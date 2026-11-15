# Consultant workspace UI/UX study — HAC-130

This local study implements Akshar's approved [eight-screen storyboard](storyboard-2026-11-14/README.md). The main consultant workspace uses example data. Its production implementation remains with HAC-84/85/77/97/88 and Sam's runtime/tool tickets. HAC-128's initial real Text/Voice shell is already merged; Frank owns the broader HAC-129 integration.

- [Clickable prototype](interactive/)
- [Visual references and implementation boundaries](storyboard-2026-11-14/README.md)
- [Implementation plan](../../superpowers/plans/2026-11-14-consultant-mockup.md)

Serve from the repository root so the prototype can resolve the existing local Three.js package:

```sh
python3 -m http.server 4177 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4177/docs/design-prototypes/consultant-workspace/interactive/`.

The narrow production follow-up replaces guided onboarding neighborhood suggestion chips with a plain textarea using the same `areas` string and intake save path. The standalone onboarding reference mirrors it. No chat/runtime/provider contracts are changed.

## Verification boundary

The interrupted `simulation-preview.test.ts` draft is now preserved verbatim as [archived text](../bizbox-onboarding/archive/simulation-preview.test.ts.txt), with its missing-implementation status documented. It was never a working production test. The earlier isolated verification described below preceded that archive.

The intended candidate was verified in a temporary source export of current HEAD plus this task's tracked edits and design assets, excluding only that unrelated untracked file. In that export:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: pass.
- `pnpm test`: 1,252 passed, 40 skipped.
- Existing Chromium onboarding journey: 9 passed, including desktop/mobile typed preference preservation, keyboard navigation and reduced motion. Provider requests are mocked; this is not live-service verification.

Prototype-specific interaction/browser evidence is recorded in the interactive prototype's handoff. No push, PR, merge or deployment is performed by this task.
