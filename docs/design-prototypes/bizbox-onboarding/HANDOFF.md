# Handoff to the next UI implementer

## What to carry forward

Akshar's final direction is the simple static dark-glass treatment. Earlier liquid
pool/surface-tension experiments were rejected because transitions changed from
clear to translucent. Do not restore those effects. Preserve the concise individual
questions, Other category, real city photography, disabled preview cities and
GetA5-inspired rulers. See [README.md](README.md) for preview commands and edit points.

## Integration seams

The actual intake lives in `components/intake/intake-screen.tsx`, with profile and
validation in `components/intake/profile.ts` and API adaptation in
`components/intake/live.ts`. Reuse those state/update/submission paths; do not mount
a parallel production profile or chatbot from this prototype.

| Prototype field/value                | Existing intake field/value                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `concept`                            | `concept`                                                                                                     |
| `category: Coffee shop`              | `category: Coffee shop`                                                                                       |
| `category: Quick food`               | `category: Quick-service food`                                                                                |
| `category: Salon`                    | `category: Salon or barber`                                                                                   |
| `category: Fitness`                  | `category: Fitness studio`                                                                                    |
| `category: Other`                    | **Not currently accepted** by production category validation; resolve product/contract handling before wiring |
| `target`                             | `customers`                                                                                                   |
| `city`                               | `city` (Houston / Los Angeles)                                                                                |
| `preferences` plus `neighborhoods`   | `areas`; preserve favor/avoid meaning                                                                         |
| `rent`, `buildout`, `hours`, `staff` | Corresponding intake field, with production validation                                                        |
| `price: Value / Mid-range / Premium` | `price: Budget / Midrange / Premium`                                                                          |
| `must`                               | `requirements`                                                                                                |

The production intake's founder/default provenance, missing fields, server state,
pending patches, retries, failures and persistence remain authoritative. This
reference's string values/sessionStorage object are not a new shared schema. Ruler
steps are UI aids; exact valid typed amounts must remain intact. The concept/customer
sample values used by direct review links must never become silent founder input.

`window.bizboxMockup` exposes `getState()`, `navigate(step, focus?, trigger?)` and
`replayLiquid()` for preview control only. The last method name is historical; it
replays only the simple question fade. `BizBoxLiquid` is a compatibility object for
that fade and reduced-motion detection; material/pulse methods are no-ops. It is
not a voice or real-agent adapter. No stable `submitTranscript` hook is promised.

Reuse the existing application workspace context, routes and actual agent reply
handler when integrating chat or voice. The scripted workspace in `app.js` provides
visual placement only. Do not treat its example storefront/rent, staffing change or
Keep/Revert as server-confirmed results.

## Verification

The original local prototype was checked on laptop (1366×768), tablet (820×1180)
and phone (390×844), including all question/review screens, actual dragging,
keyboard adjustment, exact numeric input, Back/Continue and reduced motion.
The simple final transition was additionally checked before/during/after navigation:
identical glass fill, opacity and blur; zero surface transforms or canvas renderer;
no transition ghosts. Review/city/rent/category retained visible CTAs on phone.

Portable handoff checks on the PR candidate passed:

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (847 passed / 35 skipped), `pnpm build`.
- Prettier, Node syntax on all three scripts, relative asset resolution, photo checksums.
- Browser: all 12 question/review states at 1366×768 and 390×844; no overflow,
  visible CTAs; Other/Continue/Back, city photos and disabled cities, exact entry
  and keyboard value synchronization, reduced motion and no captured JS errors.
- Build retained a warning in the existing `recorded-example-loader.ts` about
  broad dynamic filesystem tracing; this PR does not change that loader.

The PR description records the same checks. Recheck
those flows after adapting the reference to React. In production, test saved-state
migration, server errors, keyboard focus, reduced motion, responsive layout and real
submission through the existing intake service. This reference does not establish
production accessibility contrast over every image crop or production performance.

## Voice integration: HAC-111

HAC-111 is parallel production work, with intake as its first intended mount.
Its shared `VoiceAdapter` in `lib/voice/contracts.ts` defines:

- `readContext()`: current `projectId`, `mode`, optional `selectedSiteId`, `scenarioId`,
  `prompt` and `summary`.
- `submitTranscript(text): Promise<string | null>`: invoke the **same typed-message
  action** and return its actual assistant reply, or `null` when nothing should be
  spoken. The existing action owns conversation/profile state and validation.

That work targets a reusable `VoicePanel` under `components/voice`. Confirm its
completed export/props when integrating the HAC-111 branch; it is not included in
this reference. When moving the glass design into the app, position/style that
component's wrapper and replace scripted `sendChat` with the real action first.
Keep validation and explicit Keep/Revert authority in the existing UI; never add
a separate voice conversation/profile store.

The HAC-111 session route keeps the OpenAI key server-side and disables automatic
Realtime responses (`create_response: false`), so business replies still come from
the app's existing handler. Keep live voice out of this scripted reference.
