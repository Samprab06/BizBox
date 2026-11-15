/** Build-time WebP files; content hashes allow immutable browser caching. */
export type StoryImageAsset = {
  src: `/landing-assets/optimized/${string}.webp`;
  width: number;
  height: number;
};
export function imageSrcSet(variants: readonly StoryImageAsset[]) {
  return variants.map(({ src, width }) => `${src} ${width}w`).join(", ");
}
function responsive(
  variants: readonly [StoryImageAsset, ...StoryImageAsset[]],
  sizes: string,
) {
  return {
    ...variants[variants.length - 1],
    variants,
    imageSrcSet: imageSrcSet(variants),
    sizes,
  };
}
export const STORY_ASSETS = {
  hero: responsive(
    [
      {
        src: "/landing-assets/optimized/houston-sunset-640.0a68d62b99.webp",
        width: 640,
        height: 360,
      },
      {
        src: "/landing-assets/optimized/houston-sunset-1280.30dd8c11c8.webp",
        width: 1280,
        height: 720,
      },
      {
        src: "/landing-assets/optimized/houston-sunset-1672.932a1f548b.webp",
        width: 1672,
        height: 941,
      },
    ],
    "(max-aspect-ratio: 1672/941) 177.684vh, 100vw",
  ),
  stage: responsive(
    [
      {
        src: "/landing-assets/optimized/houston-screen-640.5f439d9eef.webp",
        width: 640,
        height: 347,
      },
      {
        src: "/landing-assets/optimized/houston-screen-1280.941c665f69.webp",
        width: 1280,
        height: 695,
      },
      {
        src: "/landing-assets/optimized/houston-screen-1920.80898df1ba.webp",
        width: 1920,
        height: 1043,
      },
    ],
    "(max-aspect-ratio: 1920/1043) 184.084vh, 100vw",
  ),
  macbook: responsive(
    [
      {
        src: "/landing-assets/optimized/macbook-gpt-v3-640.7a6d071016.webp",
        width: 640,
        height: 440,
      },
      {
        src: "/landing-assets/optimized/macbook-gpt-v3-1080.6cdd2dc305.webp",
        width: 1080,
        height: 742,
      },
      {
        src: "/landing-assets/optimized/macbook-gpt-v3-1513.1a2a69f93c.webp",
        width: 1513,
        height: 1040,
      },
    ],
    "(max-width: 700px) 96vw, 1000px",
  ),
  interior: {
    src: "/landing-assets/optimized/cafe-interior-v1.9ae3d6d7c0.webp",
    width: 1586,
    height: 992,
  },
  oneCounter: {
    src: "/landing-assets/optimized/cafe-overhead-one-counter-v2.8ddbce5068.webp",
    width: 1585,
    height: 992,
  },
  twoCounters: {
    src: "/landing-assets/optimized/cafe-overhead-two-counters-v3.dd62c7073c.webp",
    width: 1586,
    height: 992,
  },
} satisfies Record<string, StoryImageAsset>;
