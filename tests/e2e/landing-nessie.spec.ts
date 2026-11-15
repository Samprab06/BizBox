import { expect, test } from "./fixtures";

for (const width of [390, 1440]) {
  test(`Nessie demo progresses from question to cash comparison and interior at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const bankRequests: string[] = [];
    page.on("request", (request) => {
      if (
        /\/api\/integrations\/nessie|nessieisreal\.com|reimaginebanking\.com/.test(
          request.url(),
        )
      )
        bankRequests.push(request.url());
    });
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
      "data-story-chapter",
      "hero",
    );
    await page.evaluate(() =>
      window.scrollTo(
        0,
        0.581 * (document.documentElement.scrollHeight - innerHeight),
      ),
    );
    const sequence = page.locator("[data-nessie-stage]");
    await expect(sequence).toHaveAttribute("data-nessie-stage", "prompt");
    await page.getByRole("button", { name: "Send example prompt" }).click();
    await expect(sequence).toHaveAttribute("data-nessie-stage", "checking");
    await page.clock.runFor(2000);
    await expect(sequence).toHaveAttribute("data-nessie-stage", "snapshot");
    await expect(sequence).toContainText("$32,000");
    await page.clock.runFor(2800);
    await expect(sequence).toHaveAttribute("data-nessie-stage", "comparison");
    await expect(sequence).toContainText("$14,000");
    await expect(sequence).toContainText("$10,100");
    await expect(sequence).toContainText("$3,900 more");
    await page.getByRole("button", { name: "Pause story" }).click();
    await page.clock.runFor(10000);
    await expect(sequence).toHaveAttribute("data-nessie-stage", "comparison");
    await page.getByRole("button", { name: "Resume story" }).click();
    await page.clock.runFor(9000);
    await expect(sequence).toHaveAttribute("data-chat-state", "complete");
    await expect(sequence).toContainText(
      "Uses simulated Nessie financial data",
    );
    await expect(
      page.getByRole("button", { name: "See inside", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "See inside", exact: true }).click();
    await expect(page.locator("[data-interior-mix]")).toHaveAttribute(
      "data-interior-mix",
      "1",
    );
    const interiorImage = page.locator("[data-shared-interior] img");
    await expect(interiorImage).toHaveAttribute(
      "src",
      /\/landing-assets\/optimized\/cafe-interior-v1\.9ae3d6d7c0\.webp(?:\?.*)?$/,
    );
    await expect
      .poll(() =>
        interiorImage.evaluate(
          (image) => (image as HTMLImageElement).naturalWidth,
        ),
      )
      .toBeGreaterThan(0);
    expect(bankRequests).toEqual([]);
  });
}
test("reduced motion shows the final attributed demo answer without typing", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "hero",
  );
  await page.evaluate(() =>
    window.scrollTo(
      0,
      0.581 * (document.documentElement.scrollHeight - innerHeight),
    ),
  );
  await expect(page.locator("[data-nessie-stage]")).toHaveAttribute(
    "data-chat-state",
    "complete",
  );
  await expect(
    page.getByText("Uses simulated Nessie financial data"),
  ).toBeVisible();
  await page.getByText("Demo assumptions", { exact: true }).click();
  await expect(page.getByText(/No bank account is connected/)).toBeVisible();
});
