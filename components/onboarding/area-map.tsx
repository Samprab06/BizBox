"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import Map, { Layer, Source, type MapRef } from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City } from "./flow";
import {
  areaMapMatchesCity,
  cityViews,
  readAreaMap,
  writeAreaMap,
  type Brush,
  type Rectangle,
} from "./area-map-data";
import { areaMapPlaces } from "./area-map-places";
import styles from "./area-map.module.css";

const style: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    streets: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#111a20" },
    },
    {
      id: "water",
      type: "line",
      source: "streets",
      "source-layer": "water",
      paint: { "line-color": "#ffffff", "line-opacity": 0.3, "line-width": 1 },
    },
    {
      id: "boundaries",
      type: "line",
      source: "streets",
      "source-layer": "boundary",
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.25,
        "line-width": 0.7,
        "line-dasharray": [3, 3],
      },
    },
    {
      id: "roads",
      type: "line",
      source: "streets",
      "source-layer": "transportation",
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.65,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.45, 14, 1.5],
      },
    },
  ],
};

export function AreaMap({
  city,
  value,
  onChange,
}: {
  city: City;
  value: string;
  onChange: (value: string) => void;
}) {
  const map = useRef<MapRef>(null);
  const [tool, setTool] = useState<Brush | "erase">("favor");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [credits, setCredits] = useState(false);
  const [cursor, setCursor] = useState({ x: 0.5, y: 0.5 });
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const parsed = readAreaMap(value, city);
  useEffect(() => {
    if (!areaMapMatchesCity(value, city)) onChange("");
  }, [city, value, onChange]);
  const previous = parsed.previous;
  const color =
    tool === "favor" ? "#70edaa" : tool === "avoid" ? "#ff9296" : "white";

  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function finish(
    end: { x: number; y: number },
    width: number,
    height: number,
  ) {
    if (!map.current || !ready || failed || !start) return;
    const a = map.current.unproject([start.x * width, start.y * height]);
    const b = map.current.unproject([end.x * width, end.y * height]);
    const bounds: Rectangle["bounds"] = [
      Math.min(a.lng, b.lng),
      Math.min(a.lat, b.lat),
      Math.max(a.lng, b.lng),
      Math.max(a.lat, b.lat),
    ].map((n) => +n.toFixed(5)) as Rectangle["bounds"];
    if (tool === "erase") {
      const click =
        Math.hypot((end.x - start.x) * width, (end.y - start.y) * height) < 4;
      const rectangles = parsed.rectangles.filter(({ bounds: r }) =>
        click
          ? !(a.lng >= r[0] && a.lng <= r[2] && a.lat >= r[1] && a.lat <= r[3])
          : !(
              r[0] <= bounds[2] &&
              r[2] >= bounds[0] &&
              r[1] <= bounds[3] &&
              r[3] >= bounds[1]
            ),
      );
      const marks = parsed.marks.filter((mark) => {
        if (click) {
          const p = map.current!.project([mark.lng, mark.lat]);
          return Math.hypot(p.x - end.x * width, p.y - end.y * height) > 22;
        }
        return !(
          mark.lng >= bounds[0] &&
          mark.lng <= bounds[2] &&
          mark.lat >= bounds[1] &&
          mark.lat <= bounds[3]
        );
      });
      onChange(writeAreaMap(marks, city, previous, rectangles));
    } else if (
      Math.abs(end.x - start.x) * width >= 3 &&
      Math.abs(end.y - start.y) * height >= 3
    ) {
      onChange(
        writeAreaMap(parsed.marks, city, previous, [
          ...parsed.rectangles,
          { bounds, brush: tool },
        ]),
      );
    }
    setStart(null);
  }

  const all = [...parsed.marks, ...parsed.rectangles];
  return (
    <div>
      <div
        className={styles.toolbar}
        role="group"
        aria-label="Area selection tools"
      >
        {(["favor", "avoid", "erase"] as const).map((name) => (
          <button
            key={name}
            type="button"
            className={`${styles.tool} ${name === "favor" ? styles.favor : name === "avoid" ? styles.avoid : ""}`}
            aria-pressed={tool === name}
            onClick={() => {
              setTool(name);
              setStart(null);
            }}
          >
            {name === "favor"
              ? "▧ Favor"
              : name === "avoid"
                ? "▧ Avoid"
                : "Erase"}
          </button>
        ))}
        <button
          type="button"
          className={styles.tool}
          onClick={() => {
            setStart(null);
            onChange(previous);
          }}
        >
          Reset
        </button>
      </div>
      <div className={styles.frame}>
        <Map
          ref={map}
          initialViewState={cityViews[city]}
          mapStyle={style}
          interactive={false}
          attributionControl={false}
          onLoad={(event) => {
            const pixels = new Uint8Array(8 * 8 * 4);
            for (let y = 0; y < 8; y++)
              for (let x = 0; x < 8; x++) {
                const i = (y * 8 + x) * 4;
                pixels[i] = pixels[i + 1] = pixels[i + 2] = 235;
                pixels[i + 3] = Math.hypot(x - 3.5, y - 3.5) <= 3 ? 255 : 0;
              }
            if (!event.target.hasImage("neighborhood-dot"))
              event.target.addImage("neighborhood-dot", {
                width: 8,
                height: 8,
                data: pixels,
              });
            setReady(true);
          }}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%" }}
        >
          <Source
            id="area-rectangles"
            type="geojson"
            data={{
              type: "FeatureCollection",
              features: parsed.rectangles.map(
                ({ bounds: [w, s, e, n], brush }) => ({
                  type: "Feature",
                  properties: { brush },
                  geometry: {
                    type: "Polygon",
                    coordinates: [
                      [
                        [w, s],
                        [e, s],
                        [e, n],
                        [w, n],
                        [w, s],
                      ],
                    ],
                  },
                }),
              ),
            }}
          >
            <Layer
              id="area-fill"
              type="fill"
              paint={{
                "fill-color": [
                  "match",
                  ["get", "brush"],
                  "favor",
                  "#34d987",
                  "#fa6675",
                ],
                "fill-opacity": 0.26,
              }}
            />
            <Layer
              id="area-outline"
              type="line"
              paint={{
                "line-color": [
                  "match",
                  ["get", "brush"],
                  "favor",
                  "#70edaa",
                  "#ff9296",
                ],
                "line-width": 1.5,
              }}
            />
          </Source>
          <Source
            id="legacy-brush-marks"
            type="geojson"
            data={{
              type: "FeatureCollection",
              features: parsed.marks.map((mark) => ({
                type: "Feature",
                properties: { brush: mark.brush },
                geometry: { type: "Point", coordinates: [mark.lng, mark.lat] },
              })),
            }}
          >
            <Layer
              id="legacy-paint"
              type="circle"
              paint={{
                "circle-radius": 22,
                "circle-color": [
                  "match",
                  ["get", "brush"],
                  "favor",
                  "#34d987",
                  "#fa6675",
                ],
                "circle-opacity": 0.48,
              }}
            />
          </Source>
          <Source
            id="neighborhood-places"
            type="geojson"
            data={{
              type: "FeatureCollection",
              features: areaMapPlaces[city].map((place) => ({
                type: "Feature",
                properties: { name: place.name },
                geometry: { type: "Point", coordinates: place.coordinates },
              })),
            }}
          >
            <Layer
              id="neighborhood-labels"
              type="symbol"
              layout={{
                "icon-image": "neighborhood-dot",
                "icon-size": 0.65,
                "icon-allow-overlap": false,
                "icon-optional": false,
                "text-field": ["get", "name"],
                "text-font": ["Noto Sans Regular"],
                "text-size": 11,
                "text-variable-anchor": ["top", "bottom", "right", "left"],
                "text-radial-offset": 0.65,
                "text-max-width": 12,
                "text-padding": 10,
                "text-allow-overlap": false,
                "text-optional": false,
              }}
              paint={{
                "text-color": "#ffe600",
                "text-halo-color": "#111a20",
                "text-halo-width": 2,
                "text-halo-blur": 0.6,
              }}
            />
          </Source>
        </Map>
        <div
          className={styles.surface}
          role="application"
          aria-label={`${city} area preference map. Drag to select a rectangle. Keyboard: arrows move, Space starts and finishes a rectangle, Escape cancels.`}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0 || !ready || failed) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const p = point(event);
            setStart(p);
            setCursor(p);
          }}
          onPointerMove={(event) => setCursor(point(event))}
          onPointerUp={(event) => {
            const p = point(event);
            const rect = event.currentTarget.getBoundingClientRect();
            finish(p, rect.width, rect.height);
          }}
          onPointerCancel={() => setStart(null)}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              setCursor((p) => ({
                x: Math.max(
                  0,
                  Math.min(
                    1,
                    p.x +
                      (event.key === "ArrowRight"
                        ? 0.025
                        : event.key === "ArrowLeft"
                          ? -0.025
                          : 0),
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    1,
                    p.y +
                      (event.key === "ArrowDown"
                        ? 0.025
                        : event.key === "ArrowUp"
                          ? -0.025
                          : 0),
                  ),
                ),
              }));
            }
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              if (!ready || failed) return;
              if (!start) setStart(cursor);
              else {
                const r = event.currentTarget.getBoundingClientRect();
                finish(cursor, r.width, r.height);
              }
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setStart(null);
            }
          }}
        >
          <svg
            width="100%"
            height="100%"
            aria-hidden="true"
            style={{ pointerEvents: "none" }}
          >
            {start ? (
              <rect
                x={`${Math.min(start.x, cursor.x) * 100}%`}
                y={`${Math.min(start.y, cursor.y) * 100}%`}
                width={`${Math.abs(start.x - cursor.x) * 100}%`}
                height={`${Math.abs(start.y - cursor.y) * 100}%`}
                fill={color}
                fillOpacity=".18"
                stroke={color}
                strokeDasharray="4 3"
              />
            ) : (
              <path
                d="M-7 0H7 M0-7V7"
                transform={`translate(0 0)`}
                style={{
                  transform: `translate(${cursor.x * 100}%, ${cursor.y * 100}%)`,
                }}
                stroke={color}
              />
            )}
          </svg>
        </div>
        <span className={styles.city}>{city}</span>
        <div className={styles.attribution}>
          {credits && (
            <div id="area-map-credits" className={styles.credits}>
              ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>{" "}
              ·{" "}
              <a
                href="https://openfreemap.org"
                target="_blank"
                rel="noreferrer"
              >
                OpenFreeMap
              </a>
            </div>
          )}
          <button
            type="button"
            aria-label="Map attribution"
            aria-expanded={credits}
            aria-controls="area-map-credits"
            onClick={() => setCredits(!credits)}
          >
            ⓘ
          </button>
        </div>
        {(!ready || failed) && (
          <div className={styles.status} role="status">
            {failed
              ? "The street map couldn’t load. Check your connection and reload, or skip this question."
              : "Loading city streets…"}
          </div>
        )}
      </div>
      <div className={styles.caption}>
        <span>
          {tool === "erase"
            ? "Click an area or drag a box to erase selections."
            : "Drag a rectangle. Green favors an area; red avoids it."}
        </span>
        <span aria-live="polite">
          {all.length
            ? `${all.filter((m) => m.brush === "favor").length} green · ${all.filter((m) => m.brush === "avoid").length} red`
            : "No areas selected"}
        </span>
      </div>
      {previous && (
        <p className={styles.caption}>Existing preference: {previous}</p>
      )}
    </div>
  );
}
