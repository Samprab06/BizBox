import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The white BizBox storefront mark on the brand's dark teal, so it reads on light and
// dark browser tab bars alike. Rendered once at build time.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
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
        borderRadius: 14,
      }}
    >
      <img src={src} width={52} height={36} alt="" />
    </div>,
    size,
  );
}
