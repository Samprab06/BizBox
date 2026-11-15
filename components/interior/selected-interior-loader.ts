import {
  InteriorResponseSchema,
  type InteriorResponse,
} from "@/lib/contracts/interior";
export type InteriorRequestScope = {
  projectId: string;
  siteId: string;
  comparisonId: string;
  draftId: string;
  revision: number;
};
export async function loadSelectedInterior(
  siteId: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<InteriorResponse> {
  const response = await request(
    `/api/sites/${encodeURIComponent(siteId)}/interior`,
    { signal, cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "No interior mapping exists for this selected space."
        : "Selected-space interior service is unavailable.",
    );
  const parsed = InteriorResponseSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new Error("Selected-space interior returned an invalid source.");
  return parsed.data;
}
