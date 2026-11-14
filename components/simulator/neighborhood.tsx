"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Entity, Viewer } from "cesium";
import {
  daylight,
  demandAnchors,
  demandLevel,
  trafficLevel,
} from "./day-cycle";
import {
  getRoadTemplate,
  loadRoadTile,
  nearbyRoadTiles,
  type Road,
} from "./road-tiles";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { glass } from "./glass";

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
  const [roadStatus, setRoadStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let closed = false;
    let viewer: Viewer | undefined;
    const roadRequests = new AbortController();
    const element = container.current;
    if (!element) return;

    async function load(target: HTMLDivElement) {
      Object.assign(window, { CESIUM_BASE_URL: "/cesium/" });
      const {
        Viewer,
        Cesium3DTileset,
        Cartesian3,
        Cartographic,
        Cartesian2,
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
      const createRoad = ({ roadClass, points, seed }: Road) =>
        city.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(points),
            width: roadClass === "tertiary" ? 5 : 8,
            material: new ColorMaterialProperty(
              new CallbackProperty(() => {
                const congestion = trafficLevel(
                  timeRef.current,
                  seed,
                  roadClass,
                );
                return Color.fromCssColorString(
                  congestion >= 0.7
                    ? "#ff3e47"
                    : congestion >= 0.38
                      ? "#ffb522"
                      : "#2fdf92",
                ).withAlpha(0.82);
              }, false),
            ),
            clampToGround: true,
            classificationType: ClassificationType.CESIUM_3D_TILE,
          },
        });
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
      const { addVolumetricClouds } = await import("./volumetric-clouds");
      if (closed) return;
      addVolumetricClouds(city.scene, () => timeRef.current);
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
      const roadTiles = new Map<string, Entity[]>();
      let visible = true;
      let revision = 0;
      let template: string | undefined;
      async function updateRoads() {
        const current = ++revision;
        setRoadStatus("loading");
        try {
          const urlTemplate = (template ??= await getRoadTemplate(
            roadRequests.signal,
          ));
          if (closed || current !== revision) return;
          const canvas = city.scene.canvas;
          const picked = city.camera.pickEllipsoid(
            new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
          );
          const center = picked
            ? Cartographic.fromCartesian(picked)
            : undefined;
          const tiles = nearbyRoadTiles(city.camera, center);
          const wanted = new Set(tiles.map(({ x, y }) => `${x}/${y}`));
          for (const [id, entities] of roadTiles) {
            if (wanted.has(id)) continue;
            entities.forEach((entity) => city.entities.remove(entity));
            roadTiles.delete(id);
          }
          const results = await Promise.allSettled(
            tiles.map(async ({ x, y }) => {
              const id = `${x}/${y}`;
              if (roadTiles.has(id)) return;
              const roads = await loadRoadTile(
                urlTemplate,
                x,
                y,
                roadRequests.signal,
              );
              if (closed || current !== revision) return;
              roadTiles.set(
                id,
                roads.map((road) => {
                  const entity = createRoad(road);
                  entity.show = visible;
                  return entity;
                }),
              );
            }),
          );
          if (!closed && current === revision) {
            setRoadStatus(
              results.some((result) => result.status === "rejected")
                ? "failed"
                : "ready",
            );
          }
        } catch {
          if (!closed && current === revision) setRoadStatus("failed");
        }
      }
      city.camera.moveEnd.addEventListener(() => {
        void updateRoads();
      });
      trafficEntities.current = (show) => {
        visible = show;
        for (const entities of roadTiles.values()) {
          for (const entity of entities) entity.show = show;
        }
        if (show) void updateRoads();
      };
      void updateRoads();
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
      roadRequests.abort();
      trafficEntities.current = () => {};
      viewer?.destroy();
    };
  }, [longitude, latitude, tilesetUrl, attempt]);

  return (
    <div
      id="neighborhood"
      className="relative h-dvh w-full overflow-hidden bg-[#06080d] text-white"
    >
      <div
        className="absolute inset-0"
        ref={container}
        aria-label="Vexcel 3D neighborhood"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(0_0_0/0.55))]"
      />

      <header className="absolute inset-x-4 top-4 z-10 flex items-center justify-between gap-3 sm:inset-x-6 sm:top-6">
        <div
          className={`${glass} flex items-center gap-2.5 rounded-full py-2 pr-4 pl-3 text-sm`}
        >
          <span
            className={`size-2 rounded-full ${status === "failed" ? "bg-rose-400" : status === "ready" ? "bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400" : "animate-pulse bg-white/50"}`}
          />
          <span className="font-medium">Montrose</span>
          <span className="text-white/40">Houston</span>
          {status === "failed" && (
            <button
              type="button"
              className="ml-1 text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
              onClick={() => {
                setTrafficVisible(true);
                setStatus("loading");
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
        <a
          href="#operating-plan"
          className={`${glass} rounded-full px-4 py-2 text-sm font-medium transition hover:bg-white/[0.12]`}
        >
          Operating plan
        </a>
      </header>

      {status !== "ready" && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white/60"
        >
          {status === "loading" ? (
            <span className="flex items-center gap-3">
              <span className="size-4 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
              Loading 3D neighborhood
            </span>
          ) : (
            "Vexcel tiles could not load."
          )}
        </div>
      )}

      <aside
        className={`${glass} absolute top-20 left-4 z-10 w-52 p-4 sm:top-24 sm:left-6`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/80">Traffic</span>
          <button
            type="button"
            role="switch"
            aria-checked={trafficVisible}
            aria-label="Traffic heatmap"
            onClick={() => {
              const show = !trafficVisible;
              setTrafficVisible(show);
              trafficEntities.current(show);
            }}
            className={`relative h-4 w-7 rounded-full transition ${trafficVisible ? "bg-emerald-400/90" : "bg-white/15"}`}
          >
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${trafficVisible ? "left-3.5" : "left-0.5"}`}
            />
          </button>
        </div>
        <div
          className={`mt-2.5 h-1 rounded-full bg-gradient-to-r from-[#2fdf92] via-[#ffb522] to-[#ff3e47] transition-opacity ${trafficVisible ? "" : "opacity-20"}`}
        />

        {trafficVisible && roadStatus !== "ready" && (
          <p role="status" className="mt-2 text-[11px] text-white/45">
            {roadStatus === "loading"
              ? "Loading nearby roads…"
              : "Some roads didn’t load. Move the map or toggle to retry."}
          </p>
        )}

        <div className="mt-5 hidden sm:block">
          <span className="text-xs font-medium text-white/80">Demand</span>
          <ul className="mt-2.5 space-y-2">
            {demandAnchors.map((anchor) => {
              const level = demandLevel(minute, anchor.peaks);
              return (
                <li
                  key={anchor.label}
                  className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[11px] text-white/50"
                  title={`${anchor.label}: ${level > 0.6 ? "High" : level > 0.2 ? "Moderate" : "Low"}`}
                >
                  {anchor.label}
                  <span className="h-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${Math.max(3, level * 100)}%`,
                        backgroundColor: anchor.color,
                      }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {children}

      <p className="absolute right-4 bottom-2 z-10 text-[10px] text-white/30 sm:right-6">
        © Vexcel Imaging · © Microsoft · © OpenStreetMap via OpenFreeMap
      </p>
    </div>
  );
}
