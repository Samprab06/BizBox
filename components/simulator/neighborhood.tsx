"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Viewer } from "cesium";
import {
  daylight,
  demandAnchors,
  demandLevel,
  trafficLevel,
} from "./day-cycle";
import roads from "./montrose-roads.json";
import "cesium/Build/Cesium/Widgets/widgets.css";

export default function Neighborhood({
  longitude,
  latitude,
  tilesetUrl,
  minute,
  children,
}: {
  longitude: number;
  latitude: number;
  tilesetUrl: string;
  minute: number;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const timeRef = useRef(minute);
  useEffect(() => {
    timeRef.current = minute;
  }, [minute]);
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
        Cartesian2,
        CloudCollection,
        Sun,
        ClassificationType,
        Color,
        CallbackProperty,
        ColorMaterialProperty,
        JulianDate,
        Cesium3DTileStyle,
        Math: CesiumMath,
      } = await import("cesium");
      if (closed) return;
      viewer = new Viewer(target, {
        baseLayer: false,
        globe: false,
        skyBox: false,
        skyAtmosphere: false,
        useBrowserRecommendedResolution: false,

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
      viewer.scene.sun = new Sun();
      const tileset = await Cesium3DTileset.fromUrl(tilesetUrl, {
        showCreditsOnScreen: true,
        maximumScreenSpaceError: 1,
        dynamicScreenSpaceError: false,
      });
      if (closed) {
        tileset.destroy();
        return;
      }
      viewer.scene.primitives.add(tileset);
      const city = viewer;
      const entities = roads.map(({ roadClass, points }, index) =>
        city.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(points),
            width: roadClass === "tertiary" ? 5 : 8,
            material: new ColorMaterialProperty(
              new CallbackProperty(() => {
                const congestion = trafficLevel(
                  timeRef.current,
                  index,
                  roadClass,
                );
                const color =
                  congestion >= 0.7
                    ? "#ff3e47"
                    : congestion >= 0.38
                      ? "#ffb522"
                      : "#2fdf92";
                return Color.fromCssColorString(color).withAlpha(0.82);
              }, false),
            ),
            clampToGround: true,
            classificationType: ClassificationType.CESIUM_3D_TILE,
          },
        }),
      );
      for (const anchor of demandAnchors) {
        const position = Cartesian3.fromDegrees(
          longitude + anchor.east,
          latitude + anchor.north,
        );
        city.entities.add({
          position,
          ellipse: {
            semiMajorAxis: new CallbackProperty(
              () => 18 + 47 * demandLevel(timeRef.current, anchor.peaks),
              false,
            ),
            semiMinorAxis: new CallbackProperty(
              () => 18 + 47 * demandLevel(timeRef.current, anchor.peaks),
              false,
            ),
            classificationType: ClassificationType.CESIUM_3D_TILE,
            material: new ColorMaterialProperty(
              new CallbackProperty(
                () =>
                  Color.fromCssColorString(anchor.color).withAlpha(
                    0.05 + 0.45 * demandLevel(timeRef.current, anchor.peaks),
                  ),
                false,
              ),
            ),
          },
        });
      }
      const midnight = JulianDate.fromIso8601("2026-11-14T00:00:00-06:00");
      city.clock.shouldAnimate = false;
      // Native cumulus primitives, configured like the Cesium Sandcastle clouds example.
      const clouds = new CloudCollection({ noiseDetail: 32 });
      city.scene.primitives.add(clouds);
      const cloudPositions = [
        [-0.019, 0.029, 660, 570],
        [-0.008, 0.025, 580, 460],
        [0.001, 0.034, 700, 680],
        [0.012, 0.031, 620, 600],
        [0.024, 0.037, 780, 720],
        [0.004, -0.035, 690, 590],
      ];
      const cumulus = cloudPositions.map(([east, north, height, width]) =>
        clouds.add({
          position: Cartesian3.fromDegrees(
            longitude + east,
            latitude + north,
            height,
          ),
          scale: new Cartesian2(width, width * 0.44),
          maximumSize: new Cartesian3(width, width * 0.44, width * 0.47),
          slice: 0.4,
        }),
      );
      const nightSky = Color.fromCssColorString("#10182e");
      const daySky = Color.fromCssColorString("#87bce6");
      const twilightSky = Color.fromCssColorString("#ee9e83");
      const sky = new Color();
      let previousMinute = -1;
      city.scene.preUpdate.addEventListener(() => {
        const step = Math.floor(timeRef.current / 5) * 5;
        if (step === previousMinute) return;
        previousMinute = step;
        city.clock.currentTime = JulianDate.addSeconds(
          midnight,
          step * 60,
          new JulianDate(),
        );
        const light = daylight(step);
        const warm = Math.max(
          0,
          1 - Math.min(Math.abs(step - 410), Math.abs(step - 1040)) / 75,
        );
        Color.lerp(nightSky, daySky, Math.sqrt(light), sky);
        city.scene.backgroundColor = Color.lerp(
          sky,
          twilightSky,
          warm * 0.7,
          sky,
        );
        cumulus.forEach((cloud, index) => {
          const [east, north, height] = cloudPositions[index];
          cloud.position = Cartesian3.fromDegrees(
            longitude + east + (step / 1440) * 0.005,
            latitude + north,
            height,
          );
          cloud.brightness = 0.22 + 0.68 * light + 0.1 * warm;
        });
        const brightness = 0.37 + 0.63 * light + warm * 0.2;
        const red = Math.min(1, brightness + 0.15 * warm);
        const blue = Math.min(1, brightness + 0.1 * (1 - light) - 0.1 * warm);
        tileset.style = new Cesium3DTileStyle({
          color: `rgb(${Math.round(red * 255)}, ${Math.round(brightness * 255)}, ${Math.round(blue * 255)})`,
        });
      });

      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(longitude, latitude - 0.0037, 150),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-17), roll: 0 },
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
      <aside className="absolute left-3 top-16 max-w-[calc(100%-1.5rem)] rounded-lg bg-ink/90 p-3 text-sm text-white">
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
      <aside className="absolute right-3 top-16 hidden rounded-lg bg-ink/90 p-3 text-xs text-white sm:block">
        <strong>Modeled demand</strong>
        {demandAnchors.map((anchor) => {
          const level = demandLevel(minute, anchor.peaks);
          return (
            <div key={anchor.label} className="mt-1 flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: anchor.color }}
              />
              {anchor.label} ·{" "}
              {level > 0.6 ? "High" : level > 0.2 ? "Moderate" : "Low"}
            </div>
          );
        })}
      </aside>
      {children}
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
