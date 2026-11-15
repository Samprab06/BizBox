"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { ConsultantPanel } from "@/components/ConsultantPanel";
import { getSiteFixture } from "@/components/site/site-fixtures";
import { SimulatorViewport } from "@/components/simulator/viewport";
import { Card } from "@/components/ui/card";
import { getPreviewProject } from "@/lib/workspace-preview";
import styles from "./platform-screen.module.css";

// This is the same Cesium/Vexcel scene used by the product simulator, not a
// second map implementation or a styled photograph.
const Neighborhood = dynamic(
  () => import("@/components/simulator/neighborhood"),
  { ssr: false },
);

const projectId = "houston-coffee";
const project = getPreviewProject(projectId);
if (!project) throw new Error("The Houston example project is unavailable.");
const candidates = project.sites.map((site) => ({
  ...site,
  fixture: getSiteFixture(site.id),
}));

export function PlatformScreen({
  initialSiteId,
  tilesetUrl,
}: {
  initialSiteId?: string;
  tilesetUrl?: string;
}) {
  const [selectedId, setSelectedId] = useState(
    () =>
      candidates.find((site) => site.id === initialSiteId)?.id ??
      candidates[0].id,
  );
  const selected =
    candidates.find((site) => site.id === selectedId) ?? candidates[0];
  const coordinates = selected.fixture;

  return (
    <main className={styles.workspace} aria-label="BizBox location workspace">
      <header className={styles.header}>
        <div className={styles.identity}>
          <Link className={styles.brand} href="/projects/houston-coffee/map">
            BizBox
          </Link>
          <span className={styles.divider} aria-hidden="true" />
          <div>
            <h1>Houston coffee shop</h1>
            <p>Houston, TX</p>
          </div>
        </div>
        <span className={styles.example}>Example locations</span>
      </header>

      <div className={styles.body}>
        <div className={styles.mapColumn}>
          <div
            className={styles.candidates}
            role="group"
            aria-label="Candidate locations"
          >
            {candidates.map((site) => (
              <button
                key={site.id}
                type="button"
                aria-pressed={selected.id === site.id}
                onClick={() => setSelectedId(site.id)}
                className={styles.candidate}
              >
                <span>{site.address}</span>
                <span>{site.squareFeet.toLocaleString("en-US")} sq ft</span>
              </button>
            ))}
          </div>

          <SimulatorViewport
            label="3D candidate neighborhood"
            className={styles.viewport}
          >
            {tilesetUrl && coordinates ? (
              <Neighborhood
                key={selected.id}
                longitude={coordinates.longitude}
                latitude={coordinates.latitude}
                tilesetUrl={tilesetUrl}
                minute={720}
                quality="balanced"
                locationLabel={`${selected.address} · Example location`}
              >
                <span className={styles.srOnly}>
                  Selected example: {selected.address}, {selected.neighborhood}.
                </span>
              </Neighborhood>
            ) : (
              <div className={styles.unavailable} role="status">
                <strong>3D neighborhood unavailable</strong>
                <span>
                  {coordinates
                    ? "3D imagery is not configured for this preview."
                    : "Coordinates are unavailable for this example."}
                </span>
              </div>
            )}
          </SimulatorViewport>
        </div>

        <aside
          className={styles.sidebar}
          aria-label="Selected property and consultant"
        >
          <Card className={styles.property} surface="paper">
            <p className={styles.example}>Example property</p>
            <h2>{selected.address}</h2>
            <p className={styles.neighborhood}>
              {selected.neighborhood} · Houston
            </p>
            <dl className={styles.facts}>
              <div>
                <dt>Floor area</dt>
                <dd>{selected.squareFeet.toLocaleString("en-US")} sq ft</dd>
              </div>
              <div>
                <dt>Position</dt>
                <dd>{coordinates?.position ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Monthly asking rent</dt>
                <dd>Not provided</dd>
              </div>
            </dl>
            <Link
              className={styles.details}
              href={`/projects/${projectId}/sites/${selected.id}`}
            >
              View property details <span aria-hidden="true">↗</span>
            </Link>
          </Card>
          <div className={styles.consultant}>
            <ConsultantPanel key={selected.id} projectId={projectId} />
          </div>
        </aside>
      </div>
    </main>
  );
}
