# MacBook screen source — HAC-115

## Current screen: live actual-platform adapter

The intended MacBook display is now the **live `/landing-workspace` route**, not the retained 2D PNG below. The route composes the platform's existing components:

- `components/simulator/neighborhood.tsx`: the actual Cesium/Vexcel 3D neighborhood used in `/projects/houston-coffee/simulator`.
- `components/simulator/viewport.tsx`: the actual spatial viewport, fullscreen control and error behavior.
- `components/ConsultantPanel.tsx`: the actual consultant activity component, idle without an investigation ID. No fabricated conversation, auto-started investigation, paid agent request or replacement chat store.
- `getPreviewProject("houston-coffee")` and `getSiteFixture(...)`: the existing candidate names, floor areas, coordinates and positions.
- Existing warm application tokens and the shared `Card` component. This adapter does not adopt the scripted onboarding reference's visual map or chat.

`app/landing-workspace/page.tsx` checks whether `VEXCEL_API_KEY` is configured on the server and passes only `/api/vexcel/3d/tileset` into the client component. The key is not serialized into HTML, props, source assets or browser URLs. Without configuration, the surface says **3D neighborhood unavailable**. It never substitutes a flat map, city photo or imagined geographic scene.

`?site=heights` initializes the Heights fixture; unknown or ambiguous site values select the known Montrose fixture. Either candidate button updates the selected property and remounts the same shared neighborhood with that fixture's coordinates, disposing the previous viewer. Floor area and position come from the selected fixture. Monthly asking rent remains **Not provided**: the legacy fixture's numeric `rent` value is not used to invent an unverified monthly amount. Both locations remain visibly examples, not claimed live listing findings or matched Matterport properties.

The adapter is a landing-specific composition of real product components, not a claim that the existing production map route already has this arrangement. The actual consultant component currently presents investigation activity, not a conversational composer. A conversational consultant and simulation narration remain follow-up product integration work; no scripted reply is substituted.

The intended display integration uses a same-origin iframe aligned to the laptop screen. **No Vexcel 3D tile pixels have been captured, recorded or baked into a texture for this change.** Keep the live provider credits visible. Any subsequent static capture/export remains subject to the provider's applicable terms.

### Adapter verification

- Focused boundary tests cover correct Heights coordinates/property context, same-origin tileset URL with no secret in rendered output, missing configuration without a flat-map stand-in, and invalid selected-site fallback.
- Browser DOM verification at 1600 × 1036: actual Cesium canvas 1190 × 814; initial 3D loading state settled; candidate controls and idle consultant present; no horizontal overflow.
- Browser DOM verification at 390 × 844: scene and sidebar stack without horizontal overflow; selection updates property context and keyboard Enter selects a candidate while retaining focus.
- No screenshots, tile exports, recordings or Matterport frames were taken during adapter verification.

## Retained earlier 2D texture — not the default screen

`public/landing-assets/macbook/bizbox-map-screen.png` remains an **interim 2D capture from the earlier application map UI** for historical comparison and explicit texture-only review. It is not the current 3D screen or the approved final landing composition. The earlier capture record follows.

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

## Historical capture limitation

The current application map route does **not** place a consultant/chat panel alongside the map. Its `WorkspaceView` mounts `MapPreview` alone. `ConsultantPanel` is an activity section in `ComparisonWorkspace`, not a map-side conversation UI. The existing shell still uses the older Sitework branding outside this captured viewport.

The separate HAC-112 dark-glass onboarding handoff was inspected read-only. Its own documentation identifies the final workspace as a scripted design preview over a city photograph, not a geographic map or live agent. It was not substituted here or represented as shipped functionality.

The new live adapter above resolves the shared 3D map/consultant composition for this handoff. HAC-118 still owns its later property-selection story integration, and HAC-120 owns synchronized simulation narration. The default MacBook now displays that live adapter; it does not recapture Vexcel imagery into a PNG or GLB. The older image remains available only for explicit legacy texture inspection, preserving the earlier work.

## Verification

Visually inspected the exported PNG: map tiles and both candidate labels are rendered, Montrose is selected, no loading placeholder, example/source captions and map attribution remain readable, and there are no Matterport frames or developer-tool controls. No generated UI text, scripted assistant conversation, fabricated live result, or image editing was used.
