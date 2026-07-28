import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("fundraising social proof", () => {
  it("documents the full campaign history on the team page", () => {
    const team = read("public/team.html");

    expect(team).toContain("$78,000+");
    expect(team).toContain("#FursuitFriday Charity Calendar");
    expect(team).toContain("Last Chance Corral");
    expect(team).toContain("Pocari Roo Saves the Kitties");
    expect(team).toContain("Flatbush Cats");
    expect(team).toContain(
      "https://www.indiegogo.com/en/projects/tailfluffcreations/fursuitfriday-charity-calendar",
    );
    expect(team).toContain(
      "https://www.indiegogo.com/en/projects/tailfluffcreations/pocari-roo-saves-the-kitties",
    );
  });

  it("uses concise proof points on other relevant pages", () => {
    const home = read("src/App.tsx");
    expect(home).toContain("$78,000+");
    expect(home).not.toContain("See the campaigns");

    for (const source of [
      read("public/about.html"),
      read("public/for-nonprofits.html"),
    ]) {
      expect(source).toContain("$78,000+");
      expect(source).toContain("team.html#fundraising-experience");
    }
  });
});
