import { expect, test } from "./fixtures";

test("application typography loads a same-origin variable face on screen and in print", async ({
  page,
}) => {
  const fonts: { url: string; status: number }[] = [];
  const hostedRequests: string[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "font")
      fonts.push({ url: response.url(), status: response.status() });
  });
  page.on("request", (request) => {
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url()))
      hostedRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/projects/houston-coffee/comparison");
  const typography = await page.evaluate(async () => {
    await document.fonts.ready;
    const family = getComputedStyle(document.body).fontFamily;
    const primary = family.split(",")[0].trim().replaceAll(/["']/g, "");
    const loaded = Array.from(document.fonts).some(
      (face) =>
        face.family.replaceAll(/["']/g, "") === primary &&
        face.status === "loaded",
    );
    const bold = await document.fonts.load(
      `700 16px "${primary}"`,
      "BizBox $1,234–5,678",
    );
    return {
      primary,
      loaded,
      bold: bold.length,
      root: getComputedStyle(document.documentElement).getPropertyValue(
        "--font-bizbox-sans",
      ),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(typography.root).toContain(typography.primary);
  expect(typography.loaded).toBe(true);
  expect(typography.bold).toBeGreaterThan(0);
  expect(typography.overflow).toBe(false);
  expect(fonts.length).toBeGreaterThan(0);
  for (const font of fonts) {
    expect(new URL(font.url).origin).toBe(new URL(page.url()).origin);
    expect(new URL(font.url).pathname).toMatch(/^\/_next\/static\/media\//);
    expect(font.status).toBe(200);
  }
  expect(hostedRequests).toEqual([]);
  await page.emulateMedia({ media: "print" });
  const printFamily = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(printFamily).toContain(typography.primary);
});
