/** Small style boundary: these engines need concrete colors, never CSS var() strings. */
export const renderTokens = [
  "canvas",
  "panel-raised",
  "field",
  "glass-edge",
  "ink",
  "muted",
  "accent",
  "on-accent",
  "warn",
  "danger",
  "agent-customer",
  "agent-employee",
] as const;
export type RenderToken = (typeof renderTokens)[number];
export type RenderPalette = Record<RenderToken, string>;
type Rgb = [number, number, number];
function channels(value: string): [...Rgb, number] {
  const hex = value
    .trim()
    .match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const full = hex.length < 5 ? [...hex].map((c) => c + c).join("") : hex;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    ];
  }
  const parts = value
    .trim()
    .match(/^rgba?\(([^)]+)\)$/i)?.[1]
    .trim()
    .split(/[\s,/]+/);
  if (parts && (parts.length === 3 || parts.length === 4)) {
    const rgb = parts
      .slice(0, 3)
      .map((c) => (c.endsWith("%") ? parseFloat(c) * 2.55 : Number(c)));
    const alpha = parts[3] ?? "1";
    const a = alpha.endsWith("%") ? parseFloat(alpha) / 100 : Number(alpha);
    if (
      rgb.every((c) => Number.isFinite(c) && c >= 0 && c <= 255) &&
      Number.isFinite(a) &&
      a >= 0 &&
      a <= 1
    )
      return [rgb[0], rgb[1], rgb[2], a];
  }
  throw new Error(`Unresolved renderer color: ${value}`);
}
/** Composite alpha against the known canvas, then use legacy RGB syntax all three engines accept. */
export function opaqueRenderColor(value: string, canvas: Rgb): string {
  const [r, g, b, a] = channels(value);
  return `rgb(${[r, g, b].map((c, i) => Math.round(c * a + canvas[i] * (1 - a))).join(", ")})`;
}
/** Call once at canvas/viewer creation, not from animation callbacks. Resolver injection is for tests. */
export function readRenderPalette(
  resolveToken?: (token: RenderToken) => string,
): RenderPalette {
  let probe: HTMLSpanElement | undefined;
  if (!resolveToken) {
    if (typeof document === "undefined")
      throw new Error("Renderer palette requires the mounted document");
    probe = document.createElement("span");
    probe.hidden = true;
    document.documentElement.append(probe);
    const target = probe;
    resolveToken = (token) => {
      const variable = `--color-${token}`;
      if (
        !getComputedStyle(document.documentElement)
          .getPropertyValue(variable)
          .trim()
      )
        throw new Error(`Missing renderer token: ${variable}`);
      target.style.color = `var(${variable})`;
      return getComputedStyle(target).color;
    };
  }
  try {
    const raw = Object.fromEntries(
      renderTokens.map((token) => [token, resolveToken(token)]),
    ) as RenderPalette;
    const [r, g, b, a] = channels(raw.canvas);
    if (a !== 1) throw new Error("Renderer canvas must be opaque");
    const canvas: Rgb = [r, g, b];
    return Object.fromEntries(
      renderTokens.map((token) => [
        token,
        opaqueRenderColor(raw[token], canvas),
      ]),
    ) as RenderPalette;
  } finally {
    probe?.remove();
  }
}
