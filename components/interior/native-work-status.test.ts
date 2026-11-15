import { expect, it } from "vitest";
import { nativeWorkStatus } from "./native-work-status";
it("distinguishes a missing floor point, native loading and the running comparison", () => {
  expect(nativeWorkStatus({ revision: 2, awaitingPlacement: true })).toMatch(
    /Click the floor/,
  );
  expect(
    nativeWorkStatus({
      revision: 2,
      preparing: true,
      native: { revision: 1, status: "ready" },
    }),
  ).toMatch(/Placing furniture/);
  expect(
    nativeWorkStatus({
      revision: 2,
      preparing: true,
      native: { revision: 2, status: "ready" },
    }),
  ).toBe("Running the comparison…");
  expect(
    nativeWorkStatus({
      revision: 2,
      preparing: true,
      native: { revision: 2, status: "failed" },
    }),
  ).toMatch(/try another spot/);
  expect(nativeWorkStatus({ revision: 2, preparing: false })).toBeNull();
});
