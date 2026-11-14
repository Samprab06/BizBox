/**
 * HAC-72 (SIM-1): read-only, aggregate-only coverage report of what the loaded
 * CoStar kit can feed a 3D scene (building size fields and attachment kinds).
 *
 *   DATABASE_URL=postgres://... pnpm exec tsx scripts/costar-3d-report.ts
 *
 * Only SELECTs run, inside a read-only session. Output is counts and
 * percentages: no record IDs, addresses, URLs or hostnames are ever printed.
 * The numbers in docs/costar-3d-fields.md come from this script.
 */
import { config } from "dotenv";
import postgres from "postgres";

type Row = Record<string, string | number | null>;

/** Cities as the site search sees them: trimmed and case-insensitive. */
const CITIES = ["Houston", "Los Angeles"] as const;
const GROUPS = ["retail", "non-retail", "all"] as const;

/**
 * Retail property = at least one active-for-lease space whose spaceUse is
 * Retail or OfficeRetail. That is the filter pair ("activeForLease",
 * "retailUse") in lib/data/sites.ts, lifted from spaces to their property.
 */
const BASE = `
  base AS (
    SELECT p.id,
           p.data,
           CASE lower(trim(p.city))
             WHEN 'houston' THEN 'Houston'
             WHEN 'los angeles' THEN 'Los Angeles'
           END AS city,
           EXISTS (
             SELECT 1 FROM costar_spaces s
             WHERE s.property_id = p.id AND s.active AND s.retail
           ) AS sr
    FROM costar_properties p
  ),
  grouped AS (
    SELECT b.*, v.grp
    FROM base b
    CROSS JOIN LATERAL (VALUES ('retail', b.sr), ('non-retail', NOT b.sr), ('all', true)) v(grp, ok)
    WHERE v.ok AND b.city IS NOT NULL
  )`;

/** Positive JSON number at a top-level key. */
const pos = (key: string) =>
  `coalesce(jsonb_typeof(data->'${key}') = 'number' AND (data->>'${key}')::numeric > 0, false)`;

const FIELDS: [label: string, predicate: string][] = [
  ["Stories above grade (`numStoriesAboveGrade`)", pos("numStoriesAboveGrade")],
  [
    "Floor list (`floors[]`, non-empty)",
    `(jsonb_typeof(data->'floors') = 'array' AND jsonb_array_length(data->'floors') > 0)`,
  ],
  [
    "Stories by either source",
    `(${pos("numStoriesAboveGrade")} OR (jsonb_typeof(data->'floors') = 'array' AND jsonb_array_length(data->'floors') > 0))`,
  ],
  ["Building height (`buildingHeightInFeet`)", pos("buildingHeightInFeet")],
  [
    "RBA (`rentableBuildingAreaSquareFeet`)",
    pos("rentableBuildingAreaSquareFeet"),
  ],
  ["GBA (`grossBuildingAreaSquareFeet`)", pos("grossBuildingAreaSquareFeet")],
  [
    "Building SF by either (RBA or GBA)",
    `(${pos("rentableBuildingAreaSquareFeet")} OR ${pos("grossBuildingAreaSquareFeet")})`,
  ],
  [
    "Typical floor SF (`grossTypicalFloorSquareFeet`)",
    pos("grossTypicalFloorSquareFeet"),
  ],
  ["Land area (`lotSize`, unit in `lotSizeMeasurementType`)", pos("lotSize")],
  [
    "Year built (`constructionEvents[]`, `eventType` 2)",
    `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'constructionEvents') = 'array' THEN data->'constructionEvents' ELSE '[]'::jsonb END) e
            WHERE (e->>'eventType') = '2' AND jsonb_typeof(e->'year') = 'number' AND (e->>'year')::int > 0)`,
  ],
  [
    "Stories or height (extrudable)",
    `(${pos("numStoriesAboveGrade")} OR ${pos("buildingHeightInFeet")})`,
  ],
  [
    "Stories but no height (needs a floor-height assumption)",
    `(${pos("numStoriesAboveGrade")} AND NOT ${pos("buildingHeightInFeet")})`,
  ],
  [
    "Neither stories nor height",
    `(NOT ${pos("numStoriesAboveGrade")} AND NOT ${pos("buildingHeightInFeet")})`,
  ],
];

/** Attachment type codes from the kit's AttachmentType enum. */
const KIND_CASE = `
  CASE
    WHEN a.t IN (43, 5) OR a.mp THEN 'tour3d'
    WHEN a.t = 3 OR a.field IN ('primaryPhoto', 'forLeaseSummary.properties[].primaryPhoto') THEN 'primary'
    WHEN a.t IN (10, 12) OR a.field = 'forLeaseSummary.spaces[].floorPlan' THEN 'floorplan'
    WHEN a.t = 11 THEN 'siteplan'
    WHEN a.t IN (1, 4, 6, 19, 32, 33, 38, 41, 42, 59, 62, 64, 66, 75, 97, 134) THEN 'gallery'
    ELSE 'other'
  END`;

const KINDS: [key: string, label: string][] = [
  ["primary", "Primary photo"],
  ["gallery", "Gallery photo (building, interior, aerial, lobby, ...)"],
  ["floorplan", "Floor plan (incl. typical floor plan)"],
  ["siteplan", "Site plan"],
  [
    "tour3d",
    "3D tour / Matterport-like (type 43, type 5, or a Matterport model ID)",
  ],
  ["other", "Other (logos, maps, brochures, documents, ...)"],
];

const ATT = `
  att AS (
    SELECT g.id AS pid,
           (a.data->>'attachmentType')::int AS t,
           regexp_replace(a.source->>'field', '\\[[0-9]+\\]', '[]', 'g') AS field,
           coalesce(a.data->>'matterportModelId', '') <> '' AS mp,
           coalesce(a.data->>'uri', a.data->>'attachmentUri', '') <> '' AS has_uri,
           a.data->>'attachmentMasterId' AS master_id,
           a.data->>'matterportModelId' AS model_id
    FROM costar_attachments a
    JOIN base g ON g.id = a.property_id
  ),
  classified AS (
    SELECT a.*, ${KIND_CASE} AS kind FROM att a
  ),
  agrouped AS (
    SELECT c.*, b.city, v.grp
    FROM classified c
    JOIN base b ON b.id = c.pid
    CROSS JOIN LATERAL (VALUES ('retail', b.sr), ('non-retail', NOT b.sr), ('all', true)) v(grp, ok)
    WHERE v.ok AND b.city IS NOT NULL
  )`;

const pct = (n: number, d: number) =>
  d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
const cell = (n: number, d: number) =>
  `${n.toLocaleString("en-US")} (${pct(n, d)})`;
const num = (v: string | number | null | undefined) => Number(v ?? 0);

function table(header: string[], rows: string[][]) {
  console.log(`| ${header.join(" | ")} |`);
  console.log(
    `| ${header.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`,
  );
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
  console.log();
}

async function main() {
  config({ path: [".env.local", ".env"], quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "Set DATABASE_URL to a database with the CoStar kit loaded",
    );
  // Defence in depth: the session itself refuses writes.
  const db = postgres(url, {
    max: 1,
    connection: { default_transaction_read_only: true },
  });
  try {
    const q = (text: string) => db.unsafe<Row[]>(text);

    const [c] = await q(
      `SELECT (SELECT count(*) FROM costar_properties) AS properties,
              (SELECT count(*) FROM costar_attachments) AS attachments,
              (SELECT count(*) FROM costar_spaces) AS spaces`,
    );
    console.log("# CoStar 3D coverage report (aggregates only)\n");
    console.log(
      `Loaded: ${num(c.properties)} properties, ${num(c.spaces)} lease spaces, ${num(c.attachments)} attachment references.\n`,
    );

    const outside = await q(
      `WITH ${BASE} SELECT
         count(*) FILTER (WHERE a.property_id IS NULL OR NOT EXISTS (SELECT 1 FROM base b WHERE b.id = a.property_id)) AS outside,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM base b WHERE b.id = a.property_id AND b.city IS NULL)) AS other_city
       FROM costar_attachments a`,
    );
    console.log(
      `Attachment references whose building is not in the property dataset (excluded below): ${num(outside[0].outside).toLocaleString("en-US")}. In a city other than Houston or Los Angeles: ${num(outside[0].other_city)}.\n`,
    );

    // Denominators.
    const cols = FIELDS.map(
      ([, p], i) => `count(*) FILTER (WHERE ${p}) AS f${i}`,
    ).join(",\n  ");
    const field = await q(
      `WITH ${BASE} SELECT city, grp, count(*) AS n, ${cols}
       FROM grouped GROUP BY city, grp`,
    );

    console.log(
      "## Property fields (share of properties with a usable value)\n",
    );
    console.log(
      'Retail = at least one active lease space with spaceUse Retail or OfficeRetail (the site-search filter). Non-retail = every other property. "Usable" = a number greater than zero.\n',
    );
    for (const city of CITIES) {
      console.log(`### ${city}\n`);
      const byGrp = Object.fromEntries(
        GROUPS.map((g) => [
          g,
          field.find((r) => r.city === city && r.grp === g),
        ]),
      );
      const header = [
        "Field",
        ...GROUPS.map((g) => `${g} (n=${num(byGrp[g]?.n)})`),
      ];
      table(
        header,
        FIELDS.map(([label], i) => [
          label,
          ...GROUPS.map((g) =>
            cell(num(byGrp[g]?.[`f${i}`]), num(byGrp[g]?.n)),
          ),
        ]),
      );
    }

    // Value sanity: height per story, stories distribution, lot units.
    const ratio = await q(
      `WITH ${BASE} SELECT city, grp, count(*) AS n,
         round((percentile_cont(0.1) WITHIN GROUP (ORDER BY h/s))::numeric, 1) AS p10,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h/s))::numeric, 1) AS p50,
         round((percentile_cont(0.9) WITHIN GROUP (ORDER BY h/s))::numeric, 1) AS p90
       FROM (SELECT city, grp, (data->>'buildingHeightInFeet')::numeric h, (data->>'numStoriesAboveGrade')::numeric s FROM grouped
             WHERE ${pos("numStoriesAboveGrade")} AND ${pos("buildingHeightInFeet")}) t
       GROUP BY city, grp`,
    );
    console.log("## Feet per story where both height and stories exist\n");
    table(
      ["City", "Group", "Properties with both", "p10", "median", "p90"],
      CITIES.flatMap((city) =>
        GROUPS.map((g) => {
          const r = ratio.find((x) => x.city === city && x.grp === g);
          return [
            city,
            g,
            String(num(r?.n)),
            String(r?.p10 ?? "n/a"),
            String(r?.p50 ?? "n/a"),
            String(r?.p90 ?? "n/a"),
          ];
        }),
      ),
    );

    const bucket = await q(
      `WITH ${BASE} SELECT
         CASE WHEN s = 1 THEN '1' WHEN s = 2 THEN '2' WHEN s <= 5 THEN '3-5' WHEN s <= 15 THEN '6-15' ELSE '16+' END AS b,
         count(*) AS n,
         round((percentile_cont(0.1) WITHIN GROUP (ORDER BY h/s))::numeric, 1) AS p10,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h/s))::numeric, 1) AS p50,
         round((percentile_cont(0.9) WITHIN GROUP (ORDER BY h/s))::numeric, 1) AS p90
       FROM (SELECT (data->>'buildingHeightInFeet')::numeric h, (data->>'numStoriesAboveGrade')::numeric s FROM base
             WHERE city IS NOT NULL AND ${pos("numStoriesAboveGrade")} AND ${pos("buildingHeightInFeet")}) t
       GROUP BY 1 ORDER BY min(s)`,
    );
    console.log(
      "## Feet per story by story count (both cities, all properties with both)\n",
    );
    table(
      ["Stories", "Properties", "p10", "median", "p90"],
      bucket.map((r) => [
        String(r.b),
        String(num(r.n)),
        String(r.p10),
        String(r.p50),
        String(r.p90),
      ]),
    );

    const stories = await q(
      `WITH ${BASE} SELECT city, grp,
         count(*) FILTER (WHERE ${pos("numStoriesAboveGrade")}) AS n,
         count(*) FILTER (WHERE (data->>'numStoriesAboveGrade')::numeric = 1 AND ${pos("numStoriesAboveGrade")}) AS s1,
         count(*) FILTER (WHERE (data->>'numStoriesAboveGrade')::numeric = 2 AND ${pos("numStoriesAboveGrade")}) AS s2,
         count(*) FILTER (WHERE (data->>'numStoriesAboveGrade')::numeric BETWEEN 3 AND 5 AND ${pos("numStoriesAboveGrade")}) AS s3_5,
         count(*) FILTER (WHERE (data->>'numStoriesAboveGrade')::numeric BETWEEN 6 AND 15 AND ${pos("numStoriesAboveGrade")}) AS s6_15,
         count(*) FILTER (WHERE (data->>'numStoriesAboveGrade')::numeric > 15 AND ${pos("numStoriesAboveGrade")}) AS s16,
         max((data->>'numStoriesAboveGrade')::numeric) FILTER (WHERE ${pos("numStoriesAboveGrade")}) AS smax
       FROM grouped GROUP BY city, grp`,
    );
    console.log("## Stories distribution (properties with stories)\n");
    table(
      ["City", "Group", "With stories", "1", "2", "3-5", "6-15", "16+", "max"],
      CITIES.flatMap((city) =>
        GROUPS.map((g) => {
          const r = stories.find((x) => x.city === city && x.grp === g);
          const n = num(r?.n);
          return [
            city,
            g,
            String(n),
            cell(num(r?.s1), n),
            cell(num(r?.s2), n),
            cell(num(r?.s3_5), n),
            cell(num(r?.s6_15), n),
            cell(num(r?.s16), n),
            String(num(r?.smax)),
          ];
        }),
      ),
    );

    const lot = await q(
      `WITH ${BASE} SELECT city, data->>'lotSizeMeasurementType' AS unit, count(*) AS n
       FROM base WHERE city IS NOT NULL AND ${pos("lotSize")} GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    console.log(
      "## Land-area unit codes (1 = SF, 2 = acres, 3 = square metres; properties with `lotSize`)\n",
    );
    table(
      ["City", "Unit code", "Properties"],
      lot.map((r) => [
        String(r.city),
        String(r.unit ?? "missing"),
        String(num(r.n)),
      ]),
    );

    // Attachments.
    console.log("## Attachments\n");
    console.log(
      'Property coverage = share of properties with at least one reference of the kind. "With link" counts only references that carry a URI (for 3D, a Matterport model ID). References repeat across source locations, so distinct attachment IDs are given too.\n',
    );
    const agg = await q(
      `WITH ${BASE}, ${ATT}
       SELECT city, grp, kind,
              count(*) AS refs,
              count(DISTINCT master_id) AS distinct_att,
              count(DISTINCT pid) AS props,
              count(DISTINCT pid) FILTER (WHERE CASE WHEN kind = 'tour3d' THEN mp ELSE has_uri END) AS props_link,
              count(DISTINCT model_id) FILTER (WHERE mp) AS models
       FROM agrouped GROUP BY city, grp, kind`,
    );
    const anyMp = await q(
      `WITH ${BASE}, ${ATT}
       SELECT city, grp, count(DISTINCT pid) AS props, count(DISTINCT model_id) AS models, count(*) AS refs
       FROM agrouped WHERE mp GROUP BY city, grp`,
    );
    const anyAtt = await q(
      `WITH ${BASE}, ${ATT}
       SELECT city, grp, count(DISTINCT pid) AS props FROM agrouped GROUP BY city, grp`,
    );
    const denom = Object.fromEntries(
      field.map((r) => [`${r.city}|${r.grp}`, num(r.n)]),
    );
    for (const city of CITIES) {
      console.log(`### ${city}\n`);
      const header = [
        "Kind",
        ...GROUPS.map((g) => `${g} (n=${denom[`${city}|${g}`]})`),
      ];
      const find = (g: string, k: string) =>
        agg.find((r) => r.city === city && r.grp === g && r.kind === k);
      console.log("Property coverage (any reference):\n");
      table(header, [
        ...KINDS.map(([k, label]) => [
          label,
          ...GROUPS.map((g) =>
            cell(num(find(g, k)?.props), denom[`${city}|${g}`]),
          ),
        ]),
        [
          "Any attachment",
          ...GROUPS.map((g) =>
            cell(
              num(anyAtt.find((r) => r.city === city && r.grp === g)?.props),
              denom[`${city}|${g}`],
            ),
          ),
        ],
      ]);
      console.log(
        "Property coverage with a link (URI, or Matterport model ID for 3D):\n",
      );
      table(
        header,
        KINDS.filter(([k]) => k !== "other").map(([k, label]) => [
          label,
          ...GROUPS.map((g) =>
            cell(num(find(g, k)?.props_link), denom[`${city}|${g}`]),
          ),
        ]),
      );
      console.log("Reference counts (distinct attachment IDs in brackets):\n");
      table(
        ["Kind", ...GROUPS],
        KINDS.map(([k, label]) => [
          label,
          ...GROUPS.map((g) => {
            const r = find(g, k);
            return `${num(r?.refs).toLocaleString("en-US")} (${num(r?.distinct_att).toLocaleString("en-US")})`;
          }),
        ]),
      );
      console.log("Matterport model IDs on any attachment (any kind):\n");
      table(
        ["Measure", ...GROUPS],
        [
          [
            "Properties with at least one model ID",
            ...GROUPS.map((g) => {
              const r = anyMp.find((x) => x.city === city && x.grp === g);
              return cell(num(r?.props), denom[`${city}|${g}`]);
            }),
          ],
          [
            "Distinct model IDs",
            ...GROUPS.map((g) =>
              String(
                num(anyMp.find((x) => x.city === city && x.grp === g)?.models),
              ),
            ),
          ],
          [
            "References carrying a model ID",
            ...GROUPS.map((g) =>
              String(
                num(anyMp.find((x) => x.city === city && x.grp === g)?.refs),
              ),
            ),
          ],
        ],
      );
    }

    // URL pattern classes, counts only.
    const patterns = await q(
      `SELECT
         count(*) FILTER (WHERE coalesce(a.data->>'uri', a.data->>'attachmentUri','') ~* 'matterport') AS matterport_domain,
         count(*) FILTER (WHERE coalesce(a.data->>'uri', a.data->>'attachmentUri','') ~* '(youtube|youtu\\.be|vimeo)') AS video_host,
         count(*) FILTER (WHERE coalesce(a.data->>'uri', a.data->>'attachmentUri','') ~* '(kuula|cloudpano|roundme|giraffe360|eyespy|3dvista|my360|ricoh360|vr360|tourbuilder)') AS other_tour_host,
         count(*) FILTER (WHERE coalesce(a.data->>'uri', a.data->>'attachmentUri','') ~* '\\.(jpg|jpeg|png)(\\?|$)') AS image_file,
         count(*) FILTER (WHERE coalesce(a.data->>'uri', a.data->>'attachmentUri','') = '') AS no_uri,
         count(*) AS total
       FROM costar_attachments a`,
    );
    console.log(
      "## URL pattern classes (all attachment references, counts only)\n",
    );
    const p = patterns[0];
    table(
      ["Pattern", "References"],
      [
        ["matterport domain in URI", String(num(p.matterport_domain))],
        ["video host (YouTube or Vimeo) in URI", String(num(p.video_host))],
        ["other 3D-tour vendor host in URI", String(num(p.other_tour_host))],
        ["URI is an image file (jpg, jpeg, png)", String(num(p.image_file))],
        ["no URI", String(num(p.no_uri))],
        ["total references", String(num(p.total))],
      ],
    );
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "Report failed");
  process.exitCode = 1;
});
