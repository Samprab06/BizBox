import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Apple touch icon: the same mark at 180 px (iOS rounds the corners itself).
// Rendered once at build time.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const mark = await readFile(
    join(process.cwd(), "public/brand/icon-on-dark.png"),
  );
  const src = `data:image/png;base64,${mark.toString("base64")}`;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f2a2e",
        borderRadius: 0,
      }}
    >
      <img src={src} width={150} height={104} alt="" />
    </div>,
    size,
  );
}
