import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

export const candidateMapStyleUrl =
  "https://tiles.openfreemap.org/styles/liberty";

// These Liberty filters compare optional OpenMapTiles properties as numbers.
// Missing/non-numeric values should omit that label, just as the original filter
// does on evaluation failure, without throwing a worker warning for every layer.
const nullableFilterFields: Record<string, string> = {
  poi_r20: "rank",
  poi_r7: "rank",
  poi_r1: "rank",
  label_country_3: "rank",
  "highway-shield-non-us": "ref_length",
  "highway-shield-us-interstate": "ref_length",
  road_shield_us: "ref_length",
};

function gets(expression: unknown, field: string): boolean {
  return (
    Array.isArray(expression) &&
    expression.length === 2 &&
    expression[0] === "get" &&
    expression[1] === field
  );
}

function comparesNumber(expression: unknown, field: string): boolean {
  if (!Array.isArray(expression)) return false;
  return (
    (["<", "<=", ">", ">="].includes(expression[0]) &&
      ((gets(expression[1], field) && typeof expression[2] === "number") ||
        (gets(expression[2], field) && typeof expression[1] === "number"))) ||
    expression.slice(1).some((value) => comparesNumber(value, field))
  );
}

/** Prepare the existing remote style; preserve known values, imagery and attribution. */
export function prepareCandidateMapStyle(
  style: StyleSpecification,
  sourceUrl = candidateMapStyleUrl,
): StyleSpecification {
  const absolute = (url: string) =>
    /^[a-z][a-z\d+.-]*:/i.test(url)
      ? url
      : new URL(url, sourceUrl).href
          .replace(/%7B/gi, "{")
          .replace(/%7D/gi, "}");
  return {
    ...style,
    ...(style.glyphs ? { glyphs: absolute(style.glyphs) } : {}),
    ...(style.sprite
      ? {
          sprite:
            typeof style.sprite === "string"
              ? absolute(style.sprite)
              : style.sprite.map((sprite) => ({
                  ...sprite,
                  url: absolute(sprite.url),
                })),
        }
      : {}),
    sources: Object.fromEntries(
      Object.entries(style.sources).map(([id, source]) => {
        const resolved = { ...source };
        if ("url" in resolved && typeof resolved.url === "string")
          resolved.url = absolute(resolved.url);
        if ("tiles" in resolved) resolved.tiles = resolved.tiles?.map(absolute);
        if ("urls" in resolved) resolved.urls = resolved.urls.map(absolute);
        if ("data" in resolved && typeof resolved.data === "string")
          resolved.data = absolute(resolved.data);
        return [id, resolved];
      }),
    ),
    layers: style.layers.map((layer): LayerSpecification => {
      const field = nullableFilterFields[layer.id];
      if (field && "filter" in layer && comparesNumber(layer.filter, field)) {
        return {
          ...layer,
          filter: [
            "all",
            ["==", ["typeof", ["get", field]], "number"],
            layer.filter as ExpressionSpecification,
          ],
        };
      }
      if (layer.id === "building-3d" && layer.type === "fill-extrusion") {
        const paint = { ...layer.paint };
        if (gets(paint["fill-extrusion-base"], "render_min_height"))
          paint["fill-extrusion-base"] = [
            "number",
            ["get", "render_min_height"],
            0,
          ];
        if (gets(paint["fill-extrusion-height"], "render_height"))
          paint["fill-extrusion-height"] = [
            "number",
            ["get", "render_height"],
            0,
          ];
        return { ...layer, paint };
      }
      return layer;
    }),
  };
}
