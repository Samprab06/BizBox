# Landing story build-time images

These are proportional, pre-encoded WebP copies of the existing artwork. Originals remain in their original directories. No crops, retouching, compositing, or generated replacement art were used. Only sRGB conversion, proportional resizing, metadata stripping and WebP encoding are applied.

## File bytes

| Asset       | Original file bytes | Output width: bytes                         |
| ----------- | ------------------: | ------------------------------------------- |
| hero        |             482,991 | 640: 31,148 / 1280: 103,662 / 1672: 156,138 |
| stage       |           1,529,435 | 640: 34,100 / 1280: 115,074 / 1920: 236,848 |
| macbook     |           1,145,884 | 640: 18,926 / 1080: 43,934 / 1513: 88,316   |
| interior    |           2,791,888 | 1586: 273,418                               |
| oneCounter  |           2,229,394 | 1585: 152,424                               |
| twoCounters |           2,190,260 | 1586: 146,270                               |

The two former CSS JPEG backdrops total **2,012,426 bytes**; their largest new variants total **392,986 bytes**, an **80.5%** reduction. These are source-file byte comparisons, not LCP or total-page measurements. The previous production laptop was already delivered by Next as an approximately 42KB 1080px WebP. The new direct 1080px file is 43,934 bytes; avoiding runtime encoding and retaining responsive selection is the laptop change, not a claimed 92% network saving.

## Encoding and reproducibility

Encoder: Sharp 0.35.5, already installed through Next. No dependency was added. Exact source/output dimensions, byte sizes, source SHA-256, full output SHA-256 and settings are recorded in [manifest.json](manifest.json). Filename suffixes are the first ten hex characters of output SHA-256, allowing immutable caching of the WebP files. Do not apply immutable policy to this unhashed README or manifest.

The encoder was resolved with `createRequire(import.meta.url).resolve('sharp', {paths:[require.resolve('next/package.json')]})`. Each output uses:

```js
sharp(source)
  .rotate()
  .toColourspace("srgb")
  .resize({ width, withoutEnlargement: true })
  .webp({ quality, alphaQuality: 100, effort: 6 });
```

Quality is 80 for backdrops and 640/1080px laptop, 90 for native-size laptop, and 84 for the three future-scene photographs. Hero variants stop at source-native 1672px; the 3840px screen photo is capped at 1920px. The 1513×1040 laptop retains the original aperture coordinates: **all 1,573,520 alpha pixels are identical** after decode, maximum alpha difference 0.

## Discovery and integration

[StoryBackdrop](../../../components/landing-story/story-backdrop.tsx) is rendered as native picture/source/img in SSR. It has empty decorative alt text and no separate preload. World defaults to eager/high; stage defaults to lazy/low. An actual renderToStaticMarkup check found no preload links and no /_next/image URL. The picture source has a srcset plus cover-aware sizes so portrait cover does not stretch a tiny skyline. The manager may provide precise hardware sizes for the laptop srcset.

The parent replaces its story-only CSS-image layers rather than adding these pictures over existing JPEG backgrounds. Its initial stage is eager/low priority with an aperture-sized `sizes` override; that same image upgrades during entry. The server preloads only the laptop with exactly matching `imageSrcSet`/`imageSizes`, so there is no native-size duplicate. Shared legacy CSS and artwork stay unchanged. Interior and counter images should be mounted/lazy-loaded only when those scenes are reached. The /landing-story server page uses the global DM Sans and overrides only the laptop image path, preserving its source dimensions and measured screen quad.

## Visual QA file pairs

- **hero**: original [houston-sunset.jpg](../macbook/houston-sunset.jpg) → optimized [houston-sunset-1672.932a1f548b.webp](houston-sunset-1672.932a1f548b.webp).
- **stage**: original [houston-real.jpg](../../onboarding/houston-real.jpg) → optimized [houston-screen-1920.80898df1ba.webp](houston-screen-1920.80898df1ba.webp).
- **macbook**: original [macbook-gpt-v3.png](../guided-demo/macbook-gpt-v3.png) → optimized [macbook-gpt-v3-1513.1a2a69f93c.webp](macbook-gpt-v3-1513.1a2a69f93c.webp).
- **interior**: original [cafe-interior-v1.png](../guided-demo/cafe-interior-v1.png) → optimized [cafe-interior-v1.9ae3d6d7c0.webp](cafe-interior-v1.9ae3d6d7c0.webp).
- **oneCounter**: original [cafe-overhead-one-counter-v2.png](../guided-demo/cafe-overhead-one-counter-v2.png) → optimized [cafe-overhead-one-counter-v2.8ddbce5068.webp](cafe-overhead-one-counter-v2.8ddbce5068.webp).
- **twoCounters**: original [cafe-overhead-two-counters-v3.png](../guided-demo/cafe-overhead-two-counters-v3.png) → optimized [cafe-overhead-two-counters-v3.dd62c7073c.webp](cafe-overhead-two-counters-v3.dd62c7073c.webp).

Optimized hero, stage, native laptop and two-counter artwork were visually inspected locally. Composition, signs, street/building edges, keyboard labels, silver edges and countertop geometry remain recognizable and unchanged; encoding is lossy in RGB. The alpha channel was separately checked numerically. Final browser verification belongs to the manager after integration: cold 390/768/1500px requests should select one candidate per visible picture, avoid original CSS JPEGs and runtime optimizer URLs, preserve crop/gradients and the MacBook transfer, and defer future-scene photographs. No device-FPS or final-LCP claim is made here.
