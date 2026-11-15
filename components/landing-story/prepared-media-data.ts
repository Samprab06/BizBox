import manifest from "@/public/landing-assets/prepared/manifest.json";
export type PreparedMedia = {
  width: number;
  height: number;
  duration: number;
  poster: string;
  mp4: string;
  webm: string;
  counterCount?: 1 | 2;
};
export type PreparedMediaManifest = {
  map: PreparedMedia & {
    anchors: readonly {
      siteId: "montrose" | "heights";
      u: number;
      v: number;
    }[];
  };
  counters: {
    current: PreparedMedia & { counterCount: 1 };
    proposed: PreparedMedia & { counterCount: 2 };
  };
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object")
    throw new Error("Prepared media metadata is missing.");
  return value as Record<string, unknown>;
}
function asset(value: unknown): PreparedMedia {
  const data = object(value);
  for (const key of ["width", "height", "duration"] as const)
    if (
      typeof data[key] !== "number" ||
      !Number.isFinite(data[key]) ||
      (data[key] as number) <= 0
    )
      throw new Error(`Invalid prepared media ${key}.`);
  for (const [key, extension] of [
    ["poster", "webp"],
    ["mp4", "mp4"],
    ["webm", "webm"],
  ] as const)
    if (
      typeof data[key] !== "string" ||
      !data[key].startsWith("/landing-assets/prepared/") ||
      !data[key].endsWith(`.${extension}`)
    )
      throw new Error(`Invalid prepared media ${key} path.`);
  return {
    width: data.width as number,
    height: data.height as number,
    duration: data.duration as number,
    poster: data.poster as string,
    mp4: data.mp4 as string,
    webm: data.webm as string,
  };
}
export function parsePreparedMedia(value: unknown): PreparedMediaManifest {
  const data = object(value),
    map = object(data.map),
    counters = object(data.counters);
  if (!Array.isArray(map.anchors) || map.anchors.length !== 2)
    throw new Error("Prepared map anchors are missing.");
  const anchors = map.anchors.map((value) => {
    const a = object(value);
    if (
      (a.siteId !== "montrose" && a.siteId !== "heights") ||
      typeof a.u !== "number" ||
      typeof a.v !== "number" ||
      ![a.u, a.v].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      throw new Error("Invalid prepared map anchor.");
    return {
      siteId: a.siteId,
      u: a.u,
      v: a.v,
    } as PreparedMediaManifest["map"]["anchors"][number];
  });
  if (new Set(anchors.map((a) => a.siteId)).size !== 2)
    throw new Error("Duplicate prepared map anchors.");
  const current = object(counters.current),
    proposed = object(counters.proposed);
  if (current.counterCount !== 1 || proposed.counterCount !== 2)
    throw new Error("Prepared counter recordings do not match their setups.");
  return {
    map: { ...asset(map), anchors },
    counters: {
      current: { ...asset(current), counterCount: 1 },
      proposed: { ...asset(proposed), counterCount: 2 },
    },
  };
}
export const PREPARED_MEDIA = parsePreparedMedia(manifest);
