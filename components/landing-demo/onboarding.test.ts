import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnboardingScene } from "./onboarding";
import { DEMO } from "./demo-data";
import { chapterAt, onboardingAt } from "./timeline";

const noop = () => {};
describe("persistent onboarding surface", () => {
  it.each([0, 0.1, 0.16, 0.219999, 0.22, 0.3])(
    "renders exactly one card at progress %s and gates controls/heading until entry completes",
    (progress) => {
      const frame = chapterAt(progress);
      const onboarding = onboardingAt(0);
      const html = renderToStaticMarkup(
        h(OnboardingScene, {
          demo: DEMO,
          ...onboarding,
          ready: frame.onboardingReady,
          style: {},
          paused: false,
          onPause: noop,
          onReplay: noop,
          onSkip: noop,
          onContinue: noop,
        }),
      );
      expect(html.match(/data-onboarding-panel="true"/g)).toHaveLength(1);
      expect(html.match(/What are you opening\?/g)).toHaveLength(1);
      expect(html).toContain(encodeURIComponent("/brand/logo-on-dark.png"));
      expect(html.includes('inert=""')).toBe(!frame.onboardingReady);
      expect(html.includes("Understand")).toBe(frame.onboardingReady);
    },
  );
  it("retains the prepared question and progress in the same surface when reversing entry", () => {
    const html = renderToStaticMarkup(
      h(OnboardingScene, {
        demo: DEMO,
        ...onboardingAt(7000),
        ready: false,
        style: {},
        paused: true,
        onPause: noop,
        onReplay: noop,
        onSkip: noop,
        onContinue: noop,
      }),
    );
    expect(html.match(/data-onboarding-panel="true"/g)).toHaveLength(1);
    expect(html).toContain("Review your business.");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('inert=""');
  });
});
