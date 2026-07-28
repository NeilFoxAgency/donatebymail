import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = ["src/App.tsx", "public/site-shell.js"].map((path) =>
  readFileSync(path, "utf8"),
);

describe("sitewide social footer", () => {
  it("links to every Donate by Mail social profile in both footer implementations", () => {
    for (const source of sources) {
      expect(source).toContain("https://x.com/donatebymail");
      expect(source).toContain(
        "https://www.facebook.com/people/Donate-by-Mail/61551982935106/",
      );
      expect(source).toContain(
        "https://bsky.app/profile/donatebymail.bsky.social",
      );
    }
  });

  it("gives each icon link an accessible brand label", () => {
    for (const source of sources) {
      expect(source).toContain("Donate by Mail on X");
      expect(source).toContain("Donate by Mail on Facebook");
      expect(source).toContain("Donate by Mail on Bluesky");
    }
  });

  it("uses the supplied Bluesky image in both footer implementations", () => {
    for (const source of sources) {
      expect(source).toContain("/resources/bluesky-white-icon.png");
      expect(source).toContain("social-icon-bluesky");
    }
  });
});
