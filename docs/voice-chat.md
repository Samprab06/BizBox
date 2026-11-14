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

