/**
 * CSS matrix3d mapping a rectangular live UI onto the projected display quad.
 * Corners are top-left, top-right, bottom-right, bottom-left in CSS pixels.
 * @param {{ x: number, y: number }[]} corners
 * @param {number} width
 * @param {number} height
 * @returns {number[] | null}
 */
export function screenTransform(corners, width, height) {
  if (
    corners.length !== 4 ||
    width <= 0 ||
    height <= 0 ||
    ![width, height, ...corners.flatMap((p) => [p.x, p.y])].every(
      Number.isFinite,
    )
  )
    return null;
  const [a, b, c, d] = corners;
  const area = corners.reduce((sum, p, i) => {
    const next = corners[(i + 1) % 4];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  if (Math.abs(area) < 0.01) return null;
  const dx1 = b.x - c.x,
    dx2 = d.x - c.x;
  const dy1 = b.y - c.y,
    dy2 = d.y - c.y;
  const dx3 = a.x - b.x + c.x - d.x;
  const dy3 = a.y - b.y + c.y - d.y;
  let g = 0,
    h = 0;
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-9) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < 1e-10) return null;
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  if (Math.min(1 + g, 1 + h, 1 + g + h) <= 1e-6) return null;
  const matrix = [
    (b.x - a.x + g * b.x) / width,
    (b.y - a.y + g * b.y) / width,
    0,
    g / width,
    (d.x - a.x + h * d.x) / height,
    (d.y - a.y + h * d.y) / height,
    0,
    h / height,
    0,
    0,
    1,
    0,
    a.x,
    a.y,
    0,
    1,
  ];
  return matrix.every(Number.isFinite) ? matrix : null;
}

/**
 * Same projective mapping with larger homogeneous coefficients. This avoids a
 * tiny intermediary DOM layer (which rasterizes the UI at low resolution) and
 * keeps CSS serialization error small without shrinking the source surface.
 * @param {{ x: number, y: number }[]} corners
 * @param {number} width
 * @param {number} height
 * @returns {number[] | null}
 */
export function cssScreenTransform(corners, width, height) {
  return (
    screenTransform(corners, width, height)?.map((value) => value * 16) ?? null
  );
}
