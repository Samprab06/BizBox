"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { readRenderPalette } from "@/components/simulator/render-palette";
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type ViewState,
  type MarkerInstance,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import { candidateMapStyleUrl, prepareCandidateMapStyle } from "./map-style";
import {
  catchmentRadiusMiles,
  competitors,
  getSiteFixture,
} from "../site/site-fixtures";
import { type MapSite, mapStorageKey } from "./map-layout";

const initialView = {
  longitude: -95.396,
  latitude: 29.772,
  zoom: 11.4,
  bearing: 0,
  pitch: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
};

function restoreView(key: string): ViewState | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      saved &&
      [saved.longitude, saved.latitude, saved.zoom].every(Number.isFinite) &&
      Math.abs(saved.latitude) <= 85 &&
      Math.abs(saved.longitude) <= 180 &&
      saved.zoom >= 0 &&
      saved.zoom <= 22
    ) {
      return {
        ...initialView,
        longitude: saved.longitude,
        latitude: saved.latitude,
        zoom: saved.zoom,
      };
    }
  } catch {}
  return null;
}

function catchment(longitude: number, latitude: number) {
  const latitudeRadius = catchmentRadiusMiles / 69;
  const longitudeRadius = latitudeRadius / Math.cos((latitude * Math.PI) / 180);
  const points = Array.from({ length: 64 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 64;
    return [
      longitude + longitudeRadius * Math.cos(angle),
      latitude + latitudeRadius * Math.sin(angle),
    ];
  });
  return [...points, points[0]];
}

type Site = MapSite;
export type Overlay = "residents" | "workers";

function setSiteMarkerElement(marker: MarkerInstance | null) {
  if (!marker) return;
  const element = marker.getElement();
  // MapLibre supplies button semantics for unconfigured marker wrappers.
  // The link inside this wrapper is the site marker's only control.
  element.setAttribute("role", "presentation");
  element.setAttribute("aria-label", "");
}

/**
 * The interactive map canvas only (HAC-109). Layout, toolbar, caption, overlay choice and
 * the failure panel belong to the static frame in candidate-map.tsx, so loading this
 * chunk never changes the page layout.
 */
export default function CandidateMapCanvas({
  projectId,
  sites,
  selectedId,
  example = false,
  overlay,
  onMounted,
  onFailed,
}: {
  projectId: string;
  sites: Site[];
  selectedId?: string;
  example?: boolean;
  overlay: Overlay;
  onMounted: () => void;
  onFailed: () => void;
}) {
  const [palette] = useState(readRenderPalette);
  const key = mapStorageKey(projectId, sites, example);
  const located = sites.filter(
    (site): site is Site & { latitude: number; longitude: number } =>
      site.latitude !== null && site.longitude !== null,
  );
  const center = located.length
    ? {
        latitude:
          located.reduce((sum, site) => sum + site.latitude, 0) /
          located.length,
        longitude:
          located.reduce((sum, site) => sum + site.longitude, 0) /
          located.length,
      }
    : initialView;
  const [restored] = useState(() => restoreView(key));
  const [view, setView] = useState(
    () => restored ?? { ...initialView, ...center },
  );
  const loaded = useRef(false);
  const [mapStyle, setMapStyle] = useState<StyleSpecification>();
  const selected =
    example && selectedId ? getSiteFixture(selectedId) : undefined;

  useEffect(() => {
    onMounted();
  }, [onMounted]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(candidateMapStyleUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Map style request failed: ${response.status}`);
        return prepareCandidateMapStyle(
          await response.json(),
          response.url || candidateMapStyleUrl,
        );
      })
      .then((style) => {
        if (!controller.signal.aborted) setMapStyle(style);
      })
      .catch(() => {
        if (!controller.signal.aborted) onFailed();
      });
    return () => controller.abort();
  }, [onFailed]);

  if (!mapStyle) return null;

  return (
    <>
      <Map
        {...view}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        onMove={({ viewState }) => setView(viewState)}
        onMoveEnd={({ viewState }) => {
          try {
            sessionStorage.setItem(key, JSON.stringify(viewState));
          } catch {}
        }}
        onLoad={(event) => {
          loaded.current = true;
          // The shell can reveal a zero-width mount before MapLibre's first
          // ResizeObserver delivery, which MapLibre intentionally skips. Reconcile
          // that initial fallback size once; its own observer handles later changes.
          event.target.resize();
          if (!example && !restored && located.length)
            event.target.fitBounds(
              [
                [
                  Math.min(...located.map((site) => site.longitude)),
                  Math.min(...located.map((site) => site.latitude)),
                ],
                [
                  Math.max(...located.map((site) => site.longitude)),
                  Math.max(...located.map((site) => site.latitude)),
                ],
              ],
              { padding: 60, maxZoom: 13, duration: 0 },
            );
        }}
        onError={() => {
          if (!loaded.current) onFailed();
        }}
        dragRotate={false}
        touchPitch={false}
        maxPitch={0}
      >
        <NavigationControl showCompass={false} />
        {selected && (
          <Source
            id="catchment"
            type="geojson"
            data={{
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                coordinates: [catchment(selected.longitude, selected.latitude)],
              },
            }}
          >
            <Layer
              id="catchment-fill"
              type="fill"
              paint={{
                "fill-color":
                  overlay === "residents" ? palette.accent : palette.muted,
                "fill-opacity": 0.23,
              }}
            />
            <Layer
              id="catchment-outline"
              type="line"
              paint={{ "line-color": palette.canvas, "line-width": 2 }}
            />
          </Source>
        )}
        {example &&
          competitors.map((competitor) => (
            <Marker
              ref={(marker) => {
                const element = marker?.getElement();
                element?.setAttribute("role", "img");
                element?.setAttribute("aria-label", competitor.name);
              }}
              key={competitor.name}
              longitude={competitor.longitude}
              latitude={competitor.latitude}
            >
              <span
                title={competitor.name}
                className="block size-3 rounded-full border-2 border-canvas bg-warn shadow"
              />
            </Marker>
          ))}
        {sites.map((site) => {
          const location = site;
          if (location.latitude === null || location.longitude === null)
            return null;
          return (
            <Marker
              ref={setSiteMarkerElement}
              key={site.id}
              longitude={location.longitude}
              latitude={location.latitude}
            >
              <Link
                href={site.href}
                aria-label={`Open ${site.address}`}
                aria-current={site.id === selectedId || undefined}
                className="rounded-full border-2 border-canvas bg-accent px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-on-accent shadow focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas aria-[current=true]:ring-4 aria-[current=true]:ring-focus-ring aria-[current=true]:ring-offset-2 aria-[current=true]:ring-offset-canvas"
              >
                {site.address}
              </Link>
            </Marker>
          );
        })}
      </Map>
    </>
  );
}
