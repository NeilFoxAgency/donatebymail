import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const staticPages = readdirSync("public")
  .filter((name) => name.endsWith(".html"))
  .map((name) => `public/${name}`);

describe("static page shell", () => {
  it("loads the shared shell script and stylesheet on every public HTML page", () => {
    expect(staticPages.length).toBeGreaterThan(0);
    for (const page of staticPages) {
      const source = readFileSync(page, "utf8");
      expect(source, page).toContain('src="./site-shell.js"');
      expect(source, page).toContain('href="./site-shell.css" data-site-shell');
    }
  });
});
