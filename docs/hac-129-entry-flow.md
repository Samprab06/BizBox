# HAC-129: BizBox landing entry flow

This note covers the slice of HAC-129 that gives the BizBox landing a real way into the app. It does not rebuild the landing (HAC-115 to HAC-121), the guided onboarding (HAC-127) or the workspace (HAC-128).

## Routes

| Route | What it is |
|---|---|
| `/` | The BizBox landing from #96. `next.config.ts` rewrites `/` to `public/landing-preview/index.html`, so the URL stays `/` and nobody needs to know `/landing-preview/index.html`. Assets and scripts use absolute `/landing-preview/...` paths so the document works at any URL. |
| `/start` | The landing's call-to-action target (`app/start`, `components/landing/start-gate.tsx`). It reads the existing intake session and decides where to go. |
| `/projects/houston-coffee/intake` | Guided onboarding (HAC-127). A first visit lands here. |
| `/projects/houston-coffee/workspace` | The workspace (HAC-128). A returning founder reaches it from `/start`, or straight from the landing's last stage ("Already started? Open your workspace"). |
| `/projects/houston-coffee/simulator` | The live Cesium + Vexcel map. The landing's location stage frames this route. |

### How `/start` decides

`components/landing/entry.ts` is pure and unit-tested. The session is read with `intakeStorageKey` and `parseIntakeSession` from `components/workspace-screen/intake-conversation.ts`, which is the same record the onboarding, the workspace assistant, the context bar and the site search use. Nothing is written and there is no landing-side store.

- No saved session, or one holding only defaults: `router.replace` to the guided onboarding.
- A session with a founder answer or message and a complete profile: "Welcome back" with "Open your workspace" and "Review your answers".
- A started but incomplete profile: "Continue onboarding" and "Open your workspace".

## Landing changes (small, link-level)

- `index.html`: absolute asset, stylesheet and script paths; call-to-action `href="/start"` (works without JavaScript); brand link to `/`; a "workspace" link in the final stage; favicon.
- `config.js`: new `ENTRY_URL` (`/start`); `PRODUCT_PREVIEW_URL` now the simulator route instead of the example map.
- `app.js`: the `.demo-link` anchors take `config.ENTRY_URL` instead of `config.DEMO_URL` (three lines). Nothing in the scene, camera or scroll logic changed, so this should merge cleanly with the HAC-115 to HAC-121 work.
- `style.css`: four lines styling the final-stage workspace link.

Unchanged and still labelled as such: the Coffee Port Matterport tour stays a reference ("Matterport demo · The Coffee Port" with a source link), and the demo stage still shows the existing example replay until the staffed-counter route is integrated.

## Product name

The landing, `/start`, the root metadata title and the project header now say "BizBox" (previously "Sitework"). The two e2e specs that asserted the old header name were updated. The intake session's localStorage key keeps its `sitework:` prefix on purpose: renaming it would orphan saved sessions.

`/` used to redirect to the intake. The one in-app link that relied on that ("Open example project" on the unknown-project error) now points at the example project's intake directly.

## Iframe unloading

The landing is its own document, so every navigation into or out of it is a full page load and the browser tears down its frames. Inside the page, the existing logic removes `src` from the map and tour frames when their stage is left. Both are covered by e2e.

## Why the vendor bundle stays

`vendor.js` (Three.js 0.187.0 + GLTFLoader + RoomEnvironment) is loaded by `app.js` as a plain ES module from `public/`. Replacing it with the app's `three` dependency means porting the 25 KB camera and scroll choreography into the Next bundle, which is HAC-115's work and would conflict with Akshar's local changes. It is wrapped, not ported. Do that port when the final MacBook transition is decided.

## Tests

`tests/e2e/landing-entry.spec.ts` (all network mocked; no live calls):

- `/` is served at `/`, titled BizBox, `/landing-preview/index.html` is never requested, no "Sitework" text.
- The location stage frames the simulator route, the tour stage keeps its reference label, and frames unload when scrolled away or when the page is left.
- Keyboard order (skip link, brand, call-to-action, Enter), reduced motion, and no horizontal overflow at 390, 768 and 1280 px.
- Landing to onboarding (first visit), the answer landing in the shared session, then landing to `/start` to "Continue onboarding"; and a finished profile to the workspace.
- `/start` at phone width.

`components/landing/entry.test.ts` covers the routing decision. `tests/e2e/smoke.spec.ts` replaces the old "/ redirects" check.

## Still pending (Akshar's HAC-115 to HAC-121 and others)

- The MacBook model, camera sequence and final transition.
- The map selection scene and the property-to-interior walkthrough with real data (HAC-116, HAC-118, HAC-119).
- The staffed-counter story and real comparison (HAC-104, HAC-120); the demo stage is an example replay for now.
- Landing copy: the six headings and "Try a demo" are the draft's, not accepted final copy. "Try a demo" now opens onboarding, so the label may want to change.
- The simulator and replay frames render the app's project header and padding; an embed mode would make the framed map cleaner.
- The workspace city photo stays labelled a preview until HAC-84 and HAC-85 supply the real map.
- Back/Edit navigation and shared Text/Voice draft checks beyond the entry path belong to the onboarding/workspace owner's part of HAC-129.
- Pre-existing, unrelated: the axe scan of the simulator view reports `label-content-name-mismatch` on three nodes.

## Open questions for Akshar

1. Final MacBook transition: enter the display (latest discussion) or exit right (earlier proposal)?
2. Staffed counter: a satisfying button press, or an unfold driven by scrolling?
3. Should the landing's call-to-action keep "Try a demo", or say something like "Get started" now that it opens onboarding?
4. Is a returning-founder chooser at `/start` right, or should a finished profile skip straight to the workspace?
5. Should the landing frame the simulator (live Cesium load) on phones, or show the poster there to save bandwidth?
