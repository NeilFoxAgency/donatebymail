import { describe, expect, it } from "vitest";
import { hasValidCampaignImageSignature, sha256BytesHex } from "./worker";

describe("campaign asset integrity", () => {
  it("rejects MIME spoofing and accepts supported image signatures", () => {
    expect(hasValidCampaignImageSignature("image/png", new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(hasValidCampaignImageSignature("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(hasValidCampaignImageSignature("image/png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(hasValidCampaignImageSignature("image/webp", new TextEncoder().encode("RIFFxxxxWEBP"))).toBe(true);
    expect(hasValidCampaignImageSignature("image/gif", new Uint8Array([71, 73, 70, 56]))).toBe(false);
  });

  it("derives different digests from different reviewed bytes", async () => {
    const first = await sha256BytesHex(new Uint8Array([1, 2, 3]));
    const second = await sha256BytesHex(new Uint8Array([1, 2, 4]));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});
