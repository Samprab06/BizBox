"use client";
import { memo, useMemo } from "react";
import Image from "next/image";
import type { LocationStoryData } from "./location-data";
import { Glass, dollars, number } from "../landing-demo/demo-ui";
import styles from "./landing-story.module.css";
import mediaStyles from "./prepared-video.module.css";
import { projectMediaAnchors, preparedCardLayout } from "./media-projection";
import { PREPARED_MEDIA } from "./prepared-media-data";
import { PreparedVideo, type PreparedPlaybackState } from "./prepared-video";

export const StoryMap = memo(function StoryMap({
  data,
  minute,
  expanded,
  selected,
  onSelect,
  viewport,
  morning,
  running = false,
  visible = true,
  reduced = false,
  replayRevision = 0,
  onProgress,
  onPlaybackState,
  onPlayRequest,
}: {
  data: LocationStoryData;
  minute: number;
  expanded: boolean;
  selected: string;
  onSelect: (id: string) => void;
  viewport: { width: number; height: number };
  morning: boolean;
  running?: boolean;
  visible?: boolean;
  reduced?: boolean;
  replayRevision?: number;
  onProgress?: (seconds: number) => void;
  onPlaybackState?: (state: PreparedPlaybackState) => void;
  onPlayRequest?: () => void;
}) {
  const portrait = viewport.width <= 700 && viewport.height > viewport.width;
  const media = portrait ? PREPARED_MEDIA.mapPortrait : PREPARED_MEDIA.map;
  const points = useMemo(
    () => projectMediaAnchors(media.anchors, media, viewport, "contain"),
    [media, viewport],
  );
  const { offsets } = useMemo(
    () => preparedCardLayout(points, viewport),
    [points, viewport],
  );
  const min = Math.max(480, Math.min(720, minute));
  return (
    <div
      className={`${styles.map} ${mediaStyles.mapStage}`}
      data-map-framing={portrait ? "portrait" : "landscape"}
      data-map-source="prepared-vexcel"
      data-prepared-map
    >
      {morning ? (
        <PreparedVideo
          media={media}
          label="Recorded neighborhood morning"
          fit="contain"
          running={running}
          visible={visible}
          reduced={reduced}
          replayRevision={replayRevision}
          onProgress={onProgress}
          onPlaybackState={onPlaybackState}
          onPlayRequest={onPlayRequest}
        />
      ) : (
        <Image
          src={media.discoveryPoster}
          className={`${mediaStyles.poster} ${mediaStyles.containedPoster}`}
          alt="Houston map showing the two example neighborhoods"
          width={media.width}
          height={media.height}
          unoptimized
          loading="lazy"
          data-discovery-map
        />
      )}
      <div className={styles.mapCards}>
        {!morning && (
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
        )}
        {data.sites.map((site) => {
          const point = points.find((p) => p.id === site.id);
          if (!point) return null;
          return (
            <button
              className={mediaStyles.pin}
              key={site.id}
              data-site-pin={site.id}
              type="button"
              style={{ left: point.x, top: point.y }}
              aria-label={`Select ${site.name}`}
              aria-pressed={selected === site.id}
              onClick={() => onSelect(site.id)}
            />
          );
        })}
        {!morning &&
          data.sites.map((site) => {
            const point = points.find((p) => p.id === site.id);
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
                    left: offsets.get(site.id)?.x ?? 0,
                    top: offsets.get(site.id)?.y ?? -70,
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
      {morning && (
        <div className={mediaStyles.stats} data-recorded-stats>
          {data.sites.map((site) => {
            const checkpoint =
              [...site.checkpoints].reverse().find((p) => p.minute <= min) ??
              site.checkpoints[0];
            return (
              <Glass
                className={mediaStyles.stat}
                key={site.id}
                data-checkpoint-site={site.id}
              >
                <strong>{site.name}</strong>
                <span>
                  {checkpoint.served} served · {checkpoint.arrivals} arrivals
                </span>
              </Glass>
            );
          })}
        </div>
      )}
      <p className={mediaStyles.credit}>
        Recorded demo{morning ? " · illustrative movement" : ""} · © Vexcel
        Imaging · © Microsoft · © OpenStreetMap via OpenFreeMap · Cesium
      </p>
    </div>
  );
});
