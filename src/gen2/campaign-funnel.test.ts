import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/gen2/CampaignPage.tsx", "utf8");
const partner = readFileSync("src/gen2/PartnerPage.tsx", "utf8");
const worker = readFileSync("src/worker.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260730041632_campaign_supporting_assets.sql", "utf8");

describe("campaign mini-funnel", () => {
  it("keeps the verified nonprofit and donor CTA prominent", () => {
    expect(page).toContain("Verified nonprofit");
    expect(page).toContain("Choose a cause before you send your phone.");
    expect(page.match(/href=\{`\/donate-phone\?campaign=/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain("We never ask for your phone passcode.");
  });

  it("supports safe partner-controlled text and two reviewed image slots", () => {
    expect(partner).toContain("Story image (optional)");
    expect(partner).toContain("supportingAssetId");
    expect(worker).toContain('"supporting_image"');
    expect(worker).toContain("CAMPAIGN_ASSET_MAX_BYTES");
    expect(migration).toContain("supporting_asset_id");
    expect(migration).toContain("asset_kind='supporting_image'");
    expect(migration).toContain("r.hero_asset_id=a.id or r.supporting_asset_id=a.id");
  });
});
