export type ScreenPoint = { x: number; y: number };
export function screenTransform(
  corners: ScreenPoint[],
  width: number,
  height: number,
): number[] | null;
