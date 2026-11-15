/** Listing coordinates are property-level facts, never entrances or mesh picks. */
export type ListingPoint = {
  siteId: string;
  propertyId: string;
  longitude: number | null;
  latitude: number | null;
  address: string;
};
export type ListingMarker = {
  id: string;
  index: number;
  longitude: number;
  latitude: number;
  members: ListingPoint[];
};
export type MapViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type ListingCameraRequest = {
  kind: "overview" | "selection";
  revision: number;
};

/** Desktop regional imagery: bounded below Detailed; measured with real source tiles. */
export const LISTING_TILE_BUDGET = {
  cacheBytes: 256 * 1024 * 1024,
  maximumCacheOverflowBytes: 128 * 1024 * 1024,
} as const;

/** Empty external-tileset roots must refine at least once at regional scale. */
export function listingTileError(
  baseline: number,
  rootError: number,
  distance: number,
  canvasHeight: number,
  verticalFov: number,
): number {
  if (rootError <= 0 || distance <= 0 || canvasHeight <= 0 || verticalFov <= 0)
    return baseline;
  const projectedRootError =
    (rootError * canvasHeight) / (distance * 2 * Math.tan(verticalFov / 2));
  // Refine the empty root, but stay near its coarsest available content. A
  // deeper regional target requests hundreds of unnecessary descendant tiles.
  return Math.min(baseline, Math.max(0.25, projectedRootError * 0.75));
}

export function validListingCoordinates(
  longitude: unknown,
  latitude: unknown,
): boolean {
  return (
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90
  );
}

/** Exact coincident coordinates share a pin, including multiple units/properties. */
export function groupListingMarkers(
  points: readonly ListingPoint[],
): ListingMarker[] {
  const groups = new Map<string, ListingMarker>();
  const seen = new Set<string>();
  for (const point of points) {
    if (
      seen.has(point.siteId) ||
      !validListingCoordinates(point.longitude, point.latitude)
    )
      continue;
    seen.add(point.siteId);
    const longitude = point.longitude as number;
    const latitude = point.latitude as number;
    const id = `${longitude},${latitude}`;
    let group = groups.get(id);
    if (!group) {
      group = { id, index: groups.size + 1, longitude, latitude, members: [] };
      groups.set(id, group);
    }
    group.members.push(point);
  }
  return [...groups.values()];
}

export function markerSiteId(
  marker: ListingMarker,
  selectedSiteId?: string,
): string {
  return (
    marker.members.find((point) => point.siteId === selectedSiteId)?.siteId ??
    marker.members[0].siteId
  );
}

/** Move only screen labels, never geographic pins. Labels avoid every pin and one another. */
export function listingLabelOffsets(
  points: readonly { id: string; x: number; y: number; width: number }[],
  viewport: MapViewport,
) {
  type Rect = { left: number; top: number; right: number; bottom: number };
  const placed: Rect[] = [];
  const intersects = (a: Rect, b: Rect) =>
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top;
  const pinRects = points.map((point) => ({
    left: point.x - 16,
    top: point.y - 16,
    right: point.x + 16,
    bottom: point.y + 16,
  }));
  const offsets = new Map<string, { x: number; y: number }>();
  for (const point of points) {
    let chosen = { x: 0, y: -34 };
    let best = Infinity;
    for (const radius of [34, 58, 90, 125]) {
      for (const angle of [-90, 0, 180, 90, -45, -135, 45, 135]) {
        const x = Math.round(
          Math.cos((angle * Math.PI) / 180) *
            (radius + (angle % 180 === 0 ? point.width / 2 : 0)),
        );
        const y = Math.round(Math.sin((angle * Math.PI) / 180) * radius);
        const rect = {
          left: point.x + x - point.width / 2,
          right: point.x + x + point.width / 2,
          top: point.y + y - 15,
          bottom: point.y + y + 15,
        };
        const overlaps = [...pinRects, ...placed].filter((other) =>
          intersects(rect, other),
        ).length;
        const outside =
          rect.left < viewport.left ||
          rect.right > viewport.left + viewport.width ||
          rect.top < viewport.top ||
          rect.bottom > viewport.top + viewport.height;
        const score = overlaps * 1000 + (outside ? 500 : 0) + radius;
        if (score < best) {
          best = score;
          chosen = { x, y };
        }
      }
    }
    placed.push({
      left: point.x + chosen.x - point.width / 2,
      right: point.x + chosen.x + point.width / 2,
      top: point.y + chosen.y - 15,
      bottom: point.y + chosen.y + 15,
    });
    offsets.set(point.id, chosen);
  }
  return offsets;
}

/** Local city-scale top-down framing. Pins remain at their exact source coordinates. */
export function overheadFrame(
  markers: readonly ListingMarker[],
  canvas: { width: number; height: number },
  viewport: MapViewport,
  verticalFov: number,
) {
  if (
    !markers.length ||
    canvas.width <= 0 ||
    canvas.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const west = Math.min(...markers.map((m) => m.longitude));
  const east = Math.max(...markers.map((m) => m.longitude));
  const south = Math.min(...markers.map((m) => m.latitude));
  const north = Math.max(...markers.map((m) => m.latitude));
  const latitude = (north + south) / 2;
  const metersLatitude = 111_320;
  const metersLongitude =
    metersLatitude * Math.max(0.01, Math.cos((latitude * Math.PI) / 180));
  const spanX = Math.max(800, (east - west) * metersLongitude);
  const spanY = Math.max(800, (north - south) * metersLatitude);
  const scale =
    Math.max(spanX / viewport.width, spanY / viewport.height) * 1.18;
  const height = (scale * canvas.height) / (2 * Math.tan(verticalFov / 2));
  return {
    longitude:
      (west + east) / 2 +
      ((canvas.width / 2 - viewport.left - viewport.width / 2) * scale) /
        metersLongitude,
    latitude:
      latitude -
      ((canvas.height / 2 - viewport.top - viewport.height / 2) * scale) /
        metersLatitude,
    height,
  };
}
