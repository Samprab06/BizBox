import type { Viewer, Entity } from "cesium";
import {
  markerSiteId,
  listingLabelOffsets,
  overheadFrame,
  type ListingCameraRequest,
  type ListingMarker,
  type MapViewport,
} from "./listing-markers";

type SDK = typeof import("cesium");
export type ListingLayerOptions = {
  markers: readonly ListingMarker[];
  selectedSiteId?: string;
  onSelectSite: (siteId: string) => void;
  cameraRequest: ListingCameraRequest;
  viewport?: (canvas: HTMLCanvasElement) => MapViewport;
};

/** Annotation/camera attachment to the existing viewer. No clock, imagery or data requests. */
export function createListingLayer(
  viewer: Viewer,
  sdk: SDK,
  initial: ListingLayerOptions,
) {
  let options = initial;
  let fingerprint = "";
  let cameraKey = "";
  let selectedId: string | undefined;
  let disposed = false;
  let entities: Entity[] = [];
  const entityGroups = new Map<Entity, ListingMarker>();
  const canvas = viewer.scene.canvas;
  const handler = new sdk.ScreenSpaceEventHandler(canvas);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let labelLayout = "";
  const stopLabels = viewer.scene.postRender.addEventListener(() => {
    if (disposed || !entities.length) return;
    const points = entities.flatMap((entity) => {
      const marker = entityGroups.get(entity)!;
      const position = entity.position?.getValue(viewer.clock.currentTime);
      const pixel =
        position && viewer.scene.cartesianToCanvasCoordinates(position);
      return pixel
        ? [
            {
              id: marker.id,
              x: Math.round(pixel.x),
              y: Math.round(pixel.y),
              width: marker.members.length > 1 ? 112 : 34,
            },
          ]
        : [];
    });
    const signature = JSON.stringify(points);
    if (signature === labelLayout) return;
    labelLayout = signature;
    const viewport = options.viewport?.(canvas) ?? {
      left: 0,
      top: 0,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
    const offsets = listingLabelOffsets(points, viewport);
    for (const entity of entities) {
      const offset = offsets.get(entityGroups.get(entity)!.id);
      if (offset)
        entity.label!.pixelOffset = new sdk.ConstantProperty(
          new sdk.Cartesian2(offset.x, offset.y),
        );
    }
    viewer.scene.requestRender();
  });
  function cancel() {
    if (!disposed) viewer.camera.cancelFlight();
  }
  for (const event of ["pointerdown", "wheel", "touchstart"])
    canvas.addEventListener(event, cancel, { passive: true });
  handler.setInputAction((event: { position: import("cesium").Cartesian2 }) => {
    const picked = viewer.scene.pick(event.position);
    const marker = picked?.id && entityGroups.get(picked.id);
    if (marker)
      options.onSelectSite(markerSiteId(marker, options.selectedSiteId));
  }, sdk.ScreenSpaceEventType.LEFT_CLICK);

  function frame(instant = false, overview = false) {
    if (disposed || !options.markers.length) return;
    const selected = options.markers.find((marker) =>
      marker.members.some((member) => member.siteId === options.selectedSiteId),
    );
    const markers =
      !overview && options.cameraRequest.kind === "selection" && selected
        ? [selected]
        : options.markers;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const viewport = options.viewport?.(canvas) ?? {
      left: 32,
      top: 80,
      width: width * 0.68 - 64,
      height: height - 160,
    };
    const frustum = viewer.camera.frustum;
    const fovy = ("fovy" in frustum ? frustum.fovy : undefined) ?? Math.PI / 3;
    const target = overheadFrame(markers, { width, height }, viewport, fovy);
    if (!target) return;
    viewer.camera.cancelFlight();
    const view = {
      destination: sdk.Cartesian3.fromDegrees(
        target.longitude,
        target.latitude,
        target.height,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    };
    if (instant || reduced.matches) viewer.camera.setView(view);
    else viewer.camera.flyTo({ ...view, duration: 0.85 });
    viewer.scene.requestRender();
  }
  function update(next: ListingLayerOptions) {
    if (disposed) return;
    options = next;
    const nextFingerprint = JSON.stringify(next.markers);
    const changed = nextFingerprint !== fingerprint;
    if (changed) {
      for (const entity of entities) viewer.entities.remove(entity);
      entities = [];
      entityGroups.clear();
      for (const marker of next.markers) {
        const entity = viewer.entities.add({
          id: `listing:${marker.id}`,
          name: marker.members[0].address,
          position: sdk.Cartesian3.fromDegrees(
            marker.longitude,
            marker.latitude,
            2,
          ),
          point: {
            pixelSize: 16,
            color: sdk.Color.WHITE,
            outlineColor: sdk.Color.fromCssColorString("#17181d"),
            outlineWidth: 3,
            heightReference: sdk.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${marker.index}${marker.members.length > 1 ? ` · ${marker.members.length} spaces` : ""}`,
            font: "600 14px sans-serif",
            fillColor: sdk.Color.WHITE,
            showBackground: true,
            backgroundColor: sdk.Color.fromCssColorString("#17181deb"),
            backgroundPadding: new sdk.Cartesian2(9, 6),
            pixelOffset: new sdk.Cartesian2(0, -31),
            heightReference: sdk.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        entities.push(entity);
        entityGroups.set(entity, marker);
      }
      fingerprint = nextFingerprint;
    }
    if (changed || selectedId !== next.selectedSiteId) {
      for (const entity of entities) {
        const marker = entityGroups.get(entity)!;
        const selected = marker.members.some(
          (member) => member.siteId === next.selectedSiteId,
        );
        entity.point!.pixelSize = new sdk.ConstantProperty(selected ? 22 : 15);
        entity.point!.outlineWidth = new sdk.ConstantProperty(selected ? 5 : 3);
        entity.label!.scale = new sdk.ConstantProperty(selected ? 1.12 : 1);
      }
      viewer.scene.requestRender();
    }
    selectedId = next.selectedSiteId;
    const key = `${next.cameraRequest.kind}:${next.cameraRequest.revision}:${next.cameraRequest.kind === "selection" ? next.selectedSiteId : ""}`;
    if (changed || cameraKey !== key) frame(!cameraKey, changed);
    cameraKey = key;
  }
  // Resize only re-frames the current intent. Ordinary renders/selection callbacks do not steal a user's pan.
  const observer = new ResizeObserver(() => frame(true));
  observer.observe(canvas);
  const viewportElement = canvas
    .closest("#neighborhood")
    ?.parentElement?.parentElement?.querySelector("[data-map-sheet]");
  if (viewportElement) observer.observe(viewportElement);
  update(initial);
  return {
    update,
    destroy() {
      if (disposed) return;
      viewer.camera.cancelFlight();
      disposed = true;
      observer.disconnect();
      stopLabels();
      for (const event of ["pointerdown", "wheel", "touchstart"])
        canvas.removeEventListener(event, cancel);
      handler.destroy();
      for (const entity of entities) viewer.entities.remove(entity);
      entities = [];
      entityGroups.clear();
      viewer.scene.requestRender();
    },
  };
}
