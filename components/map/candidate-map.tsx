"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { getSiteFixture } from "../site/site-fixtures";
import {
  type MapSite,
  mapCanvasStyle,
  mapStorageKey,
  mapToolbarStyle,
} from "./map-layout";

type Overlay = "residents" | "workers";

// Only the maplibre canvas is lazy. Everything that takes up space (the toolbar row, the
// canvas slot and the caption) lives in the static CandidateMap frame below, so the
// loading placeholder and the loaded map occupy exactly the same geometry (HAC-109).
const CandidateMapCanvas = dynamic(() => import("./candidate-map-canvas"), {
  ssr: false,
  loading: () => (
    <p
      role="status"
      className="grid h-full place-items-center rounded-lg bg-paper"
    >
      Loading map…
    </p>
  ),
});

export default function CandidateMap({
  projectId,
  sites,
  selectedId,
  example = false,
}: {
  projectId: string;
  sites: MapSite[];
  selectedId?: string;
  example?: boolean;
}) {
  const key = mapStorageKey(projectId, sites, example);
  const [overlay, setOverlay] = useState<Overlay>(() => {
    try {
      return sessionStorage.getItem(key + ":overlay") === "workers"
        ? "workers"
        : "residents";
    } catch {
      return "residents";
    }
  });
  // The canvas chunk has mounted: only then does the Catchment layer control appear.
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onMounted = useCallback(() => setReady(true), []);
  const onFailed = useCallback(() => {
    setReady(false);
    setFailed(true);
  }, []);
  const selected =
    example && selectedId ? getSiteFixture(selectedId) : undefined;

  if (failed)
    return (
      <div className="rounded-lg bg-paper p-4">
        <p role="alert">The map is unavailable. Choose a candidate below.</p>
        <button
          type="button"
          className="mt-3 rounded bg-pine px-3 py-2 text-white"
          onClick={() => setFailed(false)}
        >
          Retry map
        </button>
      </div>
    );

  return (
    <>
      {example && (
        <div className="mb-3 flex items-center" style={mapToolbarStyle}>
          {ready && (
            <label className="flex items-center gap-2 text-sm font-medium">
              Catchment layer
              <select
                className="rounded border border-line px-2 py-1"
                value={overlay}
                onChange={(event) => {
                  const next =
                    event.target.value === "workers" ? "workers" : "residents";
                  setOverlay(next);
                  try {
                    sessionStorage.setItem(key + ":overlay", next);
                  } catch {}
                }}
              >
                <option value="residents">Residents</option>
                <option value="workers">Workers</option>
              </select>
            </label>
          )}
        </div>
      )}
      <div style={mapCanvasStyle}>
        <CandidateMapCanvas
          projectId={projectId}
          sites={sites}
          selectedId={selectedId}
          example={example}
          overlay={overlay}
          onMounted={onMounted}
          onFailed={onFailed}
        />
      </div>
      {example ? (
        <p className="mt-2 text-sm text-muted">
          Orange markers show example competitors.
          {selected &&
            ` The ring contains an estimated ${selected[overlay].toLocaleString("en-US")} ${overlay} in this fixture.`}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Markers use listing coordinates. Catchment evidence is available in
          site details; no population is inferred from this map.
        </p>
      )}
    </>
  );
}
