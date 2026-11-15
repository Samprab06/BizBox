"use client";
import { useEffect, useState } from "react";
import {
  getRoadTemplate,
  loadRoadTile,
} from "@/components/simulator/road-tiles";
import { Glass } from "../landing-demo/demo-ui";
import type { LocationStoryData } from "./location-data";
import {
  roadTileAt,
  streetRoutes,
  positionOnStreet,
  screenProjection,
  type StreetRoute,
} from "./map-demand";
import type { ProjectedPin } from "./map-layout";
import styles from "./map-demand-flow.module.css";
const roadCache = new Map<string, StreetRoute[]>();
export function MapDemandFlow({
  data,
  points,
  minute,
  viewport,
}: {
  data: LocationStoryData;
  points: readonly ProjectedPin[];
  minute: number;
  viewport: { width: number; height: number };
}) {
  const [routes, setRoutes] = useState<Record<string, StreetRoute[]>>({});
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let closed = false;
    async function load() {
      try {
        const template = await getRoadTemplate(controller.signal);
        const loaded = await Promise.all(
          data.sites.map(async (site) => {
            const key = `${site.longitude},${site.latitude}`;
            let paths = roadCache.get(key);
            if (!paths) {
              const tile = roadTileAt(site.longitude, site.latitude);
              paths = streetRoutes(
                await loadRoadTile(template, tile.x, tile.y, controller.signal),
                site,
              );
              if (!paths.length) throw new Error("Street paths unavailable");
              roadCache.set(key, paths);
            }
            return [site.id, paths] as const;
          }),
        );
        if (!closed) {
          setRoutes(Object.fromEntries(loaded));
          setFailed(false);
        }
      } catch {
        if (!closed) setFailed(true);
      }
    }
    void load();
    return () => {
      closed = true;
      controller.abort();
    };
  }, [data.sites]);
  const anchors = data.sites.flatMap((site) => {
    const pin = points.find(
      (p) => p.id === `${site.longitude},${site.latitude}`,
    );
    return pin
      ? [{ ...pin, longitude: site.longitude, latitude: site.latitude }]
      : [];
  });
  const project = screenProjection(anchors);
  const min = Math.max(480, Math.min(720, minute));
  return (
    <div
      aria-label="Modeled movement on sourced street paths"
      data-demand-flow
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 3,
      }}
    >
      <svg
        width="100%"
        height="100%"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          clipPath: `inset(${viewport.height > 480 ? 225 : 150}px 0 90px)`,
        }}
      >
        {project &&
          data.sites.map((site, siteIndex) => {
            const paths = routes[site.id] ?? [],
              color = siteIndex === 0 ? "#b8ffe5" : "#b9dfff";
            return (
              <g key={site.id} data-flow-site={site.id}>
                {paths.map((path) => {
                  const d = path.points
                    .map((p) => project(p))
                    .map(
                      (p, i) =>
                        `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
                    )
                    .join(" ");
                  return (
                    <g key={path.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke="#0c2034"
                        strokeWidth="7"
                        strokeOpacity=".75"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                        strokeOpacity=".8"
                      />
                    </g>
                  );
                })}
                {paths.length > 0 &&
                  Array.from(
                    { length: Math.round(site.arrivals / 6) },
                    (_, i) => {
                      const progress =
                          ((min - 480) / 38 + i * 0.61803398875) % 1,
                        p = project(
                          positionOnStreet(paths[i % paths.length], progress),
                        );
                      return (
                        <g
                          key={i}
                          data-road-dot={site.id}
                          className={styles.dot}
                          style={{ transform: `translate(${p.x}px,${p.y}px)` }}
                          opacity={
                            0.35 +
                            0.65 *
                              Math.min(1, progress * 12, (1 - progress) * 12)
                          }
                        >
                          <circle
                            cx={0}
                            cy={0}
                            r="7"
                            fill="#0c2034"
                            fillOpacity=".8"
                          />
                          <circle
                            cx={0}
                            cy={0}
                            r="4.5"
                            fill={color}
                            stroke="#fffdf8"
                            strokeWidth="1.1"
                          />
                        </g>
                      );
                    },
                  )}
              </g>
            );
          })}
      </svg>
      {data.sites.map((site, index) => {
        const pin = anchors.find(
          (p) => p.id === `${site.longitude},${site.latitude}`,
        );
        if (!pin) return null;
        const checkpoint =
          [...site.checkpoints].reverse().find((p) => p.minute <= min) ??
          site.checkpoints[0];
        return (
          <Glass
            key={site.id}
            style={{
              position: "absolute",
              left: Math.max(
                12,
                Math.min(
                  viewport.width - 178,
                  index === 0 ? pin.x - 205 : pin.x + 32,
                ),
              ),
              top: Math.max(225, Math.min(viewport.height - 180, pin.y - 28)),
              padding: "10px 13px",
              width: 166,
              borderRadius: 16,
              color: "#fffdf8",
            }}
          >
            <strong
              style={{
                display: "block",
                fontSize: 15,
                fontWeight: 500,
                marginBottom: 5,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: index === 0 ? "#b8ffe5" : "#b9dfff",
                  marginRight: 7,
                }}
              />
              {site.name}
            </strong>
            <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              {checkpoint.served} served · {checkpoint.arrivals} arrivals
            </span>
          </Glass>
        );
      })}
      <p
        style={{
          position: "absolute",
          left: 24,
          bottom: 94,
          margin: 0,
          fontSize: 11,
          color: "#fffdf8",
          background: "#112b3bb3",
          borderRadius: 10,
          padding: "7px 10px",
        }}
      >
        {failed
          ? "Street paths unavailable"
          : !Object.keys(routes).length
            ? "Loading street paths"
            : "Modeled movement · OpenStreetMap street paths"}
      </p>
    </div>
  );
}
