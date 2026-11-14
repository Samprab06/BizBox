import { createLayout, deriveRoomBounds } from "./model";

/** Authored local-test geometry, independent of source/scan services. */
export function layoutFixture(layoutId = "layout-root", siteId = "site-a") {
  const source = {
    origin: "agent-proposed" as const,
    evidenceIds: ["hac86:fixture"],
  };
  const footprint = (
    id: string,
    x: number,
    y: number,
    width = 2,
    depth = 2,
  ) => ({ id, footprint: { x, y, width, depth }, ...source });
  return createLayout({
    layoutId,
    siteId,
    category: "coffee",
    room: deriveRoomBounds({
      listing: { areaSqFt: 1600, evidenceIds: ["fixture:costar-sf"] },
    }),
    entrance: { id: "entrance", point: { x: 0, y: 10 }, widthFt: 4, ...source },
    counter: footprint("counter", 30, 8, 4, 4),
    stations: [{ ...footprint("s1", 30, 20), type: "espresso" }],
    seating: [{ ...footprint("seat1", 20, 25), seats: 2, dwellMin: 10 }],
    queuePath: {
      id: "queue",
      points: [
        { x: 8, y: 10 },
        { x: 26, y: 10 },
      ],
      ...source,
    },
    backOfHouse: footprint("boh", 30, 30, 10, 10),
  });
}
