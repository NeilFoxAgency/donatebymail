import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellScript = readFileSync("public/site-shell.js", "utf8");
const shellCss = readFileSync("public/site-shell.css", "utf8");

describe("shared navigation", () => {
  it("keeps the donor CTA prominent and groups secondary destinations", () => {
    expect(shellScript).toContain("nav-primary");
    expect(shellScript).toContain("<summary>Explore</summary>");
    expect(shellScript).toContain('["Blog", "/articles"]');
    expect(shellScript).not.toContain('["Articles", "/articles"]');
    expect(shellCss).toContain(".nav-menu-panel");
  });
});
