"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GlassControl } from "@/components/ui/glass-control";

/** Native fullscreen keeps Escape and browser focus restoration available. */
export function SimulatorViewport({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const changed = () => {
      const active = document.fullscreenElement === viewport.current;
      setExpanded(active);
      if (!active && wasExpanded.current)
        expand.current?.focus({ preventScroll: true });
      wasExpanded.current = active;
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggle() {
    setError("");
    try {
      if (document.fullscreenElement === viewport.current)
        await document.exitFullscreen();
      else if (viewport.current?.requestFullscreen)
        await viewport.current.requestFullscreen();
      else setError("Fullscreen is unavailable in this browser.");
    } catch {
      setError("Fullscreen is unavailable. You can continue in this view.");
    }
  }
  return (
    <div
      ref={viewport}
      role="region"
      aria-label={label}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          document.fullscreenElement === viewport.current
        ) {
          void document.exitFullscreen().catch(() => {});
        }
      }}
      className={`sw-viewport relative w-full overflow-hidden rounded-card border border-viewport-line text-viewport-ink ${expanded ? "!h-dvh !max-h-none !rounded-none" : className}`}
      data-surface="viewport"
    >
      {children}
      <GlassControl
        over="viewport"
        aria-label={`${label} view controls`}
        className="absolute top-3 right-3 z-30 !p-1"
      >
        <button
          ref={expand}
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          aria-pressed={expanded}
          onClick={() => void toggle()}
          className="min-h-10 rounded px-3 text-sm"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </GlassControl>
      {error && (
        <p
          role="status"
          className="absolute inset-x-3 top-16 z-30 rounded bg-viewport-surface p-2 text-xs"
        >
          {error}
        </p>
      )}
    </div>
  );
}
