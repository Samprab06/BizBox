"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { candidateMarkers, type WorkspaceCandidate } from "./client-model";
import type {
  ListingCameraRequest,
  MapViewport,
} from "@/components/city/listing-markers";
import { supportedCity } from "./model";
import { SelectedInterior } from "./selected-interior";

const Neighborhood = dynamic(
  () => import("@/components/simulator/neighborhood"),
  { ssr: false },
);
const centers = {
  Houston: { latitude: 29.7604, longitude: -95.3698 },
  "Los Angeles": { latitude: 34.0522, longitude: -118.2437 },
};

export function WorkspaceBackdrop({
  city: label,
  interior,
  selected,
  tilesetUrl,
  candidates = [],
  onSelect = () => {},
  cameraRequest = { kind: "overview", revision: 0 },
}: {
  city: string;
  interior: boolean;
  selected?: WorkspaceCandidate;
  tilesetUrl?: string;
  candidates?: WorkspaceCandidate[];
  onSelect?: (siteId: string) => void;
  cameraRequest?: ListingCameraRequest;
}) {
  const city = supportedCity(label);
  const markers = useMemo(() => candidateMarkers(candidates), [candidates]);
  // Selection never changes the renderer anchor or reconstructs its Viewer.
  const coords = city ? centers[city] : null;
  if (interior && selected)
    return (
      <SelectedInterior
        key={selected.candidate.id}
        siteId={selected.candidate.id}
        address={selected.candidate.address}
      />
    );
  // The current proxy's collection is Houston-only. HAC77 owns verified LA collection selection.
  if (coords && city === "Houston")
    return (
      <Neighborhood
        {...coords}
        tilesetUrl={tilesetUrl ?? ""}
        minute={720}
        quality="balanced"
        locationLabel={
          selected?.candidate.address ?? label + " · 3D neighborhood"
        }
        illustrativeOverlays={false}
        birdseye
        showLocationLabel={false}
        listingLayer={{
          markers,
          selectedSiteId: selected?.candidate.id,
          onSelectSite: onSelect,
          cameraRequest,
          viewport: listingViewport,
        }}
      >
        {null}
      </Neighborhood>
    );
  return (
    <div
      className="pointer-events-none absolute inset-x-6 top-24 text-sm text-white/80"
      role="status"
    >
      {city ? "Map unavailable" : "Choose a city"}
    </div>
  );
}

/** Measure actual HTML occlusion; the scene spans under the assistant glass. */
function listingViewport(canvas: HTMLCanvasElement): MapViewport {
  const full = canvas.getBoundingClientRect();
  const workspace =
    canvas.closest("#neighborhood")?.parentElement?.parentElement;
  const pane = workspace
    ?.querySelector("[data-map-viewport]")
    ?.getBoundingClientRect();
  const toolbar = workspace
    ?.querySelector("[data-map-toolbar]")
    ?.getBoundingClientRect();
  const sheet = workspace
    ?.querySelector("[data-map-sheet]")
    ?.getBoundingClientRect();
  const left = (pane ? pane.left - full.left : 0) + 40;
  const top = Math.max(24, toolbar ? toolbar.bottom - full.top + 42 : 96);
  const right = (pane ? pane.right - full.left : full.width * 0.68) - 40;
  const bottom = Math.min(
    pane ? pane.bottom - full.top - 24 : full.height - 24,
    sheet ? sheet.top - full.top - 30 : full.height - 30,
  );
  return {
    left,
    top,
    width: Math.max(100, right - left),
    height: Math.max(100, bottom - top),
  };
}
