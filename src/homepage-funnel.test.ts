import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const home = readFileSync("src/App.tsx", "utf8");
const normalizedHome = home.replace(/\s+/g, " ");
const metadata = readFileSync("index.html", "utf8");
const llms = readFileSync("public/llms.txt", "utf8");

describe("donor-first homepage funnel", () => {
  it("leads with the core proposition and a dominant donor action", () => {
    expect(home).toContain("Old Phones.");
    expect(home).toContain(
      "Turn an old phone into support for a charity you choose.",
    );
    expect(home).toContain('href="/donate-phone.html"');
    expect(home).toContain("Donate a Phone");
  });

  it("covers the full donor decision sequence", () => {
    for (const copy of [
      "That old phone can still do some good.",
      "Three simple steps.",
      "Your phone. Your cause.",
      "Your data stays yours.",
      "$78,000+",
      "Questions? We’ve got answers.",
      "Ready to give your old phone a new purpose?",
      "Are you a nonprofit?",
    ]) {
      expect(home).toContain(copy);
    }
    expect(normalizedHome).toContain(
      "Raised for charitable campaigns by our team before Donate by Mail.",
    );
  });

  it("uses one concise numbered process and removes the redundant journey", () => {
    expect(home.match(/className="step-number"/g)).toHaveLength(3);
    expect(home).not.toContain("benefit-grid");
    expect(home).not.toContain("phone-journey");
    expect(home).not.toContain("journey-section");
  });

  it("uses local visual assets for the new editorial sections", () => {
    expect(home).toContain("/resources/home-unused-phone.webp");
    expect(home).toContain("/resources/home-phone-preparation.webp");
    expect(home).toContain("/resources/home-nonprofit-volunteers.webp");
    expect(home).toContain("/resources/donate-doggo.png");
  });

  it("preserves factual donor safeguards", () => {
    expect(home).toContain("We never ask for your passcode");
    expect(normalizedHome).toContain("purchase postage directly");
    expect(normalizedHome).toContain("not prepaid postage");
    expect(normalizedHome).toContain(
      "issued only after Donate by Mail physically receives and verifies",
    );
    expect(home).toContain("does not send money");
    expect(normalizedHome).toContain(
      "Raised for charitable campaigns by our team before Donate by Mail.",
    );
  });

  it("includes accurate metadata and an AI-readable site summary", () => {
    expect(metadata).toContain("Donate an Old Phone to a Charity You Choose");
    expect(metadata).toContain("https://donatebymail.org/");
    expect(llms).toContain("EIN 92-1515120");
    expect(llms).toContain("Donors pay their chosen carrier for postage");
    expect(llms).toContain("does not send money through Pledge");
  });

  it("keeps the editorial surface discoverable without competing with the donor CTA", () => {
    expect(home).toContain('href="/articles"');
    expect(metadata).toContain('application/ld+json');
    expect(metadata).toContain('"@type":"Organization"');
  });
});
