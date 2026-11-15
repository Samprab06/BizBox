# BizBox landing checkpoint — HAC-114

**Current implementation:** the refined café story now serves `/`, with the current handoff in [location-story.md](../../design/landing/guided-demo/location-story.md). Akshar explicitly requested pushing and merging it as the site homepage. The remaining text is the historical HAC-114 prototype record; its earlier discussion and approval boundaries do not describe the current release. The static prototype remains available at `/landing-preview/index.html`.

This draft preserves the current landing prototype and design work so it can be reviewed and continued. It is not the final landing page and does not replace the application's homepage.

## Open the preview

After the repository's normal setup, run `pnpm dev` and visit `/landing-preview/index.html` on that server. The page is a static, self-contained prototype served by Next.js. Its map and demo links use the same origin rather than a developer's localhost ports. The full counter-comparison route was not on main at this checkpoint, so **Try a demo** opens the existing example replay.

The location view can ask for a completed intake before live search and retains its labeled example map. The Matterport view embeds **The Coffee Port**, a public demonstration scan, not a Houston candidate property. Its frames are not captured or exported. No secrets or SDK keys are included in the prototype.

## What is preserved

- `public/landing-preview/`: centered sunset/liquid-glass prototype, six stage headings, camera entry through the MacBook display, responsive layout, short control feedback, local headline reveals, and a sliding progress indicator.
- `public/landing-preview/assets/`: original generated city/storefront/interior backgrounds, GPT Image logo, local product-interface texture, and Blender-authored laptop GLB.
- `design/landing/`: editable Blender file and modeling script. The script writes the GLB to the preview assets and the source blend beside itself. It must be run in Blender; no Python is deployed as an application runtime.
- `content-and-ux-draft.md` and `wireframe.html`: the later content proposal. The HTML is a wireframe fragment that can be opened in a browser; section numbers are review annotations, not final website copy.
- `reference-principles.md`: relevant principles transferred from Akshar's supplied reference handoff. The reference archive, videos, frames, and transcripts are not redistributed in this PR.
- `logo-prompt.md` and `image-prompts.md`: generated-asset provenance and prompts.

`vendor.js` is the previously bundled Three.js 0.187.0 runtime with GLTFLoader and RoomEnvironment, under its included MIT license. It is kept locally for a runnable static checkpoint. The application already pins that Three.js version. A production implementation should use normal application imports rather than maintain a second bundle. No package or lockfile dependency is changed.

## Latest discussion — not implemented

Akshar asked to keep the next iteration in discussion. The emerging direction is one full-screen walkthrough with limited, changing text:

1. Hero: **Test business decisions before committing.**
2. Camera enters the MacBook's display, where the actual 3D neighborhood map is already visible.
3. The real 3D map becomes the environment and highlights a candidate location.
4. A real Matterport viewer takes over the same screen area.
5. A full-screen business-day simulation explains arrivals, service, staffing, and queues.
6. A staffed-counter comparison shows the same demand, service outcomes, and added staffing cost.

There is one earlier proposal for the MacBook to exit right; the newest discussion returned to entering its display. **Confirm the final transition before implementing another animation.** Also unresolved: should adding a counter require a satisfying button press or unfold with scrolling? Do not infer an answer from this checkpoint.

The sparse headings in the current prototype are not accepted final copy. The next wireframe must explain the product clearly with short, useful context and earned control/data labels. Keep all sections optically centered, avoid alternating text/asset layouts, and leave the background visible. UI refraction and tactile feedback support that story.

## Resume

1. Read Linear **HAC-114**, the linked draft PR, this file, and the content draft.
2. Confirm the content/scroll structure and the counter interaction with Akshar before more design implementation.
3. Coordinate with **HAC-104** for the real staffed-counter demo and with the Matterport/interior work for scan integration. The current public tour is a reference only.
4. Replace the static checkpoint with the approved application implementation in a later reviewed change; preserve simulation assumptions and data provenance.
5. Run the repository checks and browser verification, including phone layout, keyboard/reduced-motion behavior, rapid reversal, iframe unloading, and idle rendering.

This request authorizes a draft PR checkpoint. It does not authorize merge, deployment, ticket reassignment, or production changes.
