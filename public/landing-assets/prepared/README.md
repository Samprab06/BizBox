# Prepared landing recordings

These are build-time captures of BizBox's existing landing demonstration, replacing its live GIS/road data downloads and counter SVG animation. They are not live footfall measurements. Financial results, property assumptions, glass cards and chat remain native HTML.

- Map: six seconds, 1120×720, 25fps; MP4 H.264 faststart and WebM VP9, no audio. Captured from the existing Vexcel scene with illustrative movement along sourced OpenStreetMap roads. Attribution remains visible in the native landing UI. The far-right unfinished tile edge was cropped out.
- Counters: one staffed counter (20s) and two staffed counters (12s), 576×360, 25fps. Captured from the generated café floorplans with the existing illustrative customer/staff overlays. Each poster is the corresponding recording's first frame, so counter counts remain distinct even without motion.
- Posters: WebP quality82, from the first encoded frame. Video uses H.264 CRF27/VP9 CRF36. No GIFs, audio tracks or external runtime media services.

`manifest.json` is the runtime media contract, including normalized map anchors and counter counts. `provenance.json` records source revision, capture/crop/encoding details and full content hashes/byte counts. Filenames use the first12 SHA256 characters and immutable caching. When replacing media, update filenames, manifest, anchor projection and provenance together. Preserve the original image assets and actual product renderer.

Only the relevant visible chapter mounts video sources. Property discovery uses a still poster; the morning scene plays once and holds the result. Counter scenes loop. Reduced motion/Save Data/autoplay failure use posters and explicit playback. The video clock drives the native morning results so buffering cannot run results ahead of the footage.
