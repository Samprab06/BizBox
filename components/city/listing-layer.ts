import type { Viewer, Entity } from "cesium";
import {
  markerSiteId,
  listingLabelOffsets,
  listingAddressLabel,
  listingPinImage,
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
  const measure =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  if (measure) measure.font = "600 15px sans-serif";
  const leaders =
    typeof document !== "undefined"
      ? document.createElementNS("http://www.w3.org/2000/svg", "svg")
      : null;
  if (leaders) {
    leaders.setAttribute("aria-hidden", "true");
    Object.assign(leaders.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      overflow: "hidden",
    });
    canvas.parentElement?.appendChild(leaders);
  }
  const labelDimensions = (marker: ListingMarker) => {
    const lines = listingAddressLabel(marker).split("\n");
    return {
      width:
        Math.ceil(
          Math.max(
            ...lines.map(
              (line) => measure?.measureText(line).width ?? line.length * 9,
            ),
          ),
        ) + 24,
      height: lines.length * 19 + 26,
    };
  };
  let labelLayout = "";
  const stopLabels = viewer.scene.postRender.addEventListener(() => {
    if (disposed || !entities.length) return;
    const viewport = options.viewport?.(canvas) ?? {
      left: 0,
      top: 0,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
    const points = entities.flatMap((entity) => {
      const marker = entityGroups.get(entity)!;
      const position = entity.position?.getValue(viewer.clock.currentTime);
      const pixel =
        position && viewer.scene.cartesianToCanvasCoordinates(position);
      return pixel &&
        pixel.x >= viewport.left - 20 &&
        pixel.x <= viewport.left + viewport.width + 20 &&
        pixel.y >= viewport.top - 20 &&
        pixel.y <= viewport.top + viewport.height + 20
        ? [
            {
              id: marker.id,
              x: Math.round(pixel.x),
              y: Math.round(pixel.y),
              ...labelDimensions(marker),
              pinWidth: 30,
            },
          ]
        : [];
    });
    const signature = JSON.stringify(points);
    if (signature === labelLayout) return;
    labelLayout = signature;
    const offsets = listingLabelOffsets(points, viewport);
    leaders?.replaceChildren();
    if (leaders)
      for (const point of points) {
        const offset = offsets.get(point.id)!;
        const center = { x: point.x + offset.x, y: point.y + offset.y };
        const end = {
          x: Math.max(
            center.x - point.width / 2,
            Math.min(center.x + point.width / 2, point.x),
          ),
          y: Math.max(
            center.y - point.height / 2,
            Math.min(center.y + point.height / 2, point.y),
          ),
        };
        const length = Math.hypot(end.x - point.x, end.y - point.y);
        const start =
          length > 14
            ? {
                x: point.x + ((end.x - point.x) * 14) / length,
                y: point.y + ((end.y - point.y) * 14) / length,
              }
            : point;
        for (const [stroke, width] of [
          ["#101115", 4],
          ["#ffffff", 1.5],
        ] as const) {
          const line = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line",
          );
          for (const [name, value] of Object.entries({
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            stroke,
            "stroke-width": width,
          }))
            line.setAttribute(name, String(value));
          leaders.appendChild(line);
        }
      }
    for (const entity of entities) {
      const offset = offsets.get(entityGroups.get(entity)!.id);
      entity.label!.show = new sdk.ConstantProperty(Boolean(offset));
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
          billboard: {
            image: listingPinImage(marker.index, false),
            width: 26,
            height: 26,
            verticalOrigin: sdk.VerticalOrigin.CENTER,
            horizontalOrigin: sdk.HorizontalOrigin.CENTER,
            heightReference: sdk.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: listingAddressLabel(marker),
            font: "600 15px sans-serif",
            fillColor: sdk.Color.WHITE,
            showBackground: true,
            backgroundColor: sdk.Color.fromCssColorString("#17181deb"),
            backgroundPadding: new sdk.Cartesian2(12, 13),
            pixelOffset: new sdk.Cartesian2(0, -96),
            horizontalOrigin: sdk.HorizontalOrigin.CENTER,
            verticalOrigin: sdk.VerticalOrigin.CENTER,
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
        entity.billboard!.image = new sdk.ConstantProperty(
          listingPinImage(marker.index, selected),
        );
        entity.billboard!.width = new sdk.ConstantProperty(26);
        entity.billboard!.height = new sdk.ConstantProperty(26);
        entity.label!.fillColor = new sdk.ConstantProperty(
          selected ? sdk.Color.fromCssColorString("#17181d") : sdk.Color.WHITE,
        );
        entity.label!.backgroundColor = new sdk.ConstantProperty(
          selected
            ? sdk.Color.WHITE
            : sdk.Color.fromCssColorString("#17181df5"),
        );
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
      leaders?.remove();
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
