import { it, expect } from "vitest";
import { matchCandidateAddresses } from "./candidate-interior-diagnostics";
it("uses exact normalized addresses and rejects missing/ambiguous properties", () => {
  const rows = [
    {
      PropertyId: "12",
      Address: "100 Test Ave",
      City: "Houston",
      MatterportModelId: "Abcdefghi12",
    },
    {
      PropertyId: "12",
      Address: "100 Test Ave",
      City: "Houston",
      MatterportModelId: "Abcdefghi12",
    },
  ];
  expect(
    matchCandidateAddresses(rows, [" 100   TEST Ave "])[0]!.propertyModelIds,
  ).toEqual(["Abcdefghi12"]);
  expect(() => matchCandidateAddresses(rows, ["100 Test"])).toThrow("no exact");
  expect(() =>
    matchCandidateAddresses(
      [...rows, { ...rows[0]!, PropertyId: "13" }],
      ["100 Test Ave"],
    ),
  ).toThrow("multiple");
});
