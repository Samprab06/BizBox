import { listingLabelOffsets } from "@/components/city/listing-markers";
export type ProjectedPin = { id: string; x: number; y: number };
/** Pixel coordinates originate in the actual renderer; only the glass label is
 * displaced for readability. Leaders retain the exact geographic association. */
export function storyCardLayout(
  points: readonly ProjectedPin[],
  viewport: { width: number; height: number },
) {
  const phone = viewport.width <= 700;
  const short = viewport.height <= 480;
  const width = phone ? 155 : 220;
  const height = phone ? 118 : 145;
  const safe = {
    left: 18,
    top: short ? 118 : 180,
    width: viewport.width - 36,
    height: Math.max(height, viewport.height - (short ? 118 : 180) - 100),
  };
  return {
    width,
    height,
    safe,
    offsets: listingLabelOffsets(
      points.map((p) => ({ ...p, width, height, pinWidth: 28 })),
      safe,
    ),
  };
}
