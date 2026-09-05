import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const articles = readFileSync("src/gen2/ArticlesPage.tsx", "utf8");
const campaign = readFileSync("src/gen2/CampaignPage.tsx", "utf8");

describe("browser API boundaries", () => {
  it("routes legacy donor and article API calls through bounded publicApi", () => {
    expect(app).toContain('import { publicApi, sessionStatus } from "./gen2/AuthSession";');
    expect(app).toContain("publicApi<SubmissionResponse>(\"/api/donations\"");
    expect(app).toContain("void sessionStatus().then(setSignedIn)");
    expect(app).not.toMatch(/fetch\(/);
    expect(articles).toContain('import { publicApi } from "./AuthSession";');
    expect(articles).toContain("publicApi<{ articles?: ArticleSummary[]; article?: Article }>(endpoint)");
    expect(articles).not.toMatch(/fetch\(/);
    expect(campaign).toContain('import { publicApi } from "./AuthSession";');
    expect(campaign).toContain("publicApi<{ ok?: boolean }>");
    expect(campaign).not.toMatch(/fetch\(/);
  });
});
