import { smooth } from "./timeline";

export type MacbookFrame = {
  image: string;
  width: number;
  height: number;
  screenQuad: { x: number; y: number }[];
  notchClip?: string;
};
type Viewport = { width: number; height: number };

/** Pure camera projection; the same input is used for entry and reverse seek. */
export function cameraAt(
  viewport: Viewport,
  macbook: MacbookFrame,
  input: number,
  options: { heroScale?: number; heroCenterY?: number } = {},
) {
  const entry = Number.isFinite(input) ? Math.min(1, Math.max(0, input)) : 0;
  const portrait = viewport.width <= 700 && viewport.height > 480;
  const landscape = viewport.width <= 1000 && viewport.height <= 480;
  const compactLandscape = landscape && viewport.width <= 700;
  const naturalWidth = landscape
    ? Math.min(
        viewport.width * 0.5,
        (viewport.height * 0.8 * macbook.width) / macbook.height,
      )
    : Math.min(
        viewport.width * (portrait ? 0.96 : 1.37),
        1000,
        (viewport.height * 0.6 * macbook.width) / macbook.height,
      );
  const width = naturalWidth * (options.heroScale ?? 1);
  const height = (width * macbook.height) / macbook.width;
  const left = landscape
    ? viewport.width * 0.73 - width / 2
    : (viewport.width - width) / 2;
  const top = portrait
    ? viewport.height * 0.36
    : landscape
      ? (viewport.height - height) / 2 + 24
      : viewport.height * (options.heroCenterY ?? 0.61) - height / 2;
  const [tl, tr, , bl] = macbook.screenQuad;
  const initial = {
    left: left + tl.x * width,
    top: top + tl.y * height,
    width: (tr.x - tl.x) * width,
    height: (bl.y - tl.y) * height,
  };
  const mix = smooth(0, 1, entry);
  const cover = Math.max(
    viewport.width / initial.width,
    viewport.height / initial.height,
  );
  const zoom = 1 + (cover - 1) * mix;
  const cx =
    (initial.left + initial.width / 2) * (1 - mix) + (viewport.width / 2) * mix;
  const cy =
    (initial.top + initial.height / 2) * (1 - mix) +
    (viewport.height / 2) * mix;
  const uniform = {
    left: cx - (initial.width * zoom) / 2,
    top: cy - (initial.height * zoom) / 2,
    width: initial.width * zoom,
    height: initial.height * zoom,
  };
  // Hardware is gone before aspect fitting begins. While visible, the aperture
  // remains exactly on its uniformly scaled source pixels.
  const fitted = smooth(0.8, 1, entry);
  const screen = {
    left: uniform.left * (1 - fitted) + 0,
    top: uniform.top * (1 - fitted) + 0,
    width: uniform.width + (viewport.width - uniform.width) * fitted,
    height: uniform.height + (viewport.height - uniform.height) * fitted,
  };
  const hardware = {
    width: width * zoom,
    height: height * zoom,
    left: uniform.left - tl.x * width * zoom,
    top: uniform.top - tl.y * height * zoom,
    opacity: 1 - smooth(0.4, 0.8, entry),
  };
  const targetWidth = Math.min(520, viewport.width - 44);
  const targetHeight = landscape
    ? viewport.height - 135
    : portrait
      ? Math.min(viewport.height <= 740 ? 416 : 450, viewport.height - 235)
      : 430;
  const targetTop = landscape
    ? viewport.height * 0.5 + 53 - targetHeight / 2
    : portrait
      ? viewport.height * 0.5 + 62 - targetHeight / 2
      : viewport.height * 0.55 - targetHeight / 2;
  const startWidth = Math.min(initial.width * 0.92, targetWidth);
  const startHeight = initial.height * 0.94;
  const interpolate = (start: number, end: number) =>
    start + (end - start) * mix;
  const cardWidth = interpolate(startWidth, targetWidth);
  const cardHeight = interpolate(startHeight, targetHeight);
  // One persistent DOM card changes bounds and typography continuously. It never
  // becomes a magnified duplicate which must be replaced by a native-size card.
  const card = {
    left:
      interpolate(initial.left + initial.width / 2, viewport.width / 2) -
      cardWidth / 2,
    top:
      interpolate(
        initial.top + initial.height / 2,
        targetTop + targetHeight / 2,
      ) -
      cardHeight / 2,
    width: cardWidth,
    height: cardHeight,
    padding: interpolate(
      compactLandscape ? 8 : portrait || landscape ? 10 : 18,
      portrait ? 22 : landscape ? 14 : 30,
    ),
    questionSize: interpolate(
      compactLandscape ? 14 : portrait || landscape ? 16 : 22,
      portrait ? 25 : landscape ? 22 : 28,
    ),
    brandHeight: interpolate(
      compactLandscape ? 12 : portrait ? 13 : landscape ? 14 : 17,
      24,
    ),
    brandGap: interpolate(
      compactLandscape ? 4 : portrait || landscape ? 6 : 10,
      landscape ? 8 : 18,
    ),
    questionGap: interpolate(
      compactLandscape ? 6 : portrait ? 9 : landscape ? 8 : 14,
      landscape ? 4 : 22,
    ),
    categoryHeight: interpolate(
      compactLandscape ? 26 : portrait || landscape ? 30 : 43,
      portrait ? 58 : landscape ? 41 : 56,
    ),
    categorySize: interpolate(
      portrait || compactLandscape ? 8 : 10,
      portrait ? 13 : 12,
    ),
    categoryPadding: interpolate(
      compactLandscape ? 4 : portrait || landscape ? 6 : 9,
      portrait ? 12 : landscape ? 9 : 12,
    ),
    controlsHeight: (portrait ? 55 : landscape ? 47 : 42) * mix,
    controlsGap: (portrait ? 16 : landscape ? 9 : 22) * mix,
    categoryGap: interpolate(portrait || landscape ? 5 : 9, 9),
    tileGap: interpolate(
      compactLandscape ? 3 : portrait || landscape ? 4 : 9,
      9,
    ),
    iconSize: interpolate(
      compactLandscape ? 11 : portrait || landscape ? 12 : 19,
      19,
    ),
  };
  return {
    initial,
    hardware,
    screen,
    card,
    notchDepth: 3.2 * (1 - fitted),
    borderRadius: 6 * (1 - fitted),
  };
}
