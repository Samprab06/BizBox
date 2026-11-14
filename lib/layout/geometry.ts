import type {
  Layout,
  LayoutPoint as Point,
  LayoutRect as Rect,
} from "@/lib/contracts/layout";

const EPS = 1e-8;
const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.depth;
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const expand = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  width: r.width + by * 2,
  depth: r.depth + by * 2,
});
export const inside = (p: Point, r: Rect) =>
  p.x >= r.x - EPS &&
  p.y >= r.y - EPS &&
  p.x <= right(r) + EPS &&
  p.y <= bottom(r) + EPS;
export const fits = (inner: Rect, outer: Rect) =>
  inside(inner, outer) && inside({ x: right(inner), y: bottom(inner) }, outer);
export const overlaps = (a: Rect, b: Rect) =>
  a.x < right(b) - EPS &&
  right(a) > b.x + EPS &&
  a.y < bottom(b) - EPS &&
  bottom(a) > b.y + EPS;
export const rectangleDistance = (a: Rect, b: Rect) =>
  Math.hypot(
    Math.max(a.x - right(b), b.x - right(a), 0),
    Math.max(a.y - bottom(b), b.y - bottom(a), 0),
  );

/** Whether a segment enters the open interior; touching an expanded boundary is allowed. */
function hitsRect(a: Point, b: Point, r: Rect): boolean {
  let lo = 0,
    hi = 1;
  for (const [start, end, min, max] of [
    [a.x, b.x, r.x + EPS, right(r) - EPS],
    [a.y, b.y, r.y + EPS, bottom(r) - EPS],
  ]) {
    const delta = end - start;
    if (Math.abs(delta) < EPS) {
      if (start < min || start > max) return false;
    } else {
      const t1 = (min - start) / delta,
        t2 = (max - start) / delta;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
      if (lo > hi) return false;
    }
  }
  return true;
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t =
    denominator === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator),
        );
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  return (
    ((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) &&
    ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))
  );
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

export function solidElements(layout: Layout) {
  return [
    { path: "counter", element: layout.counter },
    ...layout.stations.map((element, i) => ({
      path: `stations.${i}`,
      element,
    })),
    ...layout.seating.map((element, i) => ({ path: `seating.${i}`, element })),
    { path: "backOfHouse", element: layout.backOfHouse },
  ];
}

/** Entrance opening must fit on exactly one wall; corners cannot hold a centered opening. */
export function entranceStart(layout: Layout): Point | null {
  const { point: p, widthFt } = layout.entrance,
    r = layout.room.bounds;
  const halfDoor = widthFt / 2,
    halfRoute = layout.policy.accessibleWidthFt.value / 2;
  if (p.y - halfDoor >= r.y - EPS && p.y + halfDoor <= bottom(r) + EPS) {
    if (Math.abs(p.x - r.x) < EPS) return { x: r.x + halfRoute, y: p.y };
    if (Math.abs(p.x - right(r)) < EPS)
      return { x: right(r) - halfRoute, y: p.y };
  }
  if (p.x - halfDoor >= r.x - EPS && p.x + halfDoor <= right(r) + EPS) {
    if (Math.abs(p.y - r.y) < EPS) return { x: p.x, y: r.y + halfRoute };
    if (Math.abs(p.y - bottom(r)) < EPS)
      return { x: p.x, y: bottom(r) - halfRoute };
  }
  return null;
}

/** Visibility graph of expanded rectangle corners to a counter-side midpoint. */
export function hasAccessiblePath(layout: Layout): boolean {
  const start = entranceStart(layout);
  if (!start) return false;
  const half = layout.policy.accessibleWidthFt.value / 2;
  const room = expand(layout.room.bounds, -half);
  if (room.width <= 0 || room.depth <= 0) return false;
  const obstacles = solidElements(layout).map(({ element }) =>
    expand(element.footprint, half),
  );
  const clear = (p: Point) =>
    inside(p, room) && !obstacles.some((o) => hitsRect(p, p, o));
  if (!clear(start)) return false;
  const c = expand(layout.counter.footprint, half);
  const targets = [
    { x: c.x, y: c.y + c.depth / 2 },
    { x: right(c), y: c.y + c.depth / 2 },
    { x: c.x + c.width / 2, y: c.y },
    { x: c.x + c.width / 2, y: bottom(c) },
  ].filter(clear);
  if (targets.length === 0) return false;
  const corners = obstacles
    .flatMap((r) => [
      { x: r.x, y: r.y },
      { x: right(r), y: r.y },
      { x: r.x, y: bottom(r) },
      { x: right(r), y: bottom(r) },
    ])
    .filter(clear);
  const nodes = [start, ...targets, ...corners];
  const seen = new Set([0]),
    pending = [0];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const index = pending[cursor];
    if (index > 0 && index <= targets.length) return true;
    for (let j = 1; j < nodes.length; j++) {
      if (
        !seen.has(j) &&
        !obstacles.some((o) => hitsRect(nodes[index], nodes[j], o))
      ) {
        seen.add(j);
        pending.push(j);
      }
    }
  }
  return false;
}

export function queueLength(layout: Layout): number {
  return layout.queuePath.points
    .slice(1)
    .reduce((sum, p, i) => sum + distance(layout.queuePath.points[i], p), 0);
}

export function validQueuePath(layout: Layout): boolean {
  const points = layout.queuePath.points,
    half = layout.policy.queueWidthFt.value / 2;
  const room = expand(layout.room.bounds, -half);
  if (
    room.width <= 0 ||
    room.depth <= 0 ||
    points.some((p) => !inside(p, room))
  )
    return false;
  const obstacles = solidElements(layout).map(({ element }) =>
    expand(element.footprint, half),
  );
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (distance(a, b) < EPS || obstacles.some((o) => hitsRect(a, b, o)))
      return false;
    if (i > 0) {
      const prev = points[i - 1];
      // Conservative turn policy: at most 90 degrees, avoiding adjacent hairpins
      // whose overlapping corridors would otherwise count the same space twice.
      if ((a.x - prev.x) * (b.x - a.x) + (a.y - prev.y) * (b.y - a.y) < -EPS)
        return false;
    }
    for (let j = i + 2; j < points.length - 1; j++) {
      if (
        segmentDistance(a, b, points[j], points[j + 1]) <
        layout.policy.queueWidthFt.value - EPS
      )
        return false;
    }
  }
  return true;
}
