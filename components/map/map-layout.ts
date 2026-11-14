import type { CSSProperties } from "react";

/**
 * The candidate map's reserved geometry (HAC-109). The loading placeholder and the loaded
 * map render inside the same frame (candidate-map.tsx), whose toolbar row and canvas slot
 * take these sizes. The candidate list below it must not move when the map chunk arrives.
 */
export const MAP_TOOLBAR_HEIGHT = 32;
export const MAP_CANVAS_HEIGHT = 440;

export const mapToolbarStyle: CSSProperties = { height: MAP_TOOLBAR_HEIGHT };
export const mapCanvasStyle: CSSProperties = { height: MAP_CANVAS_HEIGHT };

export type MapSite = {
  id: string;
  address: string;
  href: string;
  latitude: number | null;
  longitude: number | null;
};

/** sessionStorage key for the saved view and overlay of one project's map. */
export function mapStorageKey(
  projectId: string,
  sites: MapSite[],
  example: boolean,
) {
  return example
    ? `sitework:map:${projectId}`
    : `sitework:map:${projectId}:live:${sites.map((site) => `${site.id},${site.latitude},${site.longitude}`).join(";")}`;
}
