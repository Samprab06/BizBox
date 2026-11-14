# BizBox consultant landing refinement implementation plan

**Goal:** Implement Akshar's approved consultant-to-sandbox narrative and visual revision while preserving prior assets/routes.
**Spec:** docs/superpowers/specs/2026-11-14-landing-guided-demo-design.md, subsequent visual/narrative sections, approved by “ok do this”.
**Architecture:** Existing standalone Next.js `/landing-demo`, prepared generated images and DOM UI; no live provider/agent or new dependency. Reuse actual prepared seeded experiment outputs.

## Ownership and interfaces

Manager: GPT media and measured frame manifest; local font/provenance; docs, ticket coordination, integration and browser/repository verification. Frontend specialist: components/landing-demo presentation/timeline/tests and app/landing-demo/page.tsx; exclude manager-owned demo-data files. Shared files remain serialized.

Media contract: `/landing-assets/guided-demo/macbook-gpt-v3.png` and matching `macbook-gpt-v3.json` {image,width,height,screenQuad:[TL,TR,BR,BL] normalized}; `/landing-assets/guided-demo/location-close-v2.png`, `/landing-assets/guided-demo/cafe-exterior-v2.png`; existing wide map/interior/overhead retained. Actual client onboarding background is `/onboarding/houston-real.jpg` with Ferris wheel, source credit preserved. Font supplied locally, no runtime font host.

## Tasks

- [ ] Generate photorealistic frontal 2D MacBook cutout, measured aperture; closer view of the selected example location and matching street exterior. Save exact prompts, native dimensions and provenance.
- [ ] Install a local approved open-source font asset with license/provenance; apply through local Next font loader, no dependency or service.
- [ ] Extend pure timeline contract/tests for selected-building zoom and exterior transition, readable heading reveals, rent from1 to3000 in600–800ms, and onboarding gated after full entry.
- [ ] Replace Blender frame in the current route; preserve old sources. Use uniform zoom to the screen, hold heading until fullscreen, then7000ms clear onboarding beats with stable panel and fluid outgoing/incoming transitions. Reduced motion shows final values/brief.
- [ ] Rebuild location/property beats as Compare locations / Test this location: consultant brief -> shortlist -> selected building zoom -> matching exterior and property assumptions -> same interior -> counter experiment. One primary experiment; no invented rank/score or new exterior forecast.
- [ ] Use one coherent consultant/scene/inspector grid, shared type hierarchy and compact actual demo findings. Remove prose paragraphs, redundant bottom chapter pill and vague tour framing. Simple glass navbar links.
- [ ] Make glass substantially clearer: low tint/blur, localized lens-edge refraction instead of noise, thin bright rim and restrained reflections; crisp content and fallback. Account for existing CSS pipeline stripping backdrop-filter: retain inline effect or verify equivalent.
- [ ] Browser verify desktop/phone/landscape, continuity/zoom, all chapters, word reveal timing, number endpoints, pause/replay/skip, reduced motion, fallback and no provider traffic. Independently review material code boundaries; run lint/typecheck/test/build and env/bundle checks.
- [ ] Update durable handoff/tickets and local commits. No push, merge or deployment.
