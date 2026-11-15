"use client";
import dynamic from "next/dynamic";
import { useMemo, useState, useCallback } from "react";
import type { LocationStoryData } from "./location-data";
import { groupListingMarkers } from "@/components/city/listing-markers";
import type { ListingLayerOptions } from "@/components/city/listing-layer";
import { Glass, dollars, number } from "../landing-demo/demo-ui";
import styles from "./landing-story.module.css";
import { storyCardLayout } from "./map-layout";
import { MapDemandFlow } from "./map-demand-flow";
const Neighborhood = dynamic(
  () => import("@/components/simulator/neighborhood"),
  {
    ssr: false,
    loading: () => (
      <div role="status" className={styles.mapStatus}>
        Loading 3D neighborhood
      </div>
    ),
  },
);
type Projection = { id: string; x: number; y: number };
export function StoryMap({
  data,
  minute,
  expanded,
  selected,
  onSelect,
  viewport,
  morning,
}: {
  data: LocationStoryData;
  minute: number;
  expanded: boolean;
  selected: string;
  onSelect: (id: string) => void;
  viewport: { width: number; height: number };
  morning: boolean;
}) {
  const [points, setPoints] = useState<readonly Projection[]>([]);
  const onProject = useCallback(
    (next: readonly Projection[]) => setPoints(next),
    [],
  );
  const markers = useMemo(
    () =>
      groupListingMarkers(
        data.sites.map((site) => ({
          siteId: site.id,
          propertyId: site.id,
          longitude: site.longitude,
          latitude: site.latitude,
          address: `${site.name} · example area`,
        })),
      ),
    [data.sites],
  );
  const listingLayer: ListingLayerOptions = useMemo(
    () => ({
      markers,
      selectedSiteId: selected,
      onSelectSite: onSelect,
      cameraRequest: { kind: "overview", revision: morning ? 1 : 0 },
      showLabels: false,
      onProject,
      viewport: (canvas) => {
        const top = morning ? (canvas.clientHeight >= 700 ? 200 : 155) : 135;
        return {
          left: 24,
          top,
          width: Math.max(200, canvas.clientWidth - 48),
          height: morning
            ? canvas.clientHeight >= 700
              ? canvas.clientHeight - 280
              : Math.max(130, canvas.clientHeight - top - 205)
            : Math.max(150, canvas.clientHeight - 270),
        };
      },
    }),
    [markers, selected, onSelect, onProject, morning],
  );
  const { offsets } = useMemo(
    () => storyCardLayout(points, viewport),
    [points, viewport],
  );
  return (
    <div className={styles.map} data-map-source="Vexcel">
      <Neighborhood
        longitude={-95.395}
        latitude={29.766}
        tilesetUrl="/api/vexcel/3d/tileset"
        minute={minute}
        quality="balanced"
        illustrativeOverlays={false}
        birdseye
        showLocationLabel={false}
        locationLabel="Houston · example neighborhoods"
        listingLayer={listingLayer}
      >
        {null}
      </Neighborhood>
      {morning && (
        <MapDemandFlow
          data={data}
          points={points}
          minute={minute}
          viewport={viewport}
        />
      )}
      {points.length === 0 && !morning && (
        <Glass className={styles.mapFallback}>
          <span>Example space assumptions</span>
          <div>
            {data.sites.map((site) => (
              <div key={site.id}>
                <strong>{site.name}</strong>
                <p>{dollars(site.rent)} / month</p>
                <p>{number(site.size)} sq ft</p>
              </div>
            ))}
          </div>
        </Glass>
      )}
      <div
        className={styles.mapCards}
        style={{ visibility: morning ? "hidden" : "visible" }}
        inert={morning}
      >
        <svg
          className={styles.pinLeaders}
          aria-hidden="true"
          style={{ opacity: expanded ? 1 : 0 }}
        >
          {points.map((point) => {
            const offset = offsets.get(point.id);
            return offset ? (
              <line
                key={point.id}
                x1={point.x}
                y1={point.y}
                x2={point.x + offset.x}
                y2={point.y + offset.y}
              />
            ) : null;
          })}
        </svg>
        {data.sites.map((site) => {
          const marker = markers.find((m) => m.members[0].siteId === site.id);
          const point = points.find((p) => p.id === marker?.id);
          if (!point) return null;
          return (
            <div
              className={styles.pinAnchor}
              style={{ left: point.x, top: point.y }}
              key={site.id}
              inert={!expanded}
            >
              <Glass
                className={styles.pinCard}
                style={{
                  left: offsets.get(point.id)?.x ?? 0,
                  top: offsets.get(point.id)?.y ?? -70,
                  opacity: expanded ? 1 : 0,
                  transform: `translate(-50%,-50%) scale(${expanded ? 1 : 0.7})`,
                }}
              >
                <button
                  onClick={() => onSelect(site.id)}
                  type="button"
                  data-selected={selected === site.id}
                >
                  <strong>{site.name}</strong>
                  <span>
                    {dollars(site.rent)}
                    <small> / month</small>
                  </span>
                  <span>{number(site.size)} sq ft</span>
                  <small>Example area · assumed rent</small>
                </button>
              </Glass>
            </div>
          );
        })}
      </div>
    </div>
  );
}
