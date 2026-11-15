/** Local, read-only selected-address inventory. Never imported by application runtime. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { readJsonLines } from "./load-costar";
import {
  normalizeAttachments,
  normalizeSpaces,
  type EnumLookup,
} from "../lib/data/costar";
import {
  createOEmbedChecker,
  type PublicCheckResult,
} from "./matterport-public-scans";
import { isMain } from "./env-policy";
export const normalizeCandidateAddress = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
export type CandidateScanInventory = {
  address: string;
  city: string;
  propertyId: string;
  propertyModelIds: string[];
  spaces: {
    siteId: string;
    active: boolean;
    sizeSqFt: number | null;
    exactSpaceModelIds: string[];
  }[];
};
export function matchCandidateAddresses(
  rows: Record<string, string>[],
  addresses: string[],
) {
  const requested = new Set(addresses.map(normalizeCandidateAddress));
  const matches = new Map<string, CandidateScanInventory>();
  for (const row of rows) {
    if (!requested.has(normalizeCandidateAddress(row.Address ?? ""))) continue;
    if (!/^\d+$/.test(row.PropertyId ?? ""))
      throw new Error("Invalid property identity");
    let entry = matches.get(row.PropertyId!);
    if (!entry) {
      entry = {
        address: row.Address!,
        city: row.City!,
        propertyId: row.PropertyId!,
        propertyModelIds: [],
        spaces: [],
      };
      matches.set(row.PropertyId!, entry);
    }
    const model = row.MatterportModelId;
    if (
      model &&
      /^[A-Za-z0-9]{11}$/.test(model) &&
      !entry.propertyModelIds.includes(model)
    )
      entry.propertyModelIds.push(model);
  }
  for (const address of requested) {
    const count = [...matches.values()].filter(
      (row) => normalizeCandidateAddress(row.address) === address,
    ).length;
    if (count !== 1)
      throw new Error(
        count
          ? "Address matches multiple properties; use canonical selected site ID"
          : "Address has no exact source match",
      );
  }
  return [...matches.values()];
}
export async function inspectCandidateInteriors(
  kitPath: string,
  addresses: string[],
) {
  if (!addresses.length || addresses.length > 5)
    throw new Error("Supply one to five exact selected addresses");
  const csv = parse(
    await readFile(resolve(kitPath, "commercial-properties.csv"), "utf8"),
    { columns: true, skip_empty_lines: true },
  ) as Record<string, string>[];
  const candidates = matchCandidateAddresses(csv, addresses),
    byId = new Map(candidates.map((c) => [c.propertyId, c]));
  const enums = JSON.parse(
    await readFile(resolve(kitPath, "schemas/enums.json"), "utf8"),
  ) as EnumLookup;
  for await (const listing of readJsonLines(
    resolve(kitPath, "data/commercial-listing-summary.jsonl"),
  )) {
    const spaces = normalizeSpaces(listing, enums);
    if (!spaces.some((s) => byId.has(s.propertyId))) continue;
    const attachments = normalizeAttachments(
      listing,
      "commercial-listing-summary",
      enums,
    );
    spaces.forEach((space, index) => {
      const owner = byId.get(space.propertyId);
      if (!owner) return;
      const prefix = `forLeaseSummary.spaces[${index}].`;
      const exactSpaceModelIds = [
        ...new Set(
          attachments
            .filter(
              (a) =>
                a.propertyId === space.propertyId &&
                a.source.field.startsWith(prefix) &&
                typeof a.data.matterportModelId === "string",
            )
            .map((a) => a.data.matterportModelId as string),
        ),
      ];
      owner.spaces.push({
        siteId: space.id,
        active: space.active,
        sizeSqFt: space.sizeSqFt,
        exactSpaceModelIds,
      });
    });
  }
  return candidates;
}
export async function checkCandidatePublicModels(
  candidates: CandidateScanInventory[],
  check = createOEmbedChecker(),
  maxPerProperty = 2,
) {
  if (
    !Number.isInteger(maxPerProperty) ||
    maxPerProperty < 1 ||
    maxPerProperty > 3
  )
    throw new Error("Check at most three models per property");
  const checked: {
    propertyId: string;
    modelId: string;
    result: PublicCheckResult;
  }[] = [];
  for (const candidate of candidates) {
    const models = [
      ...new Set([
        ...candidate.spaces.flatMap((s) => s.exactSpaceModelIds),
        ...candidate.propertyModelIds,
      ]),
    ].slice(0, maxPerProperty);
    for (const modelId of models) {
      if (checked.length) await new Promise((r) => setTimeout(r, 500));
      checked.push({
        propertyId: candidate.propertyId,
        modelId,
        result: await check(modelId),
      });
    }
  }
  return checked;
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2),
    kit = args[0],
    addresses = args.filter((_, i) => args[i - 1] === "--address");
  if (!kit)
    throw new Error(
      "Supply kit directory and --address exact selected address",
    );
  const candidates = await inspectCandidateInteriors(kit, addresses);
  const publicChecks = args.includes("--check-public")
    ? await checkCandidatePublicModels(candidates)
    : [];
  console.log(
    JSON.stringify(
      {
        mode: "read-only-selected-interior-diagnostics",
        candidates,
        publicChecks,
        limitations: [
          "No registry rows or approvals written.",
          "Property mapping is not exact-suite geometry.",
          "Public metadata availability is not verified SDK rendering or Defurnish support.",
        ],
      },
      null,
      2,
    ),
  );
}
