import { describe, expect, it } from "vitest";
import { resolveSubmissionAttempt, submissionIntentFingerprint } from "./submissionAttempt";

const intent = {
  donor: { firstName: "A", middleName: "", lastName: "Donor", email: "a@example.test", address1: "1 Main", address2: "", city: "X", state: "FL", zip: "34741", country: "US", marketingEmailConsent: true },
  shippingMethod: "label" as const,
  devices: [{ id: "phone", brand: "Apple" as const, model: "Phone", age: "2-3 years" as const, condition: "Good" as const, storage: "128 GB" as const, powersOn: true, unlocked: true }],
  charity: { pledgeId: "3685b542-61d5-45da-9580-162dca725966", name: "Charity" },
};

describe("submission attempt", () => {
  it("freezes all submission-time values across a lost-response retry", () => {
    let tick = 0;
    const create = (current: ReturnType<typeof resolveSubmissionAttempt> | null) => resolveSubmissionAttempt(
      current, submissionIntentFingerprint(intent), true, () => `key-${++tick}`, () => `id-${tick}`,
      () => `2026-07-29T00:00:0${tick}.000Z`,
    );
    const first = create(null), retry = create(first);
    expect(retry).toEqual(first);
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
    expect(retry.marketingConsentAt).toBe(first.createdAt);
  });

  it("creates a new attempt when donor data changes", () => {
    const first = resolveSubmissionAttempt(null, submissionIntentFingerprint(intent), true, () => "key-1", () => "id-1", () => "time-1");
    const changed = { ...intent, donor: { ...intent.donor, lastName: "Changed" } };
    const second = resolveSubmissionAttempt(first, submissionIntentFingerprint(changed), true, () => "key-2", () => "id-2", () => "time-2");
    expect(second.key).toBe("key-2");
    expect(second).not.toEqual(first);
  });
});
