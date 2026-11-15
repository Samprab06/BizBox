# BizBox MacBook asset preparation — HAC-115

The hardware, provisional GPT Image display, and local hero/entry/return choreography are prepared. Akshar approved this screen for now on November 14, 2026; matching the final product UI is deferred until that UI is finished. See [screen-source.md](screen-source.md) and the [story handoff](../story/README.md). No existing checkpoint, application page, navigation or asset was removed.

The default asset review shows the generated simulation-style display. The historical `/story/v1` uses it in the hero, crosses into the actual live 3D simulator on entry, and retains that same iframe on the return. The image is illustrative geography, not a captured renderer or forecast. The existing `/landing-workspace` shared-component adapter remains available.

**Final UI follow-up:** HAC-128's canonical Text/Voice workspace is now on main at `/projects/[id]/workspace`. Its reference city photograph is not the requested 3D map. Integrate the final supported map/assistant composition after the product UI settles; do not block this provisional landing iteration on exact parity.

## Source and attribution

- Original: [macbook pro M3 16 inch 2024](https://sketchfab.com/3d-models/macbook-pro-m3-16-inch-2024-8e34fc2b303144f78490007d91ff57c4) by [jackbaeten](https://sketchfab.com/jackbaeten).
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The creator's public model metadata reports commercial use allowed with credit, and the source GLB embeds the same author/license/source. Verified November 14, 2026.
- Source distribution: William Laverty's [rigged-macbook-3d](https://github.com/william-laverty/rigged-macbook-3d/tree/74771a18884dade35cdf79c7614628100f0f893a), pinned to commit `74771a18884dade35cdf79c7614628100f0f893a`, file `assets/macbook-source.glb`. We use the original source export, not its React components, rigged export or runtime package. No dependency was added.
- [upstream-credits.md](upstream-credits.md) retains the distribution's credits. [Public credits](../../../public/landing-assets/macbook/credits.html) identify this project's modifications. Retain a visible link to these credits when integrating the model.

The GLB source is retained beside this document. Preparation imports it through Blender MCP into a separate scene, normalizes its width to 0.3557 metres, separates whole connected lid/base shells, adds a physical hinge, replaces the screen material, corrects display UV orientation, and adds four screen-corner anchors. Original keyboard legends, bezel/notch, speaker and port geometry are retained. A second export simplifies larger body meshes for mobile while preserving the display and anchors.

## Outputs

Under `public/landing-assets/macbook/`:

| File                                  | Purpose                                                          | Size / geometry                                                |
| ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `macbook.glb`                         | Full hardware geometry                                           | 4,259,520 bytes; 112,625 triangles                             |
| `macbook-mobile.glb`                  | Mobile body simplification                                       | 2,404,516 bytes; 48,697 triangles                              |
| `bizbox-map-screen.png`               | Retained legacy 2D product-map capture                           | 1600 × 1036; fixture labels and attribution retained           |
| `bizbox-simulation-screen-gpt-v2.png` | Approved provisional simulation-style hero image                 | 1558 × 1009; [prompt/provenance](imagegen-screen-v2-prompt.md) |
| `houston-sunset.jpg`                  | Existing generated Houston background retained from immersive-v3 | Local authoring asset                                          |
| `model-manifest.json`                 | Node names, units, screen aspect and measured corners            | Blender coordinates explicitly identified                      |
| `credits.html`                        | Display attribution                                              | Link from the integrating page                                 |

Both GLBs contain one scene with one root and embedded resources. They load with the app's existing Three.js GLTFLoader without a Draco or meshopt decoder. Their embedded source textures use WebP; verify WebP support in the target browser and provide the eventual static fallback. These are measured raw files, not a claim about transfer size or final landing performance.

`macbook-prepared.blend` is the compressed editable prepared scene, including review camera/lighting and packed product texture. Other scenes in the user's live Blender were preserved and excluded from both GLBs and the saved scene library.

## Integration contract

- Root: `HAC115_LaptopRoot`; metres, glTF Y up.
- Base: `HAC115_LaptopBase`, sibling of the hinge.
- Hinge: `HAC115_LidPivot`; default rotation is the source's open pose. Small positive X rotation closes it toward the keyboard. Full closure/self-collision choreography is not validated here.
- Screen: `HAC115_Screen`, parented to the hinge. Replace its material/map with the actual UI or final replay texture; do not add a second unrelated display rectangle.
- Four `HAC115_ScreenTopLeft/TopRight/BottomRight/BottomLeft` empties follow the hinge. Use their world positions after updating transforms to align the DOM/camera handoff. Manifest coordinates are **Blender Z up**; prefer the exported nodes in the runtime instead of copying them as glTF coordinates.
- Screen aspect is approximately 1.5451. The original screen mesh contains its physical notch; full-screen DOM handoff must account for that aperture. Authored UVs are upright and normalized. GLTFLoader already handles texture orientation; avoid a second V flip.
- The screen uses a full 1600 × 1036 source surface projected onto the four anchors with a CSS homography and a notch clip. It avoids the previous tiny intermediate raster surface. Homogeneous matrix coefficients are scaled equally to retain serialization precision. Live mode uses one persistent product iframe. It is not an image export of the 3D tiles. Orbit/lid/resize update the projection without navigating or recreating the iframe, retaining product state. Back-facing/collapsed surfaces hide the DOM layer.
- The GLB still embeds its legacy texture for asset inspection only. The default review replaces that material with a dark standby surface; it never substitutes that flat texture for unavailable 3D. `?texture` explicitly enables the old texture inspection. The local HAC-117 story now preserves one live screen during camera return.
- Keep all model variants and previous checkpoint files. The final page chooses the relevant resource rather than loading both variants.

## Local review and rebuild

After normal `pnpm install`, run:

```sh
pnpm exec tsx design/landing/macbook/review-server.ts
```

Run the product app separately on port 4194 with its normal environment (`pnpm dev --hostname 127.0.0.1 --port 4194`). Its server-side Vexcel configuration controls 3D availability; no credential belongs in the asset or client. `/landing-workspace` is the actual shared-component composition, also usable on its own.

Open `http://127.0.0.1:4193` for the asset review or `/story/v1` for the previous live scroll prototype. `/story` opens the newer [curated guided demo](../guided-demo/README.md), which starts with onboarding and uses prepared scenes. This localhost-only authoring tool serves the asset and installed Three.js modules; it is not a production server. `BIZBOX_REVIEW_PRODUCT_ORIGIN` defaults to local port 4194. `BIZBOX_REVIEW_SIMULATOR_URL` optionally selects the supported live simulator source, otherwise `/projects/houston-coffee/simulator` is used. The closing CTA goes to the product intake route. These variables belong to local authoring, not deployed configuration.

`?live` enables the actual simulator in the asset reviewer; `?mobile` forces mobile hardware geometry; `?texture` retains legacy texture inspection. Orbit outside the screen or test the lid slider. The hardware renderer draws on load/input/resize with no idle loop. The live product scene retains its own existing render/visibility policy. In the story, the parent owns scrolling and the iframe is decorative; open the product to interact.

For a reproducible rebuild, use a fresh Blender file and run `prepare_model.py` with `__file__` set to its full path, or execute its file through Blender MCP. It refuses to overwrite an existing prepared scene. Blender 5.3's glTF export format uses a dynamic enum callback; the script reads that callback. Export is explicitly restricted to the active scene and selected asset hierarchy. Python is offline authoring only and is not imported by the deployed app.

## Verification and next work

Five asset checks verify the GLB containers/resources and one-scene scope, mobile triangle reduction, screen/anchor hinge parenting with a stationary base, physical width, and upright screen UVs. Six projection cases verify screen corner alignment, reject collapsed/invalid surfaces, and exercise serialized CSS precision. Three adapter checks verify selected fixture coordinates, unavailable 3D behavior, and no secret in markup. Browser verification covers shared 3D loading, fixture selection, desktop/phone layout, model framing, slider movement and no idle hardware redraw. Repository lint, typecheck, test and build plus environment/client-bundle checks are required for the exact delivery candidate.

HAC-118 consumes the live composition for location selection and property-detail story stages. The local HAC-117 story consumes the model, hinge and screen anchors for entry/return; nine pure timeline tests cover reversible stages and reduced motion. HAC-116 independently resolves the matching property/authorized walkthrough. The consultant is the actual existing activity component, idle without an investigation; synchronized simulation narration remains HAC-120. Full interior/simulation camera choreography and production readiness are not part of this slice. The original draft checkpoint remains PR #96.
