"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { preparedPlayback } from "./media-projection";
import type { PreparedMedia } from "./prepared-media-data";
import styles from "./prepared-video.module.css";

export type PreparedPlaybackState =
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "static"
  | "suspended"
  | "poster";
type Props = {
  media: PreparedMedia;
  label: string;
  running: boolean;
  visible: boolean;
  reduced: boolean;
  active?: boolean;
  loop?: boolean;
  fit?: "cover" | "contain";
  replayRevision?: number;
  onProgress?: (seconds: number) => void;
  onPlaybackState?: (state: PreparedPlaybackState) => void;
  onPlayRequest?: () => void;
};
type Connection = EventTarget & { saveData?: boolean };

export function PreparedVideo({
  media,
  label,
  running,
  visible,
  reduced,
  active = true,
  loop = false,
  fit = "cover",
  replayRevision = 0,
  onProgress,
  onPlaybackState,
  onPlayRequest,
}: Props) {
  const video = useRef<HTMLVideoElement>(null),
    position = useRef(0);
  const finished = useRef(false);
  const callbacks = useRef({ onProgress, onPlaybackState });
  const [policy, setPolicy] = useState<{
    reduced: boolean;
    saveData: boolean;
  } | null>(null);
  const [manual, setManual] = useState(false);
  const [status, setStatus] = useState<PreparedPlaybackState>("loading");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    callbacks.current = { onProgress, onPlaybackState };
  }, [onProgress, onPlaybackState]);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: Connection })
      .connection;
    const update = () =>
      setPolicy({
        reduced: motion.matches,
        saveData: connection?.saveData === true,
      });
    update();
    motion.addEventListener("change", update);
    connection?.addEventListener("change", update);
    return () => {
      motion.removeEventListener("change", update);
      connection?.removeEventListener("change", update);
    };
  }, []);
  const mode = policy
    ? preparedPlayback({
        active,
        visible,
        reduced: reduced || policy.reduced,
        saveData: policy.saveData,
        manual,
      })
    : "dormant";
  const mounted = mode === "video" && !blocked;
  const state: PreparedPlaybackState = !active
    ? "poster"
    : !visible
      ? "suspended"
      : !policy
        ? "loading"
        : mode === "poster" || blocked
          ? "static"
          : status;
  useEffect(() => {
    callbacks.current.onPlaybackState?.(state);
  }, [state, replayRevision]);
  useEffect(() => {
    if (!active) {
      position.current = 0;
      finished.current = false;
    }
  }, [active]);
  useEffect(() => {
    const element = video.current;
    if (!mounted || !element) return;
    return () => {
      position.current = element.currentTime || position.current;
      element.pause();
      element.removeAttribute("src");
      element
        .querySelectorAll("source")
        .forEach((source) => source.removeAttribute("src"));
      element.load();
    };
  }, [mounted, media.mp4, media.webm]);
  useEffect(() => {
    position.current = 0;
    finished.current = false;
    const element = video.current;
    if (element && element.readyState > 0) {
      element.currentTime = 0;
      callbacks.current.onProgress?.(0);
    }
  }, [replayRevision]);
  useEffect(() => {
    const element = video.current;
    if (!mounted || !element) return;
    if (!running || (!loop && finished.current)) {
      element.pause();
      return;
    }
    let closed = false;
    void element.play().catch(() => {
      if (!closed) setBlocked(true);
    });
    return () => {
      closed = true;
      element.pause();
    };
  }, [mounted, running, replayRevision, loop, media.mp4, media.webm]);
  return (
    <div
      className={`${styles.media} ${fit === "contain" ? styles.contain : ""}`}
      data-prepared-media={label}
      data-media-layout={fit}
      data-media-state={state}
      data-counter-count={media.counterCount}
    >
      <Image
        className={styles.poster}
        src={media.poster}
        alt={label}
        width={media.width}
        height={media.height}
        unoptimized
        loading="lazy"
      />
      {mounted && (
        <video
          key={media.mp4}
          ref={video}
          className={styles.video}
          aria-label={label}
          muted
          playsInline
          loop={loop}
          preload="none"
          poster={media.poster}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            if (position.current > 0)
              element.currentTime =
                finished.current && !loop
                  ? element.duration
                  : Math.min(
                      position.current,
                      Math.max(0, element.duration - 0.05),
                    );
            callbacks.current.onProgress?.(
              finished.current && !loop ? media.duration : element.currentTime,
            );
          }}
          onCanPlay={() =>
            setStatus(finished.current && !loop ? "ended" : "ready")
          }
          onPlaying={() => setStatus("playing")}
          onPause={() => setStatus((old) => (old === "ended" ? old : "paused"))}
          onTimeUpdate={(event) => {
            position.current = event.currentTarget.currentTime;
            callbacks.current.onProgress?.(
              finished.current && !loop ? media.duration : position.current,
            );
          }}
          onEnded={() => {
            finished.current = true;
            setStatus("ended");
            callbacks.current.onProgress?.(media.duration);
          }}
          onError={() => setBlocked(true)}
        >
          <source src={media.mp4} type="video/mp4" />
          <source src={media.webm} type="video/webm" />
        </video>
      )}
      {active && visible && state === "static" && (
        <button
          type="button"
          className={styles.play}
          aria-label={`Play ${label}`}
          data-play-recording
          onClick={() => {
            position.current = 0;
            finished.current = false;
            setBlocked(false);
            setStatus("loading");
            setManual(true);
            onPlayRequest?.();
          }}
        >
          Play recording <span aria-hidden="true">▶</span>
        </button>
      )}
    </div>
  );
}
