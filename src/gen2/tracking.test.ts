import { describe, expect, it } from "vitest";
import {
  createTrackingToken,
  trackingMessage,
  trackingUrl,
  verifyTrackingToken,
} from "./tracking";

describe("donation tracking capabilities", () => {
  const secret = "a-secure-beta-secret-with-more-than-thirty-two-characters";
  const id = "00000000-0000-4000-8000-000000000001";
  const nonce = "00000000-0000-4000-8000-000000000002";

  it("binds a token to both donation and nonce", async () => {
    const token = await createTrackingToken(secret, id, nonce);
    expect(token).toHaveLength(43);
    await expect(verifyTrackingToken(secret, id, nonce, token)).resolves.toBe(true);
    await expect(
      verifyTrackingToken(secret, id.replace(/1$/, "3"), nonce, token),
    ).resolves.toBe(false);
    expect(trackingMessage(id, nonce)).toBe(`tracking:${id}.${nonce}`);
  });

  it("keeps the capability out of the request path", async () => {
    const token = await createTrackingToken(secret, id, nonce);
    const url = new URL(trackingUrl("https://beta.donatebymail.org", "DBM-20260728-ABCDEF12", token));
    expect(url.pathname).toBe("/track");
    expect(url.search).toBe("");
    expect(url.hash).toContain("token=");
  });
});
