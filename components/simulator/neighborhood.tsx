"use client";

import { useEffect, useRef, useState } from "react";
import type { Entity, Viewer } from "cesium";
import roads from "./montrose-roads.json";
import "cesium/Build/Cesium/Widgets/widgets.css";

export default function Neighborhood({
  longitude,
  latitude,
  tilesetUrl,
}: {
  longitude: number;
  latitude: number;
  tilesetUrl: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const trafficEntities = useRef<(show: boolean) => void>(() => {});
  const [trafficVisible, setTrafficVisible] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let closed = false;
    let viewer: Viewer | undefined;
    const element = container.current;
    if (!element) return;

    async function load(target: HTMLDivElement) {
      Object.assign(window, { CESIUM_BASE_URL: "/cesium/" });
      const {
        Viewer,
        Cesium3DTileset,
        Cartesian3,
        ClassificationType,
        Color,
        Math: CesiumMath,
      } = await import("cesium");
      if (closed) return;
      viewer = new Viewer(target, {
        baseLayer: false,
        globe: false,
        baseLayerPicker: false,
        geocoder: false,
        animation: false,
        timeline: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        selectionIndicator: false,
        infoBox: false,
      });
      const tileset = await Cesium3DTileset.fromUrl(tilesetUrl, {
        showCreditsOnScreen: true,
      });
      if (closed) {
        tileset.destroy();
        return;
      }
      viewer.scene.primitives.add(tileset);
      const city = viewer;
      const entities: Entity[] = roads.map(({ roadClass, points }, index) => {
        const congestion =
          (index * 37 + (roadClass === "primary" ? 30 : 0)) % 100;
        const color =
          congestion >= 70
            ? "#ff3e47"
            : congestion >= 38
              ? "#ffb522"
              : "#2fdf92";
        return city.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(points),
            width: roadClass === "tertiary" ? 5 : 8,
            material: Color.fromCssColorString(color).withAlpha(0.82),
            clampToGround: true,
            classificationType: ClassificationType.CESIUM_3D_TILE,
          },
        });
      });
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(longitude, latitude - 0.0018, 195),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-40), roll: 0 },
      });
      trafficEntities.current = (show) => {
        for (const entity of entities) entity.show = show;
      };
      const stopWatching = tileset.tileVisible.addEventListener(() => {
        stopWatching();
        setStatus("ready");
      });
      tileset.tileFailed.addEventListener(() => {
        setStatus((current) => (current === "loading" ? "failed" : current));
      });
      viewer.scene.requestRender();
    }

    void load(element).catch(() => {
      if (!closed) setStatus("failed");
    });
    return () => {
      closed = true;
      trafficEntities.current = () => {};
      viewer?.destroy();
    };
  }, [longitude, latitude, tilesetUrl, attempt]);

  return (
    <div id="neighborhood" className="relative h-dvh w-full bg-ink">
      <div
        className="absolute inset-0"
        ref={container}
        aria-label="Vexcel 3D neighborhood"
      />
      {status !== "ready" && (
        <div
          role="status"
          className="absolute left-3 top-3 rounded bg-white px-3 py-2"
        >
          {status === "loading" ? (
            "Loading Vexcel 3D mesh…"
          ) : (
            <>
              Vexcel tiles could not load.
              <button
                className="ml-3 underline"
                onClick={() => {
                  setTrafficVisible(true);
                  setStatus("loading");
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
      <aside className="absolute bottom-10 left-3 max-w-[calc(100%-1.5rem)] rounded-lg bg-ink/90 p-3 text-sm text-white">
        <label className="flex items-center gap-2 font-semibold">
          <input
            type="checkbox"
            checked={trafficVisible}
            onChange={(event) => {
              const show = event.target.checked;
              setTrafficVisible(show);
              trafficEntities.current(show);
            }}
          />
          Traffic heatmap
        </label>
        {trafficVisible && (
          <>
            <p className="mt-1 text-xs">
              Sample congestion · OpenStreetMap road geometry
            </p>
            <p className="mt-2 flex flex-wrap gap-3 text-xs">
              <span className="text-[#2fdf92]">● Free flow</span>
              <span className="text-[#ffb522]">● Slow</span>
              <span className="text-[#ff6b72]">● Heavy</span>
            </p>
          </>
        )}
      </aside>
      <p className="absolute bottom-1 right-3 rounded bg-white px-2 text-xs">
        Imagery © Vexcel Imaging US, Inc. · © Microsoft Corporation · ©
        OpenStreetMap contributors
      </p>
      <a
        href="#operating-plan"
        className="absolute right-3 top-3 rounded bg-pine px-3 py-2 text-sm text-white"
      >
        Open café operating plan
      </a>
    </div>
  );
}
