# BizBox Voice Chat Implementation Plan

> **For agentic workers:** Use the manager's bounded frontend/backend work orders.

**Goal:** Add opt-in Goldie-style voice that shares the client's existing BizBox state.

**Architecture:** Native WebRTC connects through a server-only OpenAI setup route.
The voice adapter submits completed transcripts to the existing UI action and
requests speech only for its reply. React controls and a portable integration
contract reuse this controller, without a second chat backend.

**Tech Stack:** Existing Next.js/React/TypeScript/Zod, native WebRTC/Web Audio/WebGL.

**Spec:** `docs/voice-chat.md` and Linear HAC-111.

## Global Constraints

- No new runtime dependency, production mutation, deployment or unrelated UI work.
- Standard API key remains server-side; fixed OpenAI API destination.
- No paid request on load; 512 output tokens and 180-second browser session bound.
- Preserve Goldie MIT notices, existing typed behavior and all current UI state.
- The client UI chat owns its prototype and supplies its mount/adapter integration.

## Review Focus

- Stopped/replaced sessions must not emit late audio or duplicate business turns.
- Malformed/untrusted context must not choose credentials, hosts, tools or prompts.
- Voice denied/unavailable must preserve working typed input and form validation.
- Current site/scenario/profile edits must remain newer than stale voice callbacks.
- Orb resources must stop offscreen/unmounted/reduced-motion; repeated starts must
  not accumulate microphones, peer connections or GPU resources.

### Task 1: Backend setup route

Files: `app/api/voice/session/{route,handler,handler.test}.ts`, optional
`lib/voice/server.ts` plus test, `.env.example`.

Consumes: `VoiceSessionRequestSchema`, `VOICE_LIMITS` from `lib/voice/contracts.ts`.
Produces: GET configuration status and POST SDP answer/sessionSeconds contract.

- [x] Write failing tests for valid setup/config, missing key, malformed/oversized
      SDP/context, cross-origin rejection, bounded upstream request and safe errors.
- [x] Implement fixed-host OpenAI multipart calls, controlled-response session
      settings and best-effort local request bound; preserve text-agent settings.
- [x] Run focused tests, then report server contract/config decisions to manager.

### Task 2: Reusable controller, orb and client mounts

Files: `lib/voice/client.ts` and tests, `components/voice/*`, a narrow mount/change
in `components/intake/intake-screen.tsx`, `tests/e2e/voice.spec.ts`, client adapter
files agreed with the client UI owner. Do not edit the owner's prototype sources.

Consumes: shared context/session contracts and backend endpoint; adapter callbacks
`readContext()` and `submitTranscript(text):Promise<string|null>`.
Produces: reusable voice controls/controller with explicit lifecycle and audio refs.

- [x] Write failing controller tests for deduplicated serialized transcripts,
      unchanged action state, permission failure, stale generation, stop and cleanup.
- [x] Port Goldie orb/helpers with normal React imports and lifecycle safeguards.
- [x] Implement native transport, real audio analysis and controlled speech events.
- [x] Route voice through the same production intake submission as typed input;
      verify live and offline form behavior without changing validation/persistence.
- [x] Demonstrate the agreed client UI adapter using the owner's actual contract.
- [x] Run mocked browser controls/state/permission/cleanup tests and viewport/axe
      checks; retain no paid call requirement for ordinary tests.

### Task 3: Manager integration and delivery

- [x] Review shared boundaries and an independent security/lifecycle review.
- [x] Verify no key/client-bundle leakage or new dependency; inspect final diff.
- [x] Run repository checks sequentially plus affected intake/voice browser suite.
- [x] Record actual live verification limits, update docs/ticket and publish a
      focused PR under existing push/PR authorization. No merge or deployment.
