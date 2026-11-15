import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "./card";
import { Stat } from "./stat";
import { GlassControl } from "./glass-control";
import { EvidenceBadge } from "./evidence-badge";
import { Glass } from "./glass";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Input, Select, Textarea } from "./input";
import { Chip, Pill } from "./pill";
import { Segmented, Tabs } from "./tabs";
import { Panel } from "./panel";
import { ChatBubble, Composer } from "./chat";
import { cn, focusRing } from "./cn";

const render = renderToStaticMarkup;

describe("analysis primitives", () => {
  it("keeps a Card solid and forwards accessible labelling", () => {
    const html = render(
      h(Card, { "aria-label": "Costs", surface: "viewport" }, "Rent"),
    );
    expect(html).toContain('aria-label="Costs"');
    expect(html).toContain('data-surface="viewport"');
    expect(html).toContain("sw-card");
    expect(html).not.toContain("sw-glass-control");
  });

  it("associates a tabular value and adjacent evidence qualifier with its label", () => {
    const html = render(
      h(Stat, {
        label: "Monthly contribution",
        value: "$2,400–$3,100",
        qualifier: h(EvidenceBadge, { kind: "Simulation" }),
      }),
    );
    expect(html).toContain("<dl");
    expect(html).toContain("<dt>Monthly contribution</dt>");
    expect(html).toMatch(/<dd[^>]*sw-stat-value[^>]*>\$2,400–\$3,100<\/dd>/);
    expect(html).toMatch(/<dd[^>]*sw-stat-qualifier[^>]*>.*Simulation.*<\/dd>/);
  });

  it.each(["baseline", "alternative"] as const)(
    "names the %s scenario alongside the stat",
    (scenario) => {
      const html = render(h(Stat, { label: "Wait", value: "3 min", scenario }));
      expect(html).toContain(`sw-scenario-${scenario}`);
      expect(html).toContain(
        scenario === "baseline" ? "Baseline" : "Alternative",
      );
    },
  );

  it("restricts GlassControl to labelled controls floating over a spatial view", () => {
    const html = render(
      h(
        GlassControl,
        { over: "viewport", "aria-label": "View controls" },
        h("button", { type: "button" }, "Expand"),
      ),
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="View controls"');
    expect(html).toContain('data-surface="viewport"');
    expect(html).toContain("sw-glass-control");
    expect(html).toContain("<button");
  });

  it.each(["Source-backed", "Your input", "Assumption", "Simulation"] as const)(
    "shows %s in text without relying on color or a tooltip",
    (kind) => {
      const html = render(h(EvidenceBadge, { kind }));
      expect(html).toContain(`>${kind}</span>`);
      expect(html).not.toContain('role="status"');
      expect(html).not.toContain("title=");
    },
  );
});

describe("shared primitives", () => {
  it("uses one focus ring on every interactive primitive", () => {
    const tabs = [{ value: "a", label: "A" }];
    const all = [
      render(h(Button, null, "Go")),
      render(h(IconButton, { "aria-label": "Close" }, "x")),
      render(h(Input, { "aria-label": "Name" })),
      render(h(Textarea, { "aria-label": "Notes" })),
      render(h(Select, { "aria-label": "Kind" })),
      render(h(Chip, null, "Cafe")),
      render(
        h(Tabs, {
          items: tabs,
          value: "a",
          onValueChange() {},
          "aria-label": "T",
        }),
      ),
      render(
        h(Segmented, {
          items: tabs,
          value: "a",
          onValueChange() {},
          "aria-label": "S",
        }),
      ),
      render(h(Composer, { onSubmit() {} })),
    ];
    for (const html of all)
      expect(html).toContain("focus-visible:outline-focus-ring");
    expect(focusRing).toContain("outline-2");
  });

  it("turns off transitions for reduced motion and scales on press", () => {
    const html = render(h(Button, null, "Go"));
    expect(html).toContain("motion-reduce:transition-none");
    expect(html).toContain("active:scale-[0.97]");
  });

  it("cn skips falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("renders Glass with and without a sheen", () => {
    expect(render(h(Glass, null, "x"))).not.toContain("data-sheen");
    expect(render(h(Glass, { sheen: true }, "x"))).toContain(
      'data-sheen="true"',
    );
    expect(render(h(Glass, { backing: "backed" }, "x"))).toContain(
      "bg-glass-fallback",
    );
  });

  it.each(["primary", "glass", "quiet", "danger"] as const)(
    "renders Button %s",
    (variant) => {
      const html = render(h(Button, { variant }, "Go"));
      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).toContain('type="button"');
    },
  );

  it("styles primary as white on dark and danger with the danger token", () => {
    expect(render(h(Button, { variant: "primary" }, "x"))).toContain(
      "bg-accent",
    );
    expect(render(h(Button, { variant: "danger" }, "x"))).toContain(
      "text-danger",
    );
  });

  it.each([
    ["sm", "h-8"],
    ["md", "h-10"],
    ["lg", "h-12"],
  ] as const)("sizes Button %s", (size, cls) => {
    expect(render(h(Button, { size }, "x"))).toContain(cls);
  });

  it("disables Button and exposes busy state while loading", () => {
    const html = render(h(Button, { loading: true }, "Save"));
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Save");
  });

  it("disables Button when disabled", () => {
    const html = render(h(Button, { disabled: true }, "x"));
    expect(html).toContain("disabled");
    expect(html).toContain("disabled:opacity-60");
    expect(html).not.toContain("aria-busy");
  });

  it("IconButton keeps its accessible name and states", () => {
    const html = render(
      h(IconButton, { "aria-label": "Close", loading: true }, "x"),
    );
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(
      render(h(IconButton, { "aria-label": "Close", size: "lg" }, "x")),
    ).toContain("size-12");
  });

  it.each([Input, Textarea, Select])(
    "marks invalid and disabled fields",
    (Field) => {
      const html = render(
        h(Field as typeof Input, {
          "aria-label": "F",
          invalid: true,
          disabled: true,
        }),
      );
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain("border-danger");
      expect(html).toContain("disabled");
      expect(render(h(Field as typeof Input, { "aria-label": "F" }))).toContain(
        "border-glass-edge",
      );
    },
  );

  it("renders Pill tones and a toggle Chip with pressed state", () => {
    expect(render(h(Pill, { tone: "warn" }, "Draft"))).toContain(
      'data-tone="warn"',
    );
    expect(render(h(Chip, { selected: true }, "Cafe"))).toContain(
      'aria-pressed="true"',
    );
    const off = render(h(Chip, null, "Cafe"));
    expect(off).toContain('aria-pressed="false"');
    expect(render(h(Chip, { disabled: true }, "x"))).toContain("disabled");
  });

  const items = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta", disabled: true },
  ];
  it("renders Tabs with roving tabindex and selected state", () => {
    const html = render(
      h(Tabs, { items, value: "a", onValueChange() {}, "aria-label": "Views" }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("renders Segmented as a radio group", () => {
    const html = render(
      h(Segmented, {
        items,
        value: "a",
        onValueChange() {},
        "aria-label": "Scenario",
      }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("aria-selected");
  });

  it("labels a Panel by its title and shows actions and footer", () => {
    const html = render(
      h(Panel, { title: "Costs", actions: "act", footer: "foot" }, "body"),
    );
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    expect(html).toContain("<h2");
    expect(html).toContain("act");
    expect(html).toContain("foot");
    expect(render(h(Panel, { tone: "glass" }, "b"))).toContain(
      'data-tone="glass"',
    );
    expect(render(h(Panel, null, "b"))).not.toContain("aria-labelledby");
  });

  it("distinguishes user and assistant bubbles", () => {
    const user = render(h(ChatBubble, { role: "user" }, "hi"));
    expect(user).toContain('data-role="user"');
    expect(user).toContain("bg-accent");
    const bot = render(h(ChatBubble, null, "hello"));
    expect(bot).toContain('data-role="assistant"');
    expect(bot).toContain("bg-panel-raised");
  });

  it("renders a Composer with a labelled field and a disabled empty send", () => {
    const html = render(h(Composer, { onSubmit() {}, "aria-label": "Ask" }));
    expect(html).toContain('aria-label="Ask"');
    expect(html).toContain('type="submit"');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("Composer shows loading and disabled states", () => {
    const loading = render(h(Composer, { onSubmit() {}, loading: true }));
    expect(loading).toContain('aria-busy="true"');
    const off = render(h(Composer, { onSubmit() {}, disabled: true }));
    expect(off).toMatch(/<textarea[^>]*disabled/);
  });
});
