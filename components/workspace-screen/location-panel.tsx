"use client";

import Image from "next/image";
import Link from "next/link";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Pill } from "@/components/ui/pill";
import { Glass } from "@/components/ui/glass";
import { focusRing } from "@/components/ui/cn";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { CityPhoto, SelectedSpace } from "./model";

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
  return <Pill className="text-[11px] font-normal">{children}</Pill>;
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
      className="relative isolate flex min-h-[420px] min-w-0 flex-col justify-end overflow-hidden rounded-panel border border-line bg-panel-raised p-3 text-ink sm:p-4"
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
        <Glass
          backing="backed"
          radius="control"
          className="px-3 py-1.5 text-xs"
        >
          City preview · photo, not a map
        </Glass>
        {photo && (
          <a
            href="/workspace/credits.html"
            className={`rounded-control border border-glass-edge bg-glass-fallback px-3 py-1.5 text-[11px] text-muted underline underline-offset-2 ${focusRing}`}
          >
            Photo: {photo.credit} · {photo.license}
          </a>
        )}
      </div>

      {space.kind === "space" && (
        <IconButton
          type="button"
          variant="primary"
          size="lg"
          aria-label={`${expanded ? "Hide" : "Show"} details for ${space.name}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => onExpandedChange(!expanded)}
          className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2"
        >
          <PinIcon />
        </IconButton>
      )}

      <Glass backing="backed" className="relative mt-24">
        {space.kind === "loading" && (
          <p role="status" className="p-5 text-sm">
            Loading candidate spaces…
          </p>
        )}
        {space.kind === "none" && (
          <div className="p-5 text-sm">
            <h2 className="text-base font-semibold">No space selected</h2>
            <p className="mt-1 text-muted">{space.message}</p>
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
              <div className="col-start-1 row-start-1 flex min-w-0 flex-col items-start gap-1.5">
                <h2 className="text-base font-semibold tracking-tight [overflow-wrap:anywhere]">
                  {space.name}
                </h2>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {space.subtitle}
                  {space.example && <Badge>Example</Badge>}
                </span>
              </div>
              <dl className="col-span-2 row-start-2 flex flex-wrap gap-x-6 gap-y-2 tabular-nums sm:col-span-1 sm:col-start-2 sm:row-start-1">
                {space.stats.map((stat) => (
                  <div key={stat.label}>
                    <dt className="text-[11px] text-muted">{stat.label}</dt>
                    <dd className="text-base font-medium whitespace-nowrap">
                      {stat.value}
                      {stat.note && (
                        <span className="ml-1 text-[11px] font-normal text-muted">
                          {stat.note}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => onExpandedChange(!expanded)}
                className="col-start-2 row-start-1 gap-1 text-xs sm:col-start-3"
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
              </Button>
            </div>
            <div
              id={detailsId}
              hidden={!expanded}
              className="px-4 pb-4 text-sm sm:px-5 sm:pb-5"
            >
              <ul className="space-y-1 text-muted">
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
      </Glass>
    </section>
  );
}
