import { MatterportModelIdSchema } from "@/lib/contracts/interior";
export type InteriorPublicStatus = "public" | "private" | "unknown";
export type InteriorPublicMetadata = {
  status: InteriorPublicStatus;
  title?: string;
  excludedBusinessTour?: boolean;
};
export type InteriorPublicChecker = ((
  id: string,
) => Promise<InteriorPublicStatus>) & {
  inspect?: (id: string) => Promise<InteriorPublicMetadata>;
};
/** Clear dwelling units and communal residential amenities are not selected business interiors. */
export function excludedBusinessTourTitle(title: string) {
  return /\b(?:\d+\s*(?:br|ba|bed(?:room)?s?|bath(?:room)?s?)|apartments?|residential|screening room|clubhouse)\b/i.test(
    title,
  );
}
/** Parent-property amenity tours cannot identify the selected commercial suite. */
export function propertyAmenityTourTitle(title: string) {
  return /\b(?:pool|roof\s*deck|rooftop|lobby|courtyard|leasing\s*office|screening\s*room|clubhouse)\b/i.test(
    title,
  );
}
/** Fixed issuer endpoint, no redirects/retries. Bounded process-local cache and in-flight coalescing. */
export function createInteriorPublicChecker(
  fetcher: typeof fetch = fetch,
  now = Date.now,
): InteriorPublicChecker {
  const cache = new Map<
      string,
      { until: number; value: InteriorPublicMetadata }
    >(),
    pending = new Map<string, Promise<InteriorPublicMetadata>>();
  const inspect = async (id: string): Promise<InteriorPublicMetadata> => {
    if (!MatterportModelIdSchema.safeParse(id).success)
      return { status: "unknown" };
    const saved = cache.get(id);
    if (saved && saved.until > now()) return saved.value;
    const active = pending.get(id);
    if (active) return active;
    const task = (async (): Promise<InteriorPublicMetadata> => {
      let value: InteriorPublicMetadata = { status: "unknown" };
      try {
        const show = `https://my.matterport.com/show/?m=${id}`,
          response = await fetcher(
            `https://my.matterport.com/api/v1/models/oembed/?url=${encodeURIComponent(show)}`,
            {
              redirect: "error",
              cache: "no-store",
              signal: AbortSignal.timeout(1800),
              headers: { accept: "application/json" },
            },
          );
        if ([401, 403, 404, 410].includes(response.status)) {
          await response.body?.cancel();
          value = { status: "private" };
        } else if (response.status === 200 && response.body) {
          const reader = response.body.getReader();
          let size = 0;
          const chunks: Uint8Array[] = [];
          try {
            for (;;) {
              const { done, value: chunk } = await reader.read();
              if (done) break;
              size += chunk.byteLength;
              if (size > 65536) {
                await reader.cancel();
                throw Error("Oversized public metadata");
              }
              chunks.push(chunk);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const data = JSON.parse(new TextDecoder().decode(bytes));
          if (
            data &&
            typeof data.title === "string" &&
            typeof data.html === "string"
          )
            value = {
              status: "public",
              title: data.title.slice(0, 500),
              excludedBusinessTour: excludedBusinessTourTitle(data.title),
            };
        } else await response.body?.cancel();
      } catch {
        /* Unknown never grants viewing. */
      }
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(id, {
        value,
        until: now() + (value.status === "unknown" ? 30000 : 300000),
      });
      return value;
    })();
    pending.set(id, task);
    try {
      return await task;
    } finally {
      pending.delete(id);
    }
  };
  return Object.assign(async (id: string) => (await inspect(id)).status, {
    inspect,
  });
}
export const checkInteriorPublic = createInteriorPublicChecker();
