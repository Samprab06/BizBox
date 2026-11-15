import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  projectMediaAnchors,
  preparedPlayback,
  preparedCardLayout,
} from "./media-projection";
import { PreparedVideo } from "./prepared-video";
import { PREPARED_MEDIA, parsePreparedMedia } from "./prepared-media-data";
import { StoryMap } from "./story-map";
import { createLocationStory } from "./location-data";

describe("prepared media projection", () => {
  const anchors = [
    { siteId: "montrose", u: 0.25, v: 0.5 },
    { siteId: "heights", u: 0.75, v: 0.25 },
  ];
  it("uses centered cover coordinates at native and portrait ratios without moving geographic anchors", () => {
    expect(
      projectMediaAnchors(
        anchors,
        { width: 1280, height: 720 },
        { width: 1280, height: 720 },
      ),
    ).toEqual([
      { id: "montrose", x: 320, y: 360 },
      { id: "heights", x: 960, y: 180 },
    ]);
    expect(
      projectMediaAnchors(
        anchors,
        { width: 1280, height: 720 },
        { width: 360, height: 720 },
      ),
    ).toEqual([
      { id: "montrose", x: -140, y: 360 },
      { id: "heights", x: 500, y: 180 },
    ]);
    expect(
      projectMediaAnchors(
        anchors,
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toEqual([
      { id: "montrose", x: 160, y: 180 },
      { id: "heights", x: 480, y: 90 },
    ]);
  });
  it("rejects unavailable geometry rather than creating invalid card coordinates", () => {
    expect(
      projectMediaAnchors(
        anchors,
        { width: 0, height: 720 },
        { width: 390, height: 844 },
      ),
    ).toEqual([]);
    expect(
      projectMediaAnchors(
        [{ siteId: "bad", u: NaN, v: 0.5 }],
        { width: 1280, height: 720 },
        { width: 390, height: 844 },
      ),
    ).toEqual([]);
  });
  it("keeps portrait property cards above the native note, attribution and playback band", () => {
    const viewport = { width: 390, height: 844 };
    const points = projectMediaAnchors(
      PREPARED_MEDIA.map.anchors,
      PREPARED_MEDIA.map,
      viewport,
    );
    const layout = preparedCardLayout(points, viewport);
    for (const point of points) {
      const offset = layout.offsets.get(point.id)!;
      expect(point.y + offset.y + layout.height / 2).toBeLessThanOrEqual(650);
      expect(point.y + offset.y - layout.height / 2).toBeGreaterThanOrEqual(
        180,
      );
      expect(point.x + offset.x - layout.width / 2).toBeGreaterThanOrEqual(18);
      expect(point.x + offset.x + layout.width / 2).toBeLessThanOrEqual(372);
    }
  });
});
describe("prepared playback policy", () => {
  const policy = {
    active: true,
    visible: true,
    reduced: false,
    saveData: false,
    manual: false,
  };
  it("requests no video for fact-only, hidden, reduced-motion and data-saving views", () => {
    expect(preparedPlayback(policy)).toBe("video");
    expect(preparedPlayback({ ...policy, active: false })).toBe("dormant");
    expect(preparedPlayback({ ...policy, visible: false })).toBe("dormant");
    expect(preparedPlayback({ ...policy, reduced: true })).toBe("poster");
    expect(preparedPlayback({ ...policy, saveData: true })).toBe("poster");
    expect(
      preparedPlayback({
        ...policy,
        reduced: true,
        saveData: true,
        manual: true,
      }),
    ).toBe("video");
    expect(preparedPlayback({ ...policy, visible: false, manual: true })).toBe(
      "dormant",
    );
  });
  it("server-renders a poster without speculative video sources or preload requests", () => {
    const html = renderToStaticMarkup(
      h(PreparedVideo, {
        media: {
          width: 1280,
          height: 720,
          duration: 6,
          poster: "/poster.webp",
          mp4: "/clip.mp4",
          webm: "/clip.webm",
        },
        label: "Recorded example",
        running: true,
        visible: true,
        reduced: false,
      }),
    );
    expect(html).toContain('src="/poster.webp"');
    expect(html).not.toContain("/clip.mp4");
    expect(html).not.toContain("/clip.webm");
    expect(html).not.toContain("<video");
  });
  it("keeps fact-only maps native and source-free, including selection controls and source attribution", () => {
    const html = renderToStaticMarkup(
      h(StoryMap, {
        data: createLocationStory(),
        minute: 480,
        expanded: true,
        selected: "montrose",
        onSelect: () => {},
        viewport: { width: 390, height: 844 },
        morning: false,
      }),
    );
    expect(html).not.toContain("<video");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain(".mp4");
    expect(html).toContain('aria-label="Select Montrose"');
    expect(html).toContain('aria-label="Select The Heights"');
    expect(html).toContain("Vexcel Imaging");
    expect(html).toContain("Microsoft");
    expect(html).toContain("OpenStreetMap");
    expect(html).toContain("Example area");
  });
  it("rejects mismatched recordings and unusable metadata before shipping invalid clips", () => {
    expect(() =>
      parsePreparedMedia({
        ...PREPARED_MEDIA,
        map: { ...PREPARED_MEDIA.map, width: 0 },
      }),
    ).toThrow("width");
    expect(() =>
      parsePreparedMedia({
        ...PREPARED_MEDIA,
        map: {
          ...PREPARED_MEDIA.map,
          anchors: [
            { siteId: "montrose", u: 2, v: 0 },
            { siteId: "heights", u: 0, v: 0 },
          ],
        },
      }),
    ).toThrow("anchor");
    expect(() =>
      parsePreparedMedia({
        ...PREPARED_MEDIA,
        counters: {
          ...PREPARED_MEDIA.counters,
          proposed: { ...PREPARED_MEDIA.counters.proposed, counterCount: 1 },
        },
      }),
    ).toThrow("setups");
  });
});

describe("separate discovery and simulation framing", () => {
  it("fits the full recording inside portrait viewports without clipping its corners", () => {
    const corners = [
      { siteId: "top", u: 0, v: 0 },
      { siteId: "bottom", u: 1, v: 1 },
    ];
    expect(
      projectMediaAnchors(
        corners,
        { width: 1120, height: 720 },
        { width: 390, height: 844 },
        "contain",
      ),
    ).toEqual([
      { id: "top", x: 0, y: 296.64285714285717 },
      { id: "bottom", x: 390, y: 547.3571428571429 },
    ]);
  });
  it("uses a dot-free discovery image instead of a simulation poster", () => {
    const html = renderToStaticMarkup(
      h(StoryMap, {
        data: createLocationStory(),
        minute: 480,
        expanded: true,
        selected: "montrose",
        onSelect: () => {},
        viewport: { width: 1365, height: 900 },
        morning: false,
      }),
    );
    expect(html).toContain("houston-discovery.");
    expect(html).not.toContain("houston-morning.");
  });
});
