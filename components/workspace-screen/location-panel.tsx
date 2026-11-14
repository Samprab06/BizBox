"use client";

import Image from "next/image";
import Link from "next/link";
import { useId } from "react";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { CityPhoto, SelectedSpace } from "./model";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-ink";

function PinIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="size-5"
    >
      <path d="M10 18s6-6 6-11A6 6 0 0 0 4 7c0 5 6 11 6 11Z" />
      <circle cx="10" cy="7" r="2" />
    </svg>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded border border-viewport-line px-1.5 py-0.5 text-[11px] font-normal text-viewport-muted">
      {children}
    </span>
  );
}

/**
 * The single selected-location panel: a labelled city preview photo (not a map and not the
 * listing's photo) with the selected candidate's summary; details expand in place.
 */
export function LocationPanel({
  projectId,
  photo,
  space,
  expanded,
  onExpandedChange,
}: {
  projectId: string;
  photo: CityPhoto | null;
  space: SelectedSpace;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const detailsId = useId();
  return (
    <section
      aria-label="Selected location"
      className="relative isolate flex min-h-[420px] min-w-0 flex-col justify-end overflow-hidden rounded-3xl border border-viewport-line bg-viewport-surface p-3 text-viewport-ink sm:p-4"
    >
      {photo && (
        <Image
          src={photo.src}
          alt={photo.alt}
          fill
          sizes="(min-width: 1024px) 640px, 100vw"
          className="-z-10 object-cover object-[center_40%] brightness-[.8] saturate-[.8]"
          priority
        />
      )}
      <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
        <span className="rounded-full border border-viewport-line bg-viewport-canvas/90 px-3 py-1.5 text-xs">
          City preview · photo, not a map
        </span>
        {photo && (
          <a
            href="/workspace/credits.html"
            className={`rounded-full bg-viewport-canvas/90 px-3 py-1.5 text-[11px] text-viewport-muted underline underline-offset-2 ${focusRing}`}
          >
            Photo: {photo.credit} · {photo.license}
          </a>
        )}
      </div>

      {space.kind === "space" && (
        <button
          type="button"
          aria-label={`${expanded ? "Hide" : "Show"} details for ${space.name}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => onExpandedChange(!expanded)}
          className={`absolute left-1/2 top-[38%] grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white bg-viewport-ink text-viewport-canvas shadow-lg ${focusRing}`}
        >
          <PinIcon />
        </button>
      )}

      <div className="relative mt-24 rounded-2xl border border-viewport-line bg-viewport-canvas/90 backdrop-blur-md">
        {space.kind === "loading" && (
          <p role="status" className="p-5 text-sm">
            Loading candidate spaces…
          </p>
        )}
        {space.kind === "none" && (
          <div className="p-5 text-sm">
            <h2 className="text-base font-semibold">No space selected</h2>
            <p className="mt-1 text-viewport-muted">{space.message}</p>
            <Link
              href={workspaceHref(projectId, "map")}
              prefetch={false}
              className={`mt-3 inline-block font-semibold underline underline-offset-4 ${focusRing}`}
            >
              Browse candidate spaces
            </Link>
          </div>
        )}
        {space.kind === "space" && (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5">
              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <h2 className="text-base font-semibold tracking-tight [overflow-wrap:anywhere]">
                  {space.name}
                </h2>
                <span className="flex flex-wrap items-center gap-2 text-xs text-viewport-muted">
                  {space.subtitle}
                  {space.example && <Badge>Example</Badge>}
                </span>
              </div>
              <dl className="col-span-2 row-start-2 flex flex-wrap gap-x-6 gap-y-2 tabular-nums sm:col-span-1 sm:row-start-auto">
                {space.stats.map((stat) => (
                  <div key={stat.label}>
                    <dt className="text-[11px] text-viewport-muted">
                      {stat.label}
                    </dt>
                    <dd className="text-base font-medium whitespace-nowrap">
                      {stat.value}
                      {stat.note && (
                        <span className="ml-1 text-[11px] font-normal text-viewport-muted">
                          {stat.note}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => onExpandedChange(!expanded)}
                className={`col-start-2 row-start-1 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-viewport-muted hover:text-viewport-ink sm:col-start-auto ${focusRing}`}
              >
                Details
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                  className={`size-4 ${expanded ? "rotate-180" : ""}`}
                >
                  <path d="m6 8 4 4 4-4" />
                </svg>
              </button>
            </div>
            <div
              id={detailsId}
              hidden={!expanded}
              className="px-4 pb-4 text-sm sm:px-5 sm:pb-5"
            >
              <ul className="space-y-1 text-viewport-muted">
                {space.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                <Link
                  href={workspaceHref(projectId, "site", space.id)}
                  prefetch={false}
                  className={`font-semibold underline underline-offset-4 ${focusRing}`}
                >
                  Open site detail
                </Link>
                <Link
                  href={workspaceHref(projectId, "map", space.id)}
                  prefetch={false}
                  className={`font-semibold underline underline-offset-4 ${focusRing}`}
                >
                  Compare on the map
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
