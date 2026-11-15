# Matterport Bundle SDK: version, keys and fallbacks (HAC-140)

The scanned interior in the simulator (`components/interior/matterport-view.tsx`)
loads Matterport's self-hosted Bundle SDK from `/matterport/showcase.html`.
`scripts/prepare-matterport.mjs` downloads it at `pnpm dev` / `pnpm build`, but
only when `MATTERPORT_SDK_KEY` is set. Without the key the page returns 404 and
the simulator shows only the modeled layout.

## Pinned version

|                    |                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pin                | `@matterport/webcomponent` **0.1.47** (`scripts/prepare-matterport.mjs`)                                                              |
| Newest on npm      | 0.1.47, `latest` dist-tag, published 2026-06-02 (checked 2026-11-14 with `npm view @matterport/webcomponent versions time dist-tags`) |
| Showcase inside it | `built-bundle/version.txt` = `26.5.4_webgl-711-g59c47ffefa`                                                                           |
| Integrity          | the pinned sha512 matches the tarball the registry serves today                                                                       |

**Why we do not upgrade to 26.10.4.** 26.10.4 is the version of Showcase and the
hosted SDK in Matterport's docs. The Bundle SDK can only be installed from npm,
and no npm release ships 26.10.4 yet. 0.1.47 is the newest Bundle SDK we can
install. The app uses only `Scene.register`/`createObjects`, `App.state`,
`Sweep.moveTo` and `disconnect`, which 26.5.4 has.

**Upgrading.** When `npm view @matterport/webcomponent dist-tags` shows a newer
release:

1. Run `npm pack @matterport/webcomponent@<v>` and read `package/built-bundle/version.txt`.
2. Set `version` and `integrity` in `scripts/prepare-matterport.mjs`. Get the
   integrity from `npm view @matterport/webcomponent@<v> dist.integrity`, without
   the `sha512-` prefix.
3. Delete `public/matterport/` and run `pnpm matterport:prepare` with a key. The
   script logs the Showcase version.
4. Run `tests/e2e/matterport-live.spec.ts` on localhost with a sandbox key.

## Keys and domains

- The Bundle SDK needs an SDK key that allows the page's domain before it will
  open a scan.
- **A sandbox key works only on `localhost`.** `127.0.0.1` fails. The view links
  from 127.0.0.1 to localhost when the connection fails.
- A hosted URL (Vercel preview or production) needs a **production SDK key**
  with that domain on its allow list. Whether wildcards such as
  `*.vercel.app` are accepted is still to be checked when the key is requested.
- The plain public embed (`https://my.matterport.com/show?m=<model>`) needs no
  key. It shows the scan but allows no overlay dots or camera control.

**Open decision (humans, record on HAC-6):** get a production key with the
Vercel production and preview domains allow-listed, or accept that the hosted
site shows only the plain embed.

## What the viewer shows when something fails

The view never leaves a blank or broken frame. `matterport-session.ts` labels
each failure (`data-viewer-failure` on the status line) and the view picks the
fallback:

| Failure       | Cause                                                                                | Shown                                                              |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `bundle`      | `/matterport/showcase.html` missing (no key at build) or no `MP_SDK`                 | Plain public embed + label                                         |
| `key`         | Connect rejected with a key, domain, origin or 403 error, or in-frame key error text | Plain public embed + label (+ the sandbox-key note on hosted URLs) |
| `timeout`     | No connection or no PLAYING phase within 30 s                                        | Plain public embed + label                                         |
| `unavailable` | Any other connection error                                                           | Plain public embed + label                                         |
| `model`       | Showcase says the space is unavailable                                               | Labelled placeholder; use Modeled layout                           |

Every failure offers **Retry scanned interior**, which reloads the SDK iframe
and reconnects. If the scan connects but the dots fail, **Retry simulation
dots** builds a new scene object. A stopped Matterport scene object cannot be
started again, so every connect and retry calls `attachReplayScene`, which
always creates a fresh object.

## Lifecycle and performance

- Unmount (switching to Modeled layout or leaving the page) disposes the SDK
  connection, the PLAYING subscription, the MutationObserver, every timeout
  and abort listener, the scene object and its registration, and the
  geometries, materials and textures. `matterport-session.test.ts` checks this
  over 10 mount/unmount cycles, unmounting at each stage, against a mocked SDK.
- `matterport-scene-performance.test.ts` drives 160 moving, churning dots
  through `onInputsUpdated` for 400 frames. It asserts a median under 2 ms and
  a p95 under 6 ms, no growth in the scene graph, and only the shared
  geometries and materials. This measures the scene-graph update on the CPU
  only. GPU frame time in the real viewer needs the live spec with a key.
