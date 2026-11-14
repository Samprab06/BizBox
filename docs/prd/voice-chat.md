# BizBox voice chat PRD

Owner: Akshar. Delivery ticket: [HAC-111](https://linear.app/hackprinceton/issue/HAC-111/voice-integrate-goldie-reactive-voice-chat-with-bizbox-client-ui).
Last updated: 2026-11-14. Status: implemented; local verification passed; live audio pending.

## Goal

Let a founder speak to BizBox with Goldie's reactive orb while continuing the
same conversation and business profile used by text input. Voice should fit the
client UI being developed in HAC-112, including its final-screen Text / Voice
toggle, without introducing another conversation or profile store.

## User experience

1. The founder starts voice explicitly. Loading a screen does not start the
   microphone or a paid session. The UI explains that voice is AI-generated and
   microphone audio is sent for transcription.
2. The orb reacts to actual input/output audio. Connecting, listening, thinking,
   speaking and failure states remain understandable without animation.
3. A completed spoken answer uses the same action as a typed answer. Existing
   validation, persistence, profile edits and errors remain authoritative.
4. BizBox requests speech for that action's actual reply. The written reply
   remains available; voice does not independently decide business changes.
5. The founder can mute the microphone, stop speaking, stop voice, or continue
   typing. Stopping voice does not undo an answer already submitted.
6. When voice is unavailable or denied, typed input remains usable and the UI
   offers a clear retry or text path.
7. If the current question or selected context changes while an answer is still
   being transcribed, discard that stale answer and ask the founder to repeat it.
   Audio committed while muted stays discarded after unmuting.

## Scope and acceptance

| Requirement                 | Acceptance evidence                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse Goldie's orb          | Port its WebGL renderer and audio helpers with MIT notices; static fallback and reduced-motion/offscreen handling.                                                                                    |
| Share existing intake state | Spoken and typed answers use one submission action; validation, newer field edits, storage and persistent context bar remain in sync. A late answer cannot silently populate the next question.       |
| Integrate the client UI     | Reusable `VoiceAdapter` and `VoicePanel`; production intake is the first mount. HAC-112 owns the glass layout and toggle. Its scripted prototype must use the real action before enabling live voice. |
| Protect credentials         | Standard API key stays server-side; session setup uses a fixed OpenAI endpoint, bounded input and safe errors.                                                                                        |
| Keep usage opt-in           | No paid request on load; 512-token speech-output setting, 180-second browser session, bounded setup deadline and best-effort local setup throttle. These are not a distributed billing cap.           |
| Handle lifecycle safely     | Deduplicate/serialize transcripts; ignore stale callbacks; close microphone, peer connection, playback, timers and audio/render resources on stop or unmount.                                         |
| Preserve accessibility      | Keyboard-operable controls, readable status, mobile/tablet/desktop layout and reduced-motion support.                                                                                                 |
| Verify honestly             | Deterministic route/controller/browser tests and repository checks; distinguish mocked proof from live provider/audio verification.                                                                   |

## Boundaries

This delivery adds voice transport and a production intake mount. It does not
replace the existing business agent, redesign the entire client UI, enable voice
inside the scripted design reference, add an authentication or budget system,
deploy the app, or merge either PR. The adapter supports current project, site,
scenario and prompt context; the existing app action owns what that context means.

## Delivery and verification record

- Server route: 32 mocked tests and independent review passed.
- Client integration: production intake shares its typed/voice action queue and
  notifies the existing persistent context bar after a saved answer. HAC-112's
  owner added the shared adapter contract to its handoff; its final-screen voice
  view remains a scripted design reference until connected to the real app action.
- Local checks: lint, typecheck, unit tests (929 passed, 40 gated skips), and
  production build passed after integrating main `4eafc9a`. The build retains an
  existing recorded-example filesystem-tracing warning outside this change.
- Browser verification: 108 affected intake/voice/context cases passed across
  Chromium, WebKit and mobile Chromium. At 375/768/1280px, controls passed overflow
  and axe checks, reduced motion, WebGL fallback and navigation cleanup.
- Independent review: server boundary and client timing fixes cleared; 50 focused
  route/controller tests independently rerun. No unresolved findings.
- Live provider acceptance and microphone-to-speaker behavior: pending. The
  project lead reported the shared key exhausted its budget on 2026-11-14 and
  instructed agents to use mocks. The main project's private `.env` already has
  `OPENAI_API_KEY`; credentials are not committed or copied into the prototype.
- Implementation contract and operational limits: [voice-chat.md](../voice-chat.md).
- Client UI design handoff: HAC-112, [PR #90](https://github.com/Samprab06/BizBox/pull/90).

## Keeping this PRD current

Update this document in the same PR whenever voice behavior, supported surfaces,
the adapter contract, usage limits or verified capabilities change. Record the
ticket and verification evidence for each material revision. When the client UI
lands, replace the pending integration description with its actual mount and
shared-action path. When an authorized key has budget, record a real opt-in audio
check before marking live verification complete.

| Date       | Revision                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-14 | Initial requirements from Akshar; HAC-111 implementation, HAC-112 integration contract, stale-turn/mute guards, verified local/browser results and explicit live-verification limit. |
