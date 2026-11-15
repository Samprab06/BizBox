import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("renders bold, italic and code without literal markers", () => {
    const out = html("A **bold** and *soft* and `code` word");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>soft</em>");
    expect(out).toContain(">code</code>");
    expect(out).not.toContain("**");
  });
  it("keeps line breaks and lists", () => {
    const out = html("one\ntwo\n\n- a\n- **b**\n\n1. x\n2. y");
    expect(out).toContain("one<br/>two");
    expect(out).toContain("<ul");
    expect(out).toContain("<li><strong>b</strong></li>");
    expect(out).toContain("<ol");
  });
  it("leaves unmatched markers as plain text", () => {
    expect(html("2 * 3 and **open")).toContain("2 * 3 and **open");
  });
  it("renders markup as text (XSS)", () => {
    const out = html('<script>alert(1)</script> **<img src=x onerror=alert(1)>**');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img");
  });
});
