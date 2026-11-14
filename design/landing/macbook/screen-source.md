# MacBook screen source — HAC-115

`public/landing-assets/macbook/bizbox-map-screen.png` is an **interim capture of the actual current application map UI**, not a generated interface or the approved final landing composition.

## Capture

- Source commit: `1a8f50037cbe224ca5fd3a9f646a33fb8d6df732` (the source checked out for HAC-115).
- Source route: `/projects/houston-coffee/map?site=montrose`.
- Local execution: `pnpm dev --hostname 127.0.0.1 --port 4192`, without copied environment files or secrets. The port is only a capture instruction; no runtime URL is baked into the asset.
- Browser viewport / output: **1600 × 1036 CSS pixels**, device scale factor 1. This is close to the sourced model's display aspect; fit/contain rather than stretching when applying the texture.
- Page scrolled to its bottom (`scrollY = 321` in a document 1357 pixels tall), keeping the map, both candidate names, selected site, map attribution and **Example data** label visible.
- The Next development-tool portal was removed only in the temporary browser document before capture. No product components, CSS, routes or state were modified.
- Capture date: November 14, 2026.

To reproduce, open the route on a local server, set the viewport to 1600 × 1036 at scale 1, wait for the map canvas and tiles, scroll to the document bottom, and take a viewport screenshot. Keep map attribution and example labeling intact.

## What the image establishes

The actual MapPreview/CandidateMap UI renders two fixture candidate locations (Montrose and Heights), a selected Montrose catchment, the fixture's population caption, and a link to property details. These are **example data**, not live listing findings or a matched Matterport property. The uncompleted-intake message is retained truthfully.

The map attribution is visible in the texture: MapLibre, OpenFreeMap, OpenMapTiles and OpenStreetMap. Preserve this attribution when displaying the capture. No Matterport viewer or frames were loaded/captured, and no external model, voice or consultant call was started.

## Known gap — replace for HAC-118

The current application map route does **not** place a consultant/chat panel alongside the map. Its `WorkspaceView` mounts `MapPreview` alone. `ConsultantPanel` is an activity section in `ComparisonWorkspace`, not a map-side conversation UI. The existing shell still uses the older Sitework branding outside this captured viewport.

The separate HAC-112 dark-glass onboarding handoff was inspected read-only. Its own documentation identifies the final workspace as a scripted design preview over a city photograph, not a geographic map or live agent. It was not substituted here or represented as shipped functionality.

HAC-118 should produce the actual map + consultant composition requested for the hero. HAC-120 owns synchronized simulation narration. Re-capture that integrated surface and replace this interim texture once it exists, preserving the same screen aspect and fixture/provenance labels. This image is suitable for verifying laptop materials, UV orientation and camera/display alignment now; it does not complete the final map/consultant visual requirement.

## Verification

Visually inspected the exported PNG: map tiles and both candidate labels are rendered, Montrose is selected, no loading placeholder, example/source captions and map attribution remain readable, and there are no Matterport frames or developer-tool controls. No generated UI text, scripted assistant conversation, fabricated live result, or image editing was used.
