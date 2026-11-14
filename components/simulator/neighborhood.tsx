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
import {
  RENDER_SETTINGS,
  createTimelineSampler,
  resolutionScaleFor,
  type RenderQuality,
} from "./render-policy";
import { useSceneVisibility } from "./use-scene-visibility";

export default function Neighborhood({
  longitude,
  latitude,
  tilesetUrl,
  minute,
  children,
  quality = "balanced",
}: {
  longitude: number;
  latitude: number;
  tilesetUrl: string;
  minute: number;
  children: ReactNode;
  quality?: RenderQuality;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { visible, hasBeenVisible } = useSceneVisibility(container);
  const timeRef = useRef(minute);
  const qualityRef = useRef(quality);
  const visibleRef = useRef(visible);
  const viewerRef = useRef<Viewer | undefined>(undefined);
  const updateScene = useRef<() => void>(() => {});
  useEffect(() => {
    timeRef.current = minute;
    qualityRef.current = quality;
    updateScene.current();
  }, [minute, quality]);
  useEffect(() => {
    visibleRef.current = visible;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.useDefaultRenderLoop = visible;
    if (visible) {
      viewer.resize();
      updateScene.current();
      viewer.scene.requestRender();
    }
  }, [visible]);
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
    if (!element || !hasBeenVisible) return;
    const disposers: (() => void)[] = [];
    const dispose = () => {
      disposers.splice(0).forEach((stop) => stop());
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = undefined;
    };

    async function load(target: HTMLDivElement) {
      Object.assign(window, { CESIUM_BASE_URL: "/cesium/" });
      const {
        Viewer,
        Cesium3DTileset,
        Cartesian3,
        Cartographic,
        Cartesian2,
        CloudCollection,
        ShadowMode,
        Sun,
        ClassificationType,
        Color,
        ConstantProperty,
        ColorMaterialProperty,
        JulianDate,
        Cesium3DTileStyle,
        Expression,
        Math: CesiumMath,
      } = await import("cesium");
      if (closed) return;
      viewer = new Viewer(target, {
        baseLayer: false,
        globe: false,
        skyBox: false,
        skyAtmosphere: false,
        useBrowserRecommendedResolution: false,
        // Keep the input/update loop smooth without scanning every entity at 120 Hz.
        targetFrameRate: 60,
        useDefaultRenderLoop: visibleRef.current,
        requestRenderMode: true,
        maximumRenderTimeChange: Number.POSITIVE_INFINITY,

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
      viewerRef.current = viewer;
      viewer.resolutionScale = resolutionScaleFor(
        window.devicePixelRatio,
        RENDER_SETTINGS[qualityRef.current].maxPixelRatio,
      );
      viewer.scene.sun = new Sun();
      // Keep Cesium's familiar bindings/collision protection, with less coasting
      // and a wider input budget when a frame is delayed by tile loading.
      const controls = viewer.scene.screenSpaceCameraController;
      controls.inertiaSpin = 0.5;
      controls.inertiaTranslate = 0.5;
      controls.inertiaZoom = 0.4;
      controls.zoomFactor = 8;
      controls.maximumMovementRatio = 0.2;
      const initialSettings = RENDER_SETTINGS[qualityRef.current];
      const tileset = await Cesium3DTileset.fromUrl(tilesetUrl, {
        showCreditsOnScreen: true,
        maximumScreenSpaceError: initialSettings.tileError,
        cacheBytes: initialSettings.cacheBytes,
        maximumCacheOverflowBytes: initialSettings.maximumCacheOverflowBytes,
        shadows: ShadowMode.DISABLED,
        lightColor: new Cartesian3(0.22, 0.22, 0.22),
        dynamicScreenSpaceError: initialSettings.dynamicScreenSpaceError,
      });
      if (closed) {
        tileset.destroy();
        return;
      }
      // Only the constant spherical harmonic contributes, giving every face even diffuse fill.
      tileset.imageBasedLighting.sphericalHarmonicCoefficients = [
        new Cartesian3(1.35, 1.35, 1.35),
        ...Array.from({ length: 8 }, () => new Cartesian3()),
      ];
      tileset.imageBasedLighting.imageBasedLightingFactor = new Cartesian2(
        1,
        0,
      );
      viewer.scene.primitives.add(tileset);
      const city = viewer;
      const roadColors = new Map<
        Entity,
        {
          seed: number;
          roadClass: string;
          color: InstanceType<typeof ConstantProperty>;
        }
      >();
      const createRoad = ({ roadClass, points, seed }: Road) => {
        const color = new ConstantProperty(Color.GREEN.withAlpha(0.82));
        const entity = city.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(points),
            width: roadClass === "tertiary" ? 5 : 8,
            material: new ColorMaterialProperty(color),
            clampToGround: true,
            classificationType: ClassificationType.CESIUM_3D_TILE,
          },
        });
        roadColors.set(entity, { seed, roadClass, color });
        return entity;
      };
      const anchors: {
        anchor: (typeof demandAnchors)[number];
        radius: InstanceType<typeof ConstantProperty>;
        color: InstanceType<typeof ConstantProperty>;
      }[] = [];
      for (const anchor of demandAnchors) {
        const position = Cartesian3.fromDegrees(
          longitude + anchor.east,
          latitude + anchor.north,
        );
        const radius = new ConstantProperty(
          qualityRef.current === "balanced" ? 65 : 18,
        );
        const color = new ConstantProperty(Color.TRANSPARENT);
        city.entities.add({
          position,
          ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            classificationType: ClassificationType.CESIUM_3D_TILE,
            material: new ColorMaterialProperty(color),
          },
        });
        anchors.push({ anchor, radius, color });
      }
      const midnight = JulianDate.fromIso8601("2026-11-14T00:00:00-06:00");
      city.clock.shouldAnimate = false;
      const { addVolumetricClouds } = await import("./volumetric-clouds");
      if (closed) return;
      // Balanced keeps the animated cloud-bank layer below without warming a
      // fullscreen ray-marched shader. Detailed restores the original volume.
      const createCloudStage = () =>
        RENDER_SETTINGS[qualityRef.current].volumetricClouds
          ? addVolumetricClouds(city.scene, () => timeRef.current)
          : undefined;
      let cloudStage = createCloudStage();
      let appliedQuality = qualityRef.current;
      const lowClouds = new CloudCollection({ noiseDetail: 32 });
      city.scene.primitives.add(lowClouds);
      const cloudBanks = [
        { east: -0.004, north: 0.005, height: 112, width: 285, drift: 0.013 },
        { east: -0.001, north: 0.007, height: 132, width: 330, drift: 0.017 },
        { east: 0.005, north: 0.0045, height: 123, width: 305, drift: 0.011 },
        { east: 0.009, north: 0.011, height: 190, width: 355, drift: 0.014 },
        { east: -0.011, north: 0.014, height: 176, width: 330, drift: 0.016 },
        // Downtown Houston banks at tower height.
        { east: 0.019, north: 0.014, height: 207, width: 420, drift: 0.013 },
        { east: 0.024, north: 0.017, height: 246, width: 480, drift: 0.015 },
      ];
      const lobes = [
        { east: -0.0009, north: 0.0002, rise: 2, scale: 0.95, slice: 0.44 },
        { east: 0, north: 0, rise: 20, scale: 1, slice: 0.48 },
        { east: 0.00085, north: 0.00035, rise: 8, scale: 0.82, slice: 0.4 },
        { east: -0.00026, north: 0.00045, rise: 47, scale: 0.68, slice: 0.52 },
      ];
      lobes.push(
        { east: 0.00045, north: -0.0002, rise: -2, scale: 0.8, slice: 0.48 },
        { east: -0.00045, north: 0.0001, rise: 29, scale: 0.77, slice: 0.46 },
      );
      const cloudPatches = cloudBanks.flatMap((bank) =>
        lobes.map((lobe) => {
          const east = bank.east + lobe.east;
          const north = bank.north + lobe.north;
          const height = bank.height + lobe.rise;
          const width = bank.width * lobe.scale;
          const depth = width * 0.52;
          return {
            east,
            north,
            height,
            drift: bank.drift,
            cloud: lowClouds.add({
              position: Cartesian3.fromDegrees(
                longitude + east,
                latitude + north,
                height,
              ),
              scale: new Cartesian2(width, depth),
              maximumSize: new Cartesian3(width, depth, width * 0.58),
              slice: lobe.slice,
            }),
          };
        }),
      );
      const nightSky = Color.fromCssColorString("#10182e");
      const daySky = Color.fromCssColorString("#87bce6");
      const twilightSky = Color.fromCssColorString("#ee9e83");
      const sky = new Color();
      let previousMinute = -1;
      const cloudTime = createTimelineSampler();
      const lightingStyle = new Cesium3DTileStyle();
      tileset.style = lightingStyle;
      let previousTint = "";
      const applyQuality = () => {
        const settings = RENDER_SETTINGS[qualityRef.current];
        const resolutionScale = resolutionScaleFor(
          window.devicePixelRatio,
          settings.maxPixelRatio,
        );
        if (city.resolutionScale !== resolutionScale) {
          city.resolutionScale = resolutionScale;
        }
        // The tile-error setter also resets Cesium's memory-adjusted error;
        // preserve that adaptive state during ordinary timeline updates.
        if (tileset.maximumScreenSpaceError !== settings.tileError) {
          tileset.maximumScreenSpaceError = settings.tileError;
        }
        if (
          tileset.dynamicScreenSpaceError !== settings.dynamicScreenSpaceError
        ) {
          tileset.dynamicScreenSpaceError = settings.dynamicScreenSpaceError;
        }
        if (tileset.cacheBytes !== settings.cacheBytes) {
          tileset.cacheBytes = settings.cacheBytes;
        }
        if (
          tileset.maximumCacheOverflowBytes !==
          settings.maximumCacheOverflowBytes
        ) {
          tileset.maximumCacheOverflowBytes =
            settings.maximumCacheOverflowBytes;
        }
        if (appliedQuality !== qualityRef.current) {
          if (cloudStage) city.scene.postProcessStages.remove(cloudStage);
          cloudStage = createCloudStage();
          appliedQuality = qualityRef.current;
        }
      };
      const overlayTime = createTimelineSampler();
      const updateOverlays = () => {
        const minute = overlayTime.take(
          timeRef.current,
          RENDER_SETTINGS[qualityRef.current].overlayStepMinutes,
        );
        if (minute === undefined) return;
        for (const { seed, roadClass, color } of roadColors.values()) {
          const congestion = trafficLevel(minute, seed, roadClass);
          color.setValue(
            Color.fromCssColorString(
              congestion >= 0.7
                ? "#ff3e47"
                : congestion >= 0.38
                  ? "#ffb522"
                  : "#2fdf92",
            ).withAlpha(0.82),
          );
        }
        for (const { anchor, radius, color } of anchors) {
          const level = demandLevel(minute, anchor.peaks);
          // A stable footprint avoids rebuilding classified ellipse geometry
          // during playback. Detailed retains the original size pulse.
          radius.setValue(
            qualityRef.current === "balanced" ? 65 : 18 + 47 * level,
          );
          color.setValue(
            Color.fromCssColorString(anchor.color).withAlpha(
              0.05 + 0.45 * level,
            ),
          );
        }
      };
      const updateLighting = () => {
        const minute = timeRef.current;
        const cloudMinute = cloudTime.take(minute, 1);
        if (cloudMinute !== undefined) {
          const progress = cloudMinute / 1440;
          const cloudLight = daylight(cloudMinute);
          for (const { cloud, east, north, height, drift } of cloudPatches) {
            cloud.position = Cartesian3.fromDegrees(
              longitude + east + (progress - 0.4) * drift * 2.5,
              latitude + north + progress * 0.00625,
              height,
            );
            cloud.brightness = 0.82 + 0.18 * cloudLight;
          }
        }
        const step = Math.floor(minute / 5) * 5;
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
        const brightness = 0.86 + 0.14 * Math.sqrt(light);
        const red = Math.min(1, brightness - 0.035 * (1 - light) + 0.08 * warm);
        const green = Math.min(1, brightness + 0.025 * warm);
        const blue = Math.min(
          1,
          brightness + 0.035 * (1 - light) - 0.05 * warm,
        );
        const tint = `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`;
        if (tint !== previousTint) {
          previousTint = tint;
          lightingStyle.color = new Expression(tint);
          tileset.makeStyleDirty();
        }
      };
      updateScene.current = () => {
        // The refs keep current playback state while offscreen; resume applies it once.
        if (closed || city.isDestroyed() || !visibleRef.current) return;
        applyQuality();
        updateOverlays();
        updateLighting();
        if (visibleRef.current) city.scene.requestRender();
      };
      const resize = () => {
        if (closed || city.isDestroyed()) return;
        applyQuality();
        if (visibleRef.current) city.scene.requestRender();
      };
      window.addEventListener("resize", resize);
      disposers.push(() => window.removeEventListener("resize", resize));
      updateScene.current();

      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(longitude, latitude - 0.0037, 150),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-10), roll: 0 },
      });
      const roadTiles = new Map<string, Entity[]>();
      let visible = true;
      let revision = 0;
      let template: Promise<string> | undefined;
      const pendingTiles = new Map<
        string,
        { controller: AbortController; promise: Promise<Road[]> }
      >();
      disposers.push(() => {
        for (const pending of pendingTiles.values()) pending.controller.abort();
        pendingTiles.clear();
      });
      async function updateRoads() {
        const current = ++revision;
        setRoadStatus("loading");
        try {
          const urlTemplate = await (template ??= getRoadTemplate(
            roadRequests.signal,
          ).catch((error) => {
            template = undefined;
            throw error;
          }));
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
          for (const [id, pending] of pendingTiles) {
            if (!wanted.has(id)) {
              pending.controller.abort();
              pendingTiles.delete(id);
            }
          }
          for (const [id, entities] of roadTiles) {
            if (wanted.has(id)) continue;
            entities.forEach((entity) => {
              roadColors.delete(entity);
              city.entities.remove(entity);
            });
            roadTiles.delete(id);
          }
          const results = await Promise.allSettled(
            tiles.map(async ({ x, y }) => {
              const id = `${x}/${y}`;
              if (roadTiles.has(id)) return;
              let pending = pendingTiles.get(id);
              if (!pending) {
                const controller = new AbortController();
                const promise = loadRoadTile(
                  urlTemplate,
                  x,
                  y,
                  controller.signal,
                );
                pending = { controller, promise };
                pendingTiles.set(id, pending);
                const clear = () => {
                  if (pendingTiles.get(id)?.promise === promise)
                    pendingTiles.delete(id);
                };
                void promise.then(clear, clear);
              }
              const roads = await pending.promise;
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
            overlayTime.reset();
            updateScene.current();
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
      disposers.push(
        city.camera.moveEnd.addEventListener(() => {
          void updateRoads();
        }),
      );
      trafficEntities.current = (show) => {
        visible = show;
        for (const entities of roadTiles.values()) {
          for (const entity of entities) entity.show = show;
        }
        if (show) void updateRoads();
        city.scene.requestRender();
      };
      void updateRoads();
      const stopWatching = tileset.tileVisible.addEventListener(() => {
        stopWatching();
        if (!closed) setStatus("ready");
      });
      disposers.push(stopWatching);
      disposers.push(
        tileset.tileFailed.addEventListener(() => {
          if (!closed)
            setStatus((current) =>
              current === "loading" ? "failed" : current,
            );
        }),
      );
      viewer.scene.requestRender();
    }

    void load(element).catch(() => {
      if (!closed) setStatus("failed");
      roadRequests.abort();
      dispose();
    });
    return () => {
      closed = true;
      roadRequests.abort();
      trafficEntities.current = () => {};
      updateScene.current = () => {};
      dispose();
    };
  }, [longitude, latitude, tilesetUrl, attempt, hasBeenVisible]);

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
