"use client";

import { useEffect, useReducer, useRef, useState } from "react";
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
import { GlassControl } from "@/components/ui/glass-control";
import {
  RENDER_SETTINGS,
  createTimelineSampler,
  resolutionScaleFor,
  type RenderQuality,
} from "./render-policy";
import { useSceneVisibility } from "./use-scene-visibility";
import {
  describeCityLoad,
  initialCityLoad,
  reduceCityLoad,
} from "./city-loading";
import { warmTileDecoders } from "./tile-decoders";
import { createAnimatedColor } from "./animated-color";
import {
  createListingLayer,
  type ListingLayerOptions,
} from "@/components/city/listing-layer";
import {
  listingTileError,
  LISTING_TILE_BUDGET,
} from "@/components/city/listing-markers";

export default function Neighborhood({
  longitude,
  latitude,
  tilesetUrl,
  minute,
  children,
  quality = "balanced",
  locationLabel,
  controls,
  illustrativeOverlays = true,
  birdseye = false,
  showLocationLabel = true,
  listingLayer,
}: {
  longitude: number;
  latitude: number;
  tilesetUrl: string;
  minute: number;
  children: ReactNode;
  quality?: RenderQuality;
  locationLabel: string;
  controls?: ReactNode;
  /** The founder workspace shows source imagery without invented traffic/demand. */
  illustrativeOverlays?: boolean;
  birdseye?: boolean;
  /** The workspace already names the city/selected space in its own controls. */
  showLocationLabel?: boolean;
  /** Optional real-listing annotations; does not replace the existing renderer. */
  listingLayer?: ListingLayerOptions;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { visible, hasBeenVisible } = useSceneVisibility(container);
  const timeRef = useRef(minute);
  const qualityRef = useRef(quality);
  const [atmosphere, setAtmosphere] = useState<boolean | undefined>(undefined);
  const atmosphereEnabled = atmosphere ?? quality === "detailed";
  const atmosphereRef = useRef(atmosphereEnabled);
  const visibleRef = useRef(visible);
  const viewerRef = useRef<Viewer | undefined>(undefined);
  const listingOptions = useRef(listingLayer);
  const listingAttachment = useRef<
    ReturnType<typeof createListingLayer> | undefined
  >(undefined);
  useEffect(() => {
    listingOptions.current = listingLayer;
    if (listingLayer) listingAttachment.current?.update(listingLayer);
  }, [listingLayer]);
  const updateScene = useRef<() => void>(() => {});
  useEffect(() => {
    timeRef.current = minute;
    qualityRef.current = quality;
    atmosphereRef.current = atmosphereEnabled;
    updateScene.current();
  }, [minute, quality, atmosphereEnabled]);
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
  const [load, dispatchLoad] = useReducer(
    reduceCityLoad,
    undefined,
    initialCityLoad,
  );
  const skipped = load.phase === "skipped";
  const status =
    load.phase === "failed"
      ? "failed"
      : load.phase === "loading" || skipped
        ? "loading"
        : "ready";
  const [now, setNow] = useState(0);
  const counting = load.phase === "loading";
  useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting]);
  const view = describeCityLoad(load, now);

  useEffect(() => {
    let closed = false;
    let viewer: Viewer | undefined;
    const roadRequests = new AbortController();
    const element = container.current;
    if (!element || !hasBeenVisible || skipped) return;
    dispatchLoad({ type: "start", at: Date.now() });
    const decoderWarmup = new AbortController();
    const disposers: (() => void)[] = [];
    const dispose = () => {
      disposers.splice(0).forEach((stop) => stop());
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = undefined;
    };

    async function load(target: HTMLDivElement) {
      Object.assign(window, { CESIUM_BASE_URL: "/cesium/" });
      const sdk = await import("cesium");
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
        CallbackProperty,
        ColorMaterialProperty,
        JulianDate,
        Cesium3DTileStyle,
        Expression,
        Math: CesiumMath,
      } = sdk;
      if (closed) return;
      // Decoder workers and the tileset document load in parallel, before
      // tile content can saturate the connection (HAC-177).
      const decoders = warmTileDecoders(sdk, {
        signal: decoderWarmup.signal,
        onReady: () => {
          if (!closed) dispatchLoad({ type: "decoder-ready" });
        },
      });
      viewer = new Viewer(target, {
        baseLayer: false,
        // Preserve source mesh below the ellipsoid: a height-zero globe can
        // occlude negative-elevation Vexcel geometry.
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
      const initialSettings = {
        ...RENDER_SETTINGS[qualityRef.current],
        ...(listingOptions.current ? LISTING_TILE_BUDGET : {}),
      };
      dispatchLoad({ type: "engine-ready" });
      const tilesetRequest = Cesium3DTileset.fromUrl(tilesetUrl, {
        showCreditsOnScreen: true,
        maximumScreenSpaceError: initialSettings.tileError,
        cacheBytes: initialSettings.cacheBytes,
        maximumCacheOverflowBytes: initialSettings.maximumCacheOverflowBytes,
        shadows: ShadowMode.DISABLED,
        lightColor: new Cartesian3(0.22, 0.22, 0.22),
        dynamicScreenSpaceError: initialSettings.dynamicScreenSpaceError,
        // Skip intermediate ancestors held by replacement traversal: the
        // street view's initial request roughly halves (HAC-177). Regional
        // shortlists also load only the desired coarse LOD. Cache stays bounded.
        skipLevelOfDetail: true,
        immediatelyLoadDesiredLevelOfDetail: Boolean(listingOptions.current),
      });
      void tilesetRequest.then(
        () => {
          if (!closed) dispatchLoad({ type: "imagery-ready" });
        },
        () => {},
      );
      const [tileset] = await Promise.all([tilesetRequest, decoders]);
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
          color: ReturnType<typeof createAnimatedColor>;
        }
      >();
      const createRoad = ({ roadClass, points, seed }: Road) => {
        const color = createAnimatedColor(
          Color.GREEN.withAlpha(0.82),
          CallbackProperty,
        );
        const entity = city.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(points),
            width: roadClass === "tertiary" ? 5 : 8,
            material: new ColorMaterialProperty(color.property),
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
        color: ReturnType<typeof createAnimatedColor>;
      }[] = [];
      for (const anchor of illustrativeOverlays ? demandAnchors : []) {
        const position = Cartesian3.fromDegrees(
          longitude + anchor.east,
          latitude + anchor.north,
        );
        const radius = new ConstantProperty(
          qualityRef.current === "balanced" ? 65 : 18,
        );
        const color = createAnimatedColor(Color.TRANSPARENT, CallbackProperty);
        city.entities.add({
          position,
          ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            classificationType: ClassificationType.CESIUM_3D_TILE,
            material: new ColorMaterialProperty(color.property),
          },
        });
        anchors.push({ anchor, radius, color });
      }
      const midnight = JulianDate.fromIso8601("2026-11-14T00:00:00-06:00");
      city.clock.shouldAnimate = false;
      const { addVolumetricClouds } = await import("./volumetric-clouds");
      if (closed) return;
      // Sky/clouds are optional and off by default in Balanced. Detailed can
      // restore the original volumetric layer without changing the viewer.
      const createCloudStage = () =>
        RENDER_SETTINGS[qualityRef.current].volumetricClouds &&
        atmosphereRef.current
          ? addVolumetricClouds(city.scene, () => timeRef.current)
          : undefined;
      let cloudStage = createCloudStage();
      let appliedQuality = qualityRef.current;
      let appliedAtmosphere = atmosphereRef.current;
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
      const applyTileError = () => {
        const baseline = RENDER_SETTINGS[qualityRef.current].tileError;
        const frustum = city.camera.frustum;
        const fovy =
          ("fovy" in frustum ? frustum.fovy : undefined) ?? Math.PI / 3;
        const error = listingOptions.current
          ? listingTileError(
              baseline,
              tileset.root.geometricError,
              Math.max(
                1,
                city.camera.positionCartographic.height,
                Cartesian3.distance(
                  city.camera.positionWC,
                  tileset.boundingSphere.center,
                ) - tileset.boundingSphere.radius,
              ),
              city.scene.canvas.clientHeight,
              fovy,
            )
          : baseline;
        // Avoid resetting Cesium's memory-adjusted error on unchanged frames.
        if (Math.abs(tileset.maximumScreenSpaceError - error) > 0.01)
          tileset.maximumScreenSpaceError = error;
      };
      const applyQuality = () => {
        const settings = {
          ...RENDER_SETTINGS[qualityRef.current],
          ...(listingOptions.current ? LISTING_TILE_BUDGET : {}),
        };
        const resolutionScale = resolutionScaleFor(
          window.devicePixelRatio,
          settings.maxPixelRatio,
        );
        if (city.resolutionScale !== resolutionScale) {
          city.resolutionScale = resolutionScale;
        }
        // The tile-error setter also resets Cesium's memory-adjusted error;
        // preserve that adaptive state during ordinary timeline updates.
        applyTileError();
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
        if (
          appliedQuality !== qualityRef.current ||
          appliedAtmosphere !== atmosphereRef.current
        ) {
          if (cloudStage) city.scene.postProcessStages.remove(cloudStage);
          cloudStage = createCloudStage();
          appliedQuality = qualityRef.current;
          appliedAtmosphere = atmosphereRef.current;
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
        lowClouds.show = atmosphereRef.current;
        if (city.scene.sun) city.scene.sun.show = atmosphereRef.current;
        if (!atmosphereRef.current) {
          city.scene.backgroundColor = Color.fromCssColorString(
            listingOptions.current ? "#17181d" : "#101b16",
          );
          previousMinute = -1;
          return;
        }
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
        destination: Cartesian3.fromDegrees(
          longitude,
          latitude - 0.0037,
          birdseye ? 650 : 150,
        ),
        orientation: {
          heading: 0,
          pitch: CesiumMath.toRadians(birdseye ? -60 : -10),
          roll: 0,
        },
      });
      if (listingOptions.current) {
        // Reuses Cesium's own render loop. No polling, private SDK state or
        // external root patch: only a public presentation threshold changes.
        disposers.push(city.scene.preRender.addEventListener(applyTileError));
        const attachment = createListingLayer(
          viewer,
          sdk,
          listingOptions.current,
        );
        listingAttachment.current = attachment;
        disposers.push(() => {
          attachment.destroy();
          if (listingAttachment.current === attachment)
            listingAttachment.current = undefined;
        });
      }
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
        if (!illustrativeOverlays) return;
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
        if (closed) return;
        const at = Date.now();
        dispatchLoad({ type: "first-building", at });
        // allTilesLoaded can fire on the frame before the last tile renders.
        if (tileset.tilesLoaded) dispatchLoad({ type: "settled", at });
      });
      disposers.push(stopWatching);
      disposers.push(
        tileset.loadProgress.addEventListener(
          (pending: number, processing: number) => {
            if (!closed)
              dispatchLoad({ type: "progress", pending, processing });
          },
        ),
        tileset.tileLoad.addEventListener((tile: object) => {
          // External tileset documents are not buildings.
          if (!closed && Reflect.get(tile, "hasTilesetContent") !== true)
            dispatchLoad({ type: "tile-ready" });
        }),
        tileset.allTilesLoaded.addEventListener(() => {
          if (!closed) dispatchLoad({ type: "settled", at: Date.now() });
        }),
        tileset.tileFailed.addEventListener(() => {
          if (!closed) dispatchLoad({ type: "failed" });
        }),
      );
      viewer.scene.requestRender();
    }

    void load(element).catch(() => {
      if (!closed) dispatchLoad({ type: "failed" });
      decoderWarmup.abort();
      roadRequests.abort();
      trafficEntities.current = () => {};
      updateScene.current = () => {};
      dispose();
      // A constructor that throws can leave Cesium's own error panel behind
      // before assigning viewer. This div contains only the unmanaged SDK UI.
      if (!closed) element.replaceChildren();
    });
    return () => {
      closed = true;
      decoderWarmup.abort();
      roadRequests.abort();
      trafficEntities.current = () => {};
      updateScene.current = () => {};
      dispose();
    };
  }, [
    longitude,
    latitude,
    tilesetUrl,
    attempt,
    hasBeenVisible,
    illustrativeOverlays,
    birdseye,
    skipped,
  ]);

  return (
    <div
      id="neighborhood"
      data-city-stage={view.stage}
      className="relative h-full w-full overflow-hidden bg-viewport-canvas text-viewport-ink"
    >
      <div
        className="absolute inset-0"
        ref={container}
        role="region"
        aria-label="Vexcel 3D neighborhood"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(0_0_0/0.55))]"
      />

      {(showLocationLabel || status === "failed") && (
        <div
          className={`absolute ${showLocationLabel ? "top-3" : "top-20"} left-3 z-10 max-w-[60%] rounded bg-viewport-surface p-2 text-xs text-viewport-muted`}
        >
          {showLocationLabel && <span>{locationLabel}</span>}
          {status === "failed" && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setTrafficVisible(true);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {status !== "ready" && (
        <div
          data-city-overlay
          className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-sm text-viewport-muted"
        >
          {load.phase === "failed" ? (
            <p role="status">{view.title}</p>
          ) : skipped ? (
            <div className="pointer-events-auto grid justify-items-center gap-2 rounded bg-viewport-surface px-4 py-3 text-center">
              <p role="status">
                {view.title}. The timeline and replay still work.
              </p>
              <button
                type="button"
                className="underline"
                onClick={() => dispatchLoad({ type: "start", at: Date.now() })}
              >
                Load 3D neighborhood
              </button>
            </div>
          ) : (
            <div className="pointer-events-auto grid max-w-sm justify-items-center gap-1.5 rounded bg-viewport-surface/85 px-4 py-3 text-center">
              <div role="status" className="grid justify-items-center gap-1.5">
                <span className="flex items-center gap-3 text-viewport-ink">
                  <span className="size-4 motion-safe:animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
                  Loading 3D neighborhood: {view.title}
                </span>
                <span className="text-xs">
                  {[
                    view.step &&
                      `Step ${view.step.index} of ${view.step.total}`,
                    view.detail,
                    `${view.elapsedSeconds} s`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {view.offerSkip && (
                <p className="text-xs">
                  Taking longer than usual.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => dispatchLoad({ type: "skip" })}
                  >
                    Skip 3D view
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {load.phase === "visible" && (
        <p
          role="status"
          className="pointer-events-none absolute top-3 left-1/2 z-10 w-max max-w-[min(30rem,50%)] -translate-x-1/2 rounded bg-viewport-surface px-2 py-1 text-center text-[11px] text-viewport-muted"
        >
          {view.title} · {view.detail} · first buildings after{" "}
          {view.elapsedSeconds} s
        </p>
      )}

      {illustrativeOverlays && (
        <GlassControl
          over="viewport"
          aria-label="Illustrative neighborhood overlays"
          className="absolute top-20 left-3 z-10 w-[11.5rem] !p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              Illustrative traffic pattern
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={trafficVisible}
              aria-label="Illustrative traffic pattern"
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
            <p role="status" className="mt-2 text-[11px] text-viewport-muted">
              {roadStatus === "loading"
                ? "Loading nearby roads…"
                : "Some roads didn’t load. Move the map or toggle to retry."}
            </p>
          )}

          <p className="mt-2 text-[11px]">
            Time-of-day curves and invented offsets; not observed traffic.
          </p>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium">
              Assumed activity by time of day
            </summary>
            <p className="mt-1 text-[11px]">
              Hand-placed anchors; not measured trips.
            </p>
            <ul className="mt-2.5 space-y-2">
              {demandAnchors.map((anchor) => {
                const level = demandLevel(minute, anchor.peaks);
                return (
                  <li
                    key={anchor.label}
                    className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[11px] text-viewport-muted"
                    title={`${anchor.label}: ${level > 0.6 ? "High" : level > 0.2 ? "Moderate" : "Low"}`}
                  >
                    {anchor.label}
                    <span className="h-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300"
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
          </details>
          <label className="mt-4 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={atmosphereEnabled}
              onChange={(event) => setAtmosphere(event.target.checked)}
            />
            Sky and clouds
          </label>
          <div className="mt-3">{controls}</div>
        </GlassControl>
      )}

      {children}

      <p className="absolute right-4 bottom-2 z-10 text-[10px] text-viewport-muted sm:right-6">
        © Vexcel Imaging · © Microsoft · © OpenStreetMap via OpenFreeMap
      </p>
    </div>
  );
}
