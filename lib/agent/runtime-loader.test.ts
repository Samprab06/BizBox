import { describe, expect, it } from "vitest";
import {
  describeLoadError,
  ModelRuntimeUnavailableError,
} from "./runtime-loader";

describe("runtime loader", () => {
  it("describes load failures in one line without credentials", () => {
    const error = new Error(
      "Cannot find module '/var/task/node_modules/@langchain/core/dist/index.cjs'\n    at stack line",
    );
    expect(describeLoadError(error)).toBe(
      "Error: Cannot find module '/var/task/node_modules/@langchain/core/dist/index.cjs'",
    );
    expect(
      describeLoadError(
        new Error("postgres://u:p@h/db failed sk-abcdefghijkl"),
      ),
    ).toBe("Error: <redacted-url> failed <redacted>");
    expect(new ModelRuntimeUnavailableError("x").detail).toBe("x");
  });
});
