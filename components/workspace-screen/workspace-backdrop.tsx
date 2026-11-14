"use client";

import dynamic from "next/dynamic";
import { candidateCoordinates, type WorkspaceCandidate } from "./client-model";
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
}: {
  city: string;
  interior: boolean;
  selected?: WorkspaceCandidate;
  tilesetUrl?: string;
}) {
  const city = supportedCity(label);
  const coords =
    candidateCoordinates(selected) ?? (city ? centers[city] : null);
  if (interior && selected)
    return (
      <SelectedInterior
        key={selected.candidate.id}
        siteId={selected.candidate.id}
        address={selected.candidate.address}
      />
    );
  // The current proxy's collection is Houston-only. HAC77 owns verified LA collection selection.
  if (tilesetUrl && coords && city === "Houston")
    return (
      <Neighborhood
        {...coords}
        tilesetUrl={tilesetUrl}
        minute={720}
        quality="balanced"
        locationLabel={
          selected?.candidate.address ?? label + " · 3D neighborhood"
        }
        illustrativeOverlays={false}
        birdseye
        showLocationLabel={false}
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
