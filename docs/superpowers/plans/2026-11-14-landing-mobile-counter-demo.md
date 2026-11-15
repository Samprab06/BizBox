# Mobile landing and visible counter experiment

User request: render/show mobile demo; one setup must show one checkout, two must show two; three static dots should move. This explicitly resumes mobile work for this landing despite the previous desktop-only priority.

Design: preserve the continuous consultant-to-sandbox story and desktop layout. Use a matching one-terminal edit alongside the existing two-terminal overhead. Keep live customer paths separate from background art, with queue/service dwell and visible movement; static staff must look distinct from customers. All customer motion pauses with pause/offscreen/reduced-motion state. Mobile stacks consultant, substantial scene and readable results with touch controls, and permits local scrolling on short screens. Preserve selected setup on return.

Plan:

- [x] Reproduce phone clipping, static queue and baked-in two checkouts.
- [x] Add failing rendered-output tests for customer motion, counter/staff counts and selected scene.
- [x] Generate/save one-terminal variant with exact prompt/provenance, preserve original.
- [x] Implement scene selection and queue/service motion; improve mobile dimensions/type/tap targets.
- [x] Verify one/two switching, motion/pause/reduced-motion, 390x844,375x667,phone landscape and1440 desktop; show mobile screenshot/demo.
- [x] Run lint/typecheck/tests/build and env/client-bundle checks; record handoff/ticket and local commit only.

Verification: lint/typecheck/build/env/client-bundle checks pass. Full suite with two workers: 1303 passed, 40 skipped. Chromium phone emulation at 390×844 and375×667, 844×390 landscape and1440×900 desktop. Every customer changes position in natural-time samples; pause holds SVG clock exactly and reduced-motion stops it. One/two checkout art and1/2staff/station markers agree with selection; selected proposed80served/6.8min/$144 survives closing.375phone local scroll reaches all results. Production recording and screenshots saved to the task visualization directory; no physical-device/Safari claim.

## Physical layout clarification

Akshar clarified that metrics change but the scene still reads as two counters. The former1/2terminal variant did not communicate the intended physical layout. Preserve the one-counter wall bar; derive a new proposed view with a clearly separate additional counter island. Move the second staff/station marker and customer route to that actual island. Preserve all prior assets. Provide `/landing-demo/mobile` as an interactive390×844 preview, since the chat GIF cannot accept taps. Verify real pointer switching in the iframe and record the changed physical layouts.
