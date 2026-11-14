# HAC-129: onboarding and workspace against the #90 design

Scope of this pass: the merged guided onboarding (#104, `components/onboarding/*`) and the
merged workspace (#105, `components/workspace-screen/*`) compared with the design reference
in `docs/design-prototypes/bizbox-onboarding/` (#90). The landing entry flow
(HAC-115 to HAC-121), `lib/contracts/*` and the map/interior work (HAC-84/85/104) are out of
scope and untouched.

Method: the production build was run locally and each screen was compared with the #90
screenshots and CSS at 1280, 768 and 390 px wide. Behaviour was checked with Playwright
against mocked network responses (no live model, voice or listing service).

## What already matched #90 (kept as is)

- One question per screen, concise titles, Back/Continue/Skip, validation messages.
- Other is disabled with a Coming soon label; New York, Chicago and Miami are disabled
  Coming soon placeholders; Houston and Los Angeles use real photos.
- Photo credits: a one-line credit with author and license links under the stage, and the
  workspace photo credit linking to `/workspace/credits.html`.
- Rent, buildout and staffing use the curved ruler with exact numeric entry, keyboard steps
  and bounded drag; typed values are never rounded to a detent.
- Constant glass (no animated blur or fill), a 120 ms fade on the incoming question that is
  removed under reduced motion.
- Workspace: one city/budget header, one selected-location panel, one Assistant panel with
  Text and Voice tabs over one conversation and one pending draft; the city photo labelled
  "City preview · photo, not a map".

## Gaps fixed in this change

| # | Gap | Fix |
| - | --- | --- |
| 1 | The onboarding stage sat inside the shell's white card under a second "Intake" page title, so the dark glass was framed in a white box and lost width on phones. | The guided questions now render directly on the stage under the project navigation. The page keeps a single level-one "Intake" heading for assistive technology (visually hidden). `?mode=form` keeps the existing page chrome. |
| 2 | Glass was narrower (36 rem) and denser (fill 0.62) than #90 (45 rem, `rgba(16,19,27,.44)`). | Width 45 rem, fill 0.44. |
| 3 | The 12 px backdrop blur never reached Chrome: the CSS pipeline dropped the unprefixed `backdrop-filter` from the CSS module, so the computed value was `none`. | The blur is a `backdrop-blur-[12px]` utility on the glass; a test asserts the computed fill and blur. |
| 4 | Finishing onboarding linked to the Map, skipping the workspace screen (#105) that is meant to follow it. | The review's final action is "Open workspace", keeping the selected `?site=`. |
| 5 | Workspace selected-location card: at 640 px and wider the Details button jumped before the title and squeezed the name into two lines. | Explicit grid columns (title, stats, Details). |
| 6 | Missing data was invisible: an example space showed only Area, so rent looked absent rather than unknown. | A "Monthly rent: Not listed" stat for example spaces. Live listings already showed "Unknown" with the source. |
| 7 | The Voice tab showed a light "paper" card inside the dark workspace. | `VoicePanel` takes an optional `tone="dark"` (styles only; behaviour, adapter and API calls unchanged). The light intake mount is unchanged. |
| 8 | Edit brief dropped the selected space, so returning from Edit changed the selection. | Edit brief carries `?site=`; the review's "Open workspace" carries it back. |
| 9 | The unsent assistant message was lost on Edit brief, navigation and reload, and the detailed form's composer had its own separate draft. | One tab-scoped draft (`sessionStorage`, key `bizbox:assistant-draft:v1:<projectId>`) used by the workspace composer (Text and Voice tabs) and the detailed form's live composer. It holds only the composer text; it is not a profile or chat store and is cleared when the message is sent. |
| 10 | Two copies of the intake request/merge logic (`IntakeForm.sendLive` and the workspace hook) could drift. | `components/workspace-screen/intake-conversation.ts` is the single implementation (request body, POST and error mapping, merge of reply with in-flight edits). The detailed form now calls it and keeps its own wording through an `IntakeCopy` object. |
| 11 | A pending capability looked like a missing feature: #90 shows staffing proposals and Keep/Revert, which production cannot do. | A visible line in the assistant panel: "Staffing changes and Keep/Revert are not connected yet." No scripted proposal, chip or result was added. |
| 12 | An existing e2e (#105) opened the guided questions and expected the conversation list, which only the detailed form shows. | It now opens `?mode=form`. |

## One shared session, as built

- **Profile and conversation:** the existing intake session in `localStorage`
  (`sitework:intake:v1:<projectId>`). Onboarding commits answers through the intake screen's
  own save path; the workspace reads the same record and appends chat to it through the same
  request/merge functions. There is no second profile or chat store.
- **Text and Voice:** both call `useIntakeConversation().submit`, which is the typed-message
  action; `VoicePanel` gets it through the existing `VoiceAdapter`. Replies shown are the
  intake agent's actual `assistantMessage`; offline, nothing is sent and no reply is invented.
- **Draft:** see gap 9. **Selected space:** the `?site=` query, carried by Edit brief and
  the review's Open workspace.
- **Reload and resume:** the profile and history reload from `localStorage`; the guided flow
  resumes at the first missing question or the review; the draft reloads from the tab.

## Open questions for Akshar (not changed; need a design decision)

1. **Product name in the shell.** The shell header, page `<title>` and design-system doc say
   "Sitework"; #90 shows the BizBox mark. The shell and metadata are shared, so a rename
   belongs to one owner. Internal storage keys (`sitework:intake:v1:`) must stay to keep saved
   sessions working. Who renames the shell, and is a migration of the key wanted?
2. **Palette and glass policy.** Production workspace uses the design system's dark-green
   viewport tokens (`#101b16`), and `docs/design-system.md` allows glass "only for controls
   floating over a map or 3D view". #90 uses navy glass over a blurred city photo for both the
   onboarding and the workspace. Keep the production tokens, or adopt #90's navy glass for these
   two screens (and update the design system)?
3. **Focus mode.** #90 onboarding is full viewport with only the logo. Production keeps the
   project context bar and task navigation above the stage so a founder can leave. Should
   onboarding hide them?
4. **Credits on the question screens.** The #90 README says no consumer-facing credits on the
   question screens; the ticket says preserve photo credits. This change keeps the one-line
   credit (the CC BY-SA photo requires attribution). Confirm, or move it to a credits page link.
5. **Assistant status wording.** #90 shows a static "Preview" badge. Production shows the real
   Checking/Live/Offline state. Keeping the real state; confirm.
6. **Staffing proposals and Keep/Revert.** Needs a backend capability and a ticket before any
   UI. Until then only the note in gap 11 is shown.
7. **City pin.** The pin over the photo opens the selected space's details. It is not a
   location on a map; the real map arrives with the connected workspace (HAC-84/85) and the
   label "City preview · photo, not a map" stays until then.
8. **Opening the workspace.** Should a returning founder with a complete profile who opens
   `/intake` still land on the review (current), or go straight to the workspace?

## Verification evidence

See the PR description for commands and results. Layouts were checked at 1280, 768 and 390 px
with no horizontal overflow (asserted in `tests/e2e/onboarding-workspace.spec.ts`).
