export type MediaAnchor = { siteId: string; u: number; v: number };
type Size = { width: number; height: number };

export function preparedCardLayout(
  points: readonly ProjectedPin[],
  viewport: Size,
) {
  // Existing label placement already reserves 100px. Portrait recordings also
  // need room for native assumptions, source credits and playback controls.
  const extra = viewport.width <= 700 && viewport.height > 480 ? 110 : 0;
  return storyCardLayout(points, {
    ...viewport,
    height: viewport.height - extra,
  });
}

/** Same centered image/video fit as the recorded image; label clamping happens separately. */
export function projectMediaAnchors(
  anchors: readonly MediaAnchor[],
  media: Size,
  viewport: Size,
  fit: "cover" | "contain" = "cover",
) {
  if (
    ![media.width, media.height, viewport.width, viewport.height].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return [];
  const scale = (fit === "contain" ? Math.min : Math.max)(
    viewport.width / media.width,
    viewport.height / media.height,
  );
  const left = (viewport.width - media.width * scale) / 2,
    top = (viewport.height - media.height * scale) / 2;
  return anchors
    .filter((a) => Number.isFinite(a.u) && Number.isFinite(a.v))
    .map((a) => ({
      id: a.siteId,
      x: left + a.u * media.width * scale,
      y: top + a.v * media.height * scale,
    }));
}
export function preparedPlayback({
  active,
  visible,
  reduced,
  saveData,
  manual,
}: {
  active: boolean;
  visible: boolean;
  reduced: boolean;
  saveData: boolean;
  manual: boolean;
}) {
  if (!active || !visible) return "dormant";
  return (reduced || saveData) && !manual ? "poster" : "video";
}
import { storyCardLayout, type ProjectedPin } from "./map-layout";
