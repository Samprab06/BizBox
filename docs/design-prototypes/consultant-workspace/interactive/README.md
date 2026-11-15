# Clickable consultant workspace — HAC-130

A local UI/UX prototype of the approved eight GPT Image checkpoints. Open from a repository-root static server:

```sh
python3 -m http.server 4177 --bind 127.0.0.1
```

[Open the prototype](http://127.0.0.1:4177/docs/design-prototypes/consultant-workspace/interactive/).

This is an example-data design surface. It makes **no API, microphone, model or banking calls**. Its local Three.js geometry is illustrative, not Vexcel geography or a Matterport scan. Production implementation remains with HAC-84/77/97/88 and the canonical HAC-128 workspace. No production store or contract was added.

## Try the flow

1. Select an example space, inspect its details and open the modeled interior.
2. Run the baseline; pause, seek or change playback speed. An example hour takes 20 seconds at 1×.
3. Try an experiment, adjust service stations, and explicitly Run the alternative.
4. Compare the two fixed example fixtures, then Keep or Revert. Accepted plans are remembered per location **in memory only**; refresh/restart resets the preview.
5. Switch to Voice. Start demo cycles through listening, thinking and speaking. Mute/End stops the interaction. No microphone is requested.

The bottom checkpoint controls jump to independent demo states and reset the example transcript intentionally. Ordinary site/view/Text–Voice changes preserve history and composer draft. Chat replies and customer paths are scripted examples, not numerical predictions. Staff and average order are intentionally held constant; only the station slider is interactive.

## Reactive orb provenance

`orb.js` uses the existing vertex/fragment shaders from `components/voice/gradient-orb.tsx`, read at source revision `afce9ed11302b9db2c87693f64459debe7a35b16`. The shader text is unchanged; the React lifecycle is adapted to a standalone DOM driver with simulated audio energy. The production adapter continues using actual `levelRef` values. Preserve `LICENSE` (MIT, Goldie contributors / Eclipse Theia IDE Authors) when transferring this adaptation.

Orb motion follows demo speech energy. Hidden or offscreen voice UI, idle/muted states and reduced-motion mode stop the continuous animation. WebGL failure uses a static fallback. Map rendering is demand-driven; only explicit playback owns a customer-motion clock. When the document becomes hidden, its playback RAF stops without advancing elapsed simulation time.

## Layout and handoff

- Desktop: persistent consultant beside a large 3D view, approximately 68/32.
- Tablet/phone: visualization above the consultant, natural page scrolling and no horizontal page overflow.
- Dark translucent panels, restrained periwinkle accent, no green, minimal transitions.
- Vexcel and supported Matterport/floorplan renderer mounting must replace the illustrative scene in production; engine events, metrics and saves must replace fixtures.
- Current selection, scenario, replay minute, conversation and Voice context stay consistent. Saved alternatives are scoped to each location.
- No third-party CDN requests or new dependencies; Three.js loads from existing local `node_modules`.

## Verification

Three modules pass `node --check`. Browser QA covers the following at 1366×900, 820×1180 and 390×844:

- Selection → details → interior → Run → pause/seek → alternative → comparison → Keep/Revert.
- Typed draft and prior location-specific conversation survive Text/Voice and site/view changes.
- Reactive orb listening/thinking/speaking/mute/end; reduced-motion static rendering.
- No horizontal overflow at the three widths; mobile page can scroll between scene and conversation.
- Forced WebGL context loss shows a usable fallback; controls and checkpoint flow remain available.
- Visibility lifecycle stops playback animation; resource inspection shows no `/api/` calls.

Useful screenshots: `desktop.png`, `voice.png`, `mobile.png`. The production application's four repository checks are managed separately; this standalone prototype does not claim live-service acceptance.
