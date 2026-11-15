# BizBox voice chat (HAC-111)

Akshar requested Goldie's reactive voice orb now, integrated with the active client
UI work and delivered through a dedicated ticket, branch and PR. The existing
glass onboarding prototype is owned by the client UI chat (HAC-112); its source
is not copied into the app or overwritten by this task.

## Approach and ownership

The chosen implementation uses native WebRTC with OpenAI Realtime for microphone
transcription and controlled spoken replies. Completed transcripts go through a
`VoiceAdapter.submitTranscript` callback that invokes the same action as typed
input. That existing action owns conversation state, profile validation and
selected-site/scenario changes. Its returned reply is the only text requested for
speech. Automatic Realtime responses are disabled. This trades a little response
latency for one authoritative BizBox conversation rather than a second agent.

An autonomous Realtime business agent would duplicate the current intake/tools
state. A separate upload/transcribe/TTS pipeline would avoid WebRTC but adds new
recording/upload/playback plumbing. Neither is needed for this slice.

- Backend owns `/api/voice/session`, its tests and server configuration. The
  standard key is sent only to the fixed OpenAI API endpoint. SDP and context
  sizes, upstream wait time and output tokens are bounded; errors are generic.
- Frontend owns a reusable controller, Goldie orb port, controls, the production
  intake mount and the client UI integration adapter. Native browser APIs avoid a
  new runtime dependency. Goldie source stays read-only and MIT notices remain.
- The manager owns shared contracts, cross-chat coordination, integration and
  review. The client UI chat owns its prototype files and mount point.

## Contract

`GET /api/voice/session` reports `{configured:boolean}` without making a model
request. `POST /api/voice/session` accepts `{offerSdp, context}` and returns
`{answerSdp, sessionSeconds}`. `context` contains a required project ID and optional
mode, selected site/scenario IDs, current prompt and a short summary. It cannot
select an API host, model, tools or system instructions. The server validates this
context but does not send it to the speech session: the existing app action
already owns the business context.

The adapter supplies `readContext()` and async `submitTranscript(text)`, returning
the actual assistant reply or `null`. The controller does not persist business
state. Completed transcript IDs are deduplicated; turns are serialized. Stop
prevents late voice output, closes tracks/peer/audio/animation resources, and does
not undo a message already submitted to the existing business action.

Audio commits define turn order because transcript completions can arrive out of
order. Each turn captures its question/context; a changed prompt or selected
context suppresses the stale answer instead of applying it to the next field.
The owning intake queue rechecks that prompt before applying the answer. Muted
commits remain suppressed even if transcription completes after unmuting.

## Client UI mount

`components/voice/voice-panel.tsx` exports `VoicePanel`; its adapter type lives in
`lib/voice/contracts.ts`. The production mount is `components/intake/intake-screen.tsx`.
The HAC-112 final-screen layout can reuse the same component:

```tsx
<VoicePanel
  adapter={voiceAdapter}
  title="Talk about this space"
  label="Voice conversation"
  className="my-0"
/>
```

Build `voiceAdapter` around the screen's real state and existing typed submission
action. `readContext()` reads the visible project/site/scenario/prompt;
`submitTranscript(text)` awaits that same action and returns its actual reply or
`null`. Keep the conversation, text draft and pending Keep/Revert state above a
Text / Voice conditional mount. Unmounting `VoicePanel` stops its resources; it
must not clear the parent conversation or undo an applied action. The scripted
HAC-112 prototype is a design reference and does not enable paid voice.

## Configuration and limits

The session is opt-in. No paid request or microphone acquisition occurs on page
load. Microphone permission denial, missing keys, upstream errors and unsupported
WebRTC leave typed input working. Muting disables input tracks. Speech interruption
cancels queued audio without inventing a new business action. Output is bounded
to 512 tokens; the browser ends a voice connection after 180 seconds. This browser
timer is a UX bound, not a server-enforced billing guarantee.

The server defaults to `gpt-realtime-2.1-mini`, `gpt-live-transcribe`, and voice
`marin`, with separately named optional model environment overrides. Existing text
agent `OPENAI_BASE_URL` is not inherited. Session creation is same-origin and uses
a best-effort global bucket of five valid setup attempts per minute per process;
failed provider setups consume a slot. Cold starts and multiple instances have
independent buckets. This is not distributed rate limiting or a billing guarantee.
Deployment-wide authentication/budget policy is unchanged. Setup has an overall
15-second deadline, including request/response streaming; each body is capped at
128 KiB and each SDP at 64,000 characters before returning a safe error.

`OPENAI_REALTIME_MODEL` and `OPENAI_VOICE_TRANSCRIPTION_MODEL` are optional
server-only overrides. `GET` reports usable local configuration, not provider
quota or a successful connection. Voice can therefore be configured while a key
is out of budget; text remains available when connection fails.

## Verification and delivery

Mock upstream/browser boundaries for deterministic route, lifecycle, transcript,
shared-state, interruption and cleanup tests. Exercise microphone denial, stale
turns, malformed events, retries, secret containment, reduced motion and WebGL
fallback. Check mobile, tablet and desktop controls/accessibility, then the full
affected intake and voice E2E flows. Run lint, typecheck, unit tests and build
without overlapping heavy suites. Live paid audio remains unverified: on
2026-11-14 the project lead reported that the shared key had exhausted its budget
and instructed agents to use mocks only. The main checkout has `OPENAI_API_KEY`
in its private `.env`; new Git worktrees do not inherit that file. Fixtures never
imply live success.

Use one focused branch and PR with separate reviewable server/client changes.
Do not modify unrelated client prototypes, global setup, production environment,
database schema, deployments or the known Vercel preview issue.

## Official references

- https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini

## Verified candidate (2026-11-14)

After integrating main `4eafc9a`, `pnpm lint`, `pnpm typecheck`,
`pnpm test --maxWorkers=2` (929 passed, 40 gated skips) and `pnpm build` passed.
The build retains the existing recorded-example tracing warning. Client static
bundles contain no server credential/config identifiers; dependencies are unchanged.

Against an isolated production server on port 3111, the voice, offline/live intake
and context-bar Playwright suites passed all 108 cases across Chromium, WebKit
and mobile Chromium. Controls passed axe/overflow checks at 375/768/1280px, reduced
motion, WebGL fallback and navigation cleanup. Provider/browser media boundaries
were mocked: these checks do not prove live provider acceptance or audible output.

Independent server review and targeted client re-review cleared the confirmed
ordering, out-of-band cancellation, muted-buffer and stale-prompt races. The
reviewer independently reran 50 route/controller cases. Goldie MIT notices are
retained in `components/voice/LICENSE`.

## Microphone readiness and recovery (HAC-172)

The client snapshot's `microphoneReady` is local UI state, not an adapter or
server contract. It becomes true only when this client owns a stream with a live
audio track; a muted live track still supports Unmute. Waiting for microphone
permission and connecting the voice session are separate messages. Mute is a
no-op/disabled without that evidence, and Stop speaking also waits for the
connection. Stop voice remains available during setup so the founder can cancel.
A microphone acquired after cancellation is stopped before any setup request.
Stopping, connection loss, or loss of the last live microphone track clears
readiness and closes owned resources.

Microphone permission denial points to the browser's site settings and allowing
Microphone. Missing devices prompt connecting/selecting a microphone; busy or
unreadable devices prompt checking the selected device and another app using it.
Unavailable capture support points to a supported browser and HTTPS. A provider
or connection setup failure has separate retry copy rather than being labeled a
permission denial. Raw device/provider error text is not shown. Each recovery
message points to the existing Text tab, which remains one click away with the
same draft/history; no new conversation, composer or adapter is introduced.
Compact and full VoicePanel consumers retain the same lifecycle and orb meters.

Unit and browser tests use fake tracks/peers and intercepted session responses for
pending permission, denial, missing/unreadable/unsupported microphones, setup,
ready, disconnect and cancellation. They do not record audio or call a provider.

## Reply playback and workspace controls (2026-11-15)

Workspace voice uses the same conversation submission and action dispatcher as
text, including comparison tools and navigation. The compact panel shows the
transparent orb before activation, with status and controls underneath; it does
not introduce a separate glass card or change onboarding styles.

Mute microphone affects input only: a submitted turn can finish and speak while
the microphone is muted. Stop speaking cancels output; Stop voice closes the
session. Unconfirmed voice activity cannot cancel an agent reply still being
computed or waiting for its audio response ID. A completed new transcript or
speech detected during started output still interrupts the previous reply.

Context checks retain project, page, selection, comparison, scenario and prompt
identity while ignoring changing replay time and progress. Long replies speak a
bounded excerpt and retain the full written response. Empty replies, failed
output and playback timeouts show short recovery statuses without exposing
provider errors. Existing session, transcript and output limits are unchanged.

Regression tests cover pending replies, muted input, noisy activity, long replies,
failed output and replay progress. Workspace browser tests cover the idle orb and
a spoken comparison command through the text-agent route and comparison action
to Results, followed by output while muted and explicit cancellation. These use
mocked transport and do not establish live microphone/provider playback success.
