import { expect, test } from "./fixtures";

for (const viewport of [
  { width: 1365, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`uncached landing keeps initial media below 750KB at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Test your business before you commit.",
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLImageElement>("img")]
            .filter((image) => {
              const box = image.getBoundingClientRect();
              return (
                box.width > 0 &&
                box.height > 0 &&
                box.top < innerHeight &&
                box.bottom > 0
              );
            })
            .every((image) => image.complete && image.naturalWidth > 0),
        ),
      )
      .toBe(true);

    const resources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return {
          url: resource.name,
          bytes: resource.encodedBodySize,
          type: resource.initiatorType,
        };
      }),
    );
    const urls = resources.map((resource) => resource.url);
    expect(
      urls.filter((url) =>
        /\/onboarding\/houston-real\.jpg|\/macbook\/houston-sunset\.jpg/.test(
          url,
        ),
      ),
    ).toEqual([]);
    expect(
      urls.filter((url) => /cafe-interior|cafe-overhead|\/cesium\//.test(url)),
    ).toEqual([]);
    expect(
      urls.filter((url) => /macbook-gpt-v3-.*\.webp/.test(url)),
    ).toHaveLength(1);
    expect(urls.filter((url) => /geist_latin.*\.woff2/.test(url))).toEqual([]);
    const media = resources.filter((resource) =>
      /\/landing-assets\/|\/_next\/image/.test(resource.url),
    );
    expect(
      media.reduce((bytes, resource) => bytes + resource.bytes, 0),
    ).toBeLessThan(750_000);
    expect(
      resources
        .filter((resource) => resource.type === "script")
        .reduce((bytes, resource) => bytes + resource.bytes, 0),
    ).toBeLessThan(350_000);
    const laptop = page.locator('img[alt="MacBook displaying BizBox"]');
    await expect(laptop).not.toHaveAttribute("src", /\/_next\/image/);
    const currentSource = await laptop.evaluate(
      (image) => (image as HTMLImageElement).currentSrc,
    );
    const assetResponse = await page.request.head(currentSource);
    expect(assetResponse.status()).toBe(200);
    expect(assetResponse.headers()["cache-control"]).toContain("immutable");
  });
}
