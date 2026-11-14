"use client";

import { useEffect, useState } from "react";
import {
  InteriorResponseSchema,
  type InteriorResponse,
} from "@/lib/contracts/interior";
import { scannedInterior, showcaseUrl } from "./client-model";
import styles from "./workspace-glass.module.css";

/** Reads the selected registry entry; never falls back to a public demo or invented room. */
export function SelectedInterior({
  siteId,
  address,
}: {
  siteId: string;
  address: string;
}) {
  const [response, setResponse] = useState<InteriorResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void fetch(`/api/sites/${encodeURIComponent(siteId)}/interior`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Interior unavailable");
        return InteriorResponseSchema.parse(await r.json());
      })
      .then((value) => {
        if (current) {
          setResponse(value);
          setPhase("ready");
        }
      })
      .catch(() => {
        if (current) setPhase("failed");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      current = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [siteId, attempt]);
  const scan = scannedInterior(response);
  if (phase === "loading")
    return (
      <div className={styles.empty} role="status">
        Loading interior…
      </div>
    );
  if (phase === "failed")
    return (
      <div className={styles.empty}>
        <h2>Interior unavailable</h2>
        <button
          className={styles.secondary}
          onClick={() => {
            setPhase("loading");
            setAttempt((v) => v + 1);
          }}
        >
          Retry interior
        </button>
      </div>
    );
  if (scan)
    return (
      <>
        <iframe
          title={`Matterport interior for ${address}`}
          src={showcaseUrl(scan)}
          allow="fullscreen; xr-spatial-tracking"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
        <div
          className={`${styles.glass} absolute bottom-4 left-4 max-w-[calc(100%-2rem)] p-3 text-xs`}
        >
          <details>
            <summary className="cursor-pointer">
              {scan.provenance.scope === "space"
                ? "Interior details"
                : "Building scan · suite unverified"}
            </summary>
            <p className="mt-2">{scan.provenance.description}</p>
          </details>
        </div>
      </>
    );
  return (
    <div className={styles.empty}>
      <h2>Interior unavailable</h2>
      {response?.kind === "floorplan" && (
        <a
          href={response.floorPlanUri}
          target="_blank"
          rel="noreferrer"
          className={styles.secondary}
        >
          View floor plan
        </a>
      )}
    </div>
  );
}
