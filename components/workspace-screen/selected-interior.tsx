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
        Finding the interior for this space…
      </div>
    );
  if (phase === "failed")
    return (
      <div className={styles.empty}>
        <h2>Interior unavailable</h2>
        <p>We couldn’t load the interior record for this space.</p>
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
          <strong>
            {scan.provenance.scope === "space"
              ? "Matched space interior"
              : "Parent-building interior"}
          </strong>
          <p>{scan.provenance.description}</p>
          {scan.provenance.scope === "property" && (
            <p>Building scan; the selected suite’s layout is not verified.</p>
          )}
        </div>
      </>
    );
  return (
    <div className={styles.empty}>
      <span className={styles.badge}>Selected space</span>
      <h2>No matched scan available</h2>
      <p>
        {response?.provenance.description ??
          "There isn’t a verified Matterport interior for this space yet."}
      </p>
      {response?.kind === "floorplan" && (
        <a
          href={response.floorPlanUri}
          target="_blank"
          rel="noreferrer"
          className={styles.secondary}
        >
          Open listing floor plan
        </a>
      )}
      <p className={styles.muted}>
        You can still compare operating assumptions using the saved location
        data.
      </p>
    </div>
  );
}
