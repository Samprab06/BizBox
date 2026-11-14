# BizBox MacBook asset preparation — HAC-115

The hardware portion is prepared locally. This is an additive asset handoff, not the final landing page. The requested actual map with consultant beside it remains an integration dependency in HAC-118; see [screen-source.md](screen-source.md). HAC-115 is not complete until that screen requirement is met. No existing checkpoint, application page, navigation or asset was removed.

## Source and attribution

- Original: [macbook pro M3 16 inch 2024](https://sketchfab.com/3d-models/macbook-pro-m3-16-inch-2024-8e34fc2b303144f78490007d91ff57c4) by [jackbaeten](https://sketchfab.com/jackbaeten).
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The creator's public model metadata reports commercial use allowed with credit, and the source GLB embeds the same author/license/source. Verified November 14, 2026.
- Source distribution: William Laverty's [rigged-macbook-3d](https://github.com/william-laverty/rigged-macbook-3d/tree/74771a18884dade35cdf79c7614628100f0f893a), pinned to commit `74771a18884dade35cdf79c7614628100f0f893a`, file `assets/macbook-source.glb`. We use the original source export, not its React components, rigged export or runtime package. No dependency was added.
- [upstream-credits.md](upstream-credits.md) retains the distribution's credits. [Public credits](../../../public/landing-assets/macbook/credits.html) identify this project's modifications. Retain a visible link to these credits when integrating the model.

The GLB source is retained beside this document. Preparation imports it through Blender MCP into a separate scene, normalizes its width to 0.3557 metres, separates whole connected lid/base shells, adds a physical hinge, replaces the screen material, corrects display UV orientation, and adds four screen-corner anchors. Original keyboard legends, bezel/notch, speaker and port geometry are retained. A second export simplifies larger body meshes for mobile while preserving the display and anchors.

## Outputs

Under `public/landing-assets/macbook/`:

| File | Purpose | Size / geometry |
| --- | --- | --- |
| `macbook.glb` | Full hardware geometry | 4,259,520 bytes; 112,625 triangles |
| `macbook-mobile.glb` | Mobile body simplification | 2,404,516 bytes; 48,697 triangles |
| `bizbox-map-screen.png` | Interim actual product-map capture | 1600 × 1036; fixture labels and attribution retained |
| `model-manifest.json` | Node names, units, screen aspect and measured corners | Blender coordinates explicitly identified |
| `credits.html` | Display attribution | Link from the integrating page |

Both GLBs contain one scene with one root and embedded resources. They load with the app's existing Three.js GLTFLoader without a Draco or meshopt decoder. Their embedded source textures use WebP; verify WebP support in the target browser and provide the eventual static fallback. These are measured raw files, not a claim about transfer size or final landing performance.

`macbook-prepared.blend` is the compressed editable prepared scene, including review camera/lighting and packed product texture. Other scenes in the user's live Blender were preserved and excluded from both GLBs and the saved scene library.

## Integration contract

- Root: `HAC115_LaptopRoot`; metres, glTF Y up.
- Base: `HAC115_LaptopBase`, sibling of the hinge.
- Hinge: `HAC115_LidPivot`; default rotation is the source's open pose. Small positive X rotation closes it toward the keyboard. Full closure/self-collision choreography is not validated here.
- Screen: `HAC115_Screen`, parented to the hinge. Replace its material/map with the actual UI or final replay texture; do not add a second unrelated display rectangle.
- Four `HAC115_ScreenTopLeft/TopRight/BottomRight/BottomLeft` empties follow the hinge. Use their world positions after updating transforms to align the DOM/camera handoff. Manifest coordinates are **Blender Z up**; prefer the exported nodes in the runtime instead of copying them as glTF coordinates.
- Screen aspect is approximately 1.5451. The original screen mesh contains its physical notch; full-screen DOM handoff must account for that aperture. Authored UVs are upright and normalized. GLTFLoader already handles texture orientation; avoid a second V flip.
- Browser review uses a `MeshBasicMaterial` with `toneMapped: false` for faithful UI colors. Use one persistent screen/replay state during the eventual camera return; HAC-117 owns that orchestration.
- Keep all model variants and previous checkpoint files. The final page chooses the relevant resource rather than loading both variants.

## Local review and rebuild

After normal `pnpm install`, run:

```sh
pnpm exec tsx design/landing/macbook/review-server.ts
```

Open `http://127.0.0.1:4193`. This localhost-only review tool serves the asset and installed Three.js modules; it is not an application route or production server. `?mobile` forces the mobile geometry. Orbit to inspect ports and body; the lid slider tests hinge movement. The reviewer renders on load/input/resize with no idle loop.

For a reproducible rebuild, use a fresh Blender file and run `prepare_model.py` with `__file__` set to its full path, or execute its file through Blender MCP. It refuses to overwrite an existing prepared scene. Blender 5.3's glTF export format uses a dynamic enum callback; the script reads that callback. Export is explicitly restricted to the active scene and selected asset hierarchy. Python is offline authoring only and is not imported by the deployed app.

## Verification and next work

Five asset checks verify the GLB containers/resources and one-scene scope, mobile triangle reduction, screen/anchor hinge parenting with a stationary base, physical width, and upright screen UVs. Browser verification covers desktop/mobile model loading, responsive framing, slider movement and no idle redraw. Repository lint, typecheck, test and build plus environment/client-bundle checks are required for the exact delivery candidate.

HAC-118 must replace the interim map texture with the actual requested map/consultant composition. HAC-117 consumes the model, hinge and screen anchors for entry/return. HAC-116 independently resolves the matching property/authorized walkthrough. Full interior/simulation camera choreography and production readiness are not part of this asset slice. The original draft checkpoint remains PR #96.
