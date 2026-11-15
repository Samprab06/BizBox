# Handoff to the next UI implementer

## What to carry forward

Akshar's final direction is the simple static dark-glass treatment. Earlier liquid
pool/surface-tension experiments were rejected because transitions changed from
clear to translucent. Do not restore those effects. Preserve the concise individual
questions, Other as a disabled Coming soon option, real city photography, disabled preview cities and
GetA5-inspired rulers. See [README.md](README.md) for preview commands and edit points.

The area-preferences question is now a plain typed textarea, per Akshar's follow-up.
Do not show neighborhood suggestion chips or preselected answers. Preserve the
full saved value and unsaved draft through the existing intake save path.

The subsequent main-chat direction lives in
[the Stage 2 handoff](../consultant-workspace/storyboard-2026-11-14/README.md).
It calls for the existing reactive voice orb and a 3D visualization/consultant split.
The older final-screen description below records the first reference revision;
it does not supersede the new Stage 2 layout or production Vexcel/Matterport work.

## Final screen revision

The workspace now uses one city/budget header, one selected-location panel and one
assistant panel. Duplicate brief controls, inert secondary pins and fake interior
view controls were removed. Selected-space details expand in place. The real city
photograph remains a preview, not a geographic map or the listing's own photograph.

Text and Voice are keyboard-accessible tabs over the same in-memory conversation,
composer draft and pending staffing proposal. Switching modes keeps those values
and selected-space disclosure state. Voice history expands on demand, replacing
the static orb, rather than squeezing another conversation below it. Keep/Revert
stays visible and applies to the same preview profile in either mode.

The microphone button is disabled and labelled as disconnected. No audio session,
permissions, model requests or second chat store is added. The final voice surface
is placement guidance for HAC-111's reusable component, not a substitute client.
Chat drafts are not saved as onboarding profile fields. Drafts/messages remain
transient across reloads, as in the original scripted prototype.

Checked the revised Text/Voice UI at 1366×768, 1024×768, 820×1180 and 390×844:
no horizontal overflow, mode tabs and composer within their panel. Actual UI checks
covered typed draft retention, shared history, pending proposals across modes,
Keep/Revert, location detail retention, arrow-key tab switching/focus, Edit brief
and reduced motion. The photo/assistant stack scrolls vertically on phones.

## Integration seams

The actual intake lives in `components/intake/intake-screen.tsx`, with profile and
validation in `components/intake/profile.ts` and API adaptation in
`components/intake/live.ts`. Reuse those state/update/submission paths; do not mount
a parallel production profile or chatbot from this prototype.

| Prototype field/value                | Existing intake field/value                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `concept`                            | `concept`                                                                       |
| `category: Coffee shop`              | `category: Coffee shop`                                                         |
| `category: Quick food`               | `category: Quick-service food`                                                  |
| `category: Salon`                    | `category: Salon or barber`                                                     |
| `category: Fitness`                  | `category: Fitness studio`                                                      |
| `category: Other`                    | **Disabled / Coming soon**; a custom-business workflow is outside current scope |
| `target`                             | `customers`                                                                     |
| `city`                               | `city` (Houston / Los Angeles)                                                  |
| `preferences` plus `neighborhoods`   | `areas`; preserve favor/avoid meaning                                           |
| `rent`, `buildout`, `hours`, `staff` | Corresponding intake field, with production validation                          |
| `price: Value / Mid-range / Premium` | `price: Budget / Midrange / Premium`                                            |
| `must`                               | `requirements`                                                                  |

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
  visible CTAs; Continue/Back, city photos and disabled cities, exact entry
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

## Latest scope correction

Other is a disabled Coming soon preview, not an available custom-business flow. Legacy saved Other/unsupported categories return to the category question without selecting a replacement or dropping other answers. The four supported categories remain selectable.

Interior feedback: Akshar reports choppy movement and unclear insight/capabilities. No interior renderer changes are part of this update. Before extending movement, define the operating question, event-derived metrics, one shared exterior/interior clock and a paused/scrubbable comparison. Exterior trip paths and indoor placements are illustrative; neither should imply measured traffic or verified physical geometry. Track legibility and actual foreground performance in the existing interior/simulator work.

Other update checks: targeted ESLint, Node syntax, formatting/diff checks passed. Browser verified four active categories, disabled Other with Coming soon label, Salon continuation, no phone overflow, and legacy Other returning to category with other answers retained and explicit validation.
