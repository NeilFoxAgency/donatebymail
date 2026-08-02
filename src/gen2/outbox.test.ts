import { describe, expect, it, vi } from "vitest";
import {
  DirectOutboxDispatcher,
  InMemoryOutboxIdempotencyStore,
  outboxRetryDelaySeconds,
} from "./outbox";

describe("direct outbox dispatcher", () => {
  it("handles an event once per handler", async () => {
    const handle = vi.fn(async () => undefined);
    const dispatcher = new DirectOutboxDispatcher(
      [{ name: "notification", eventType: "donation.submitted", handle }],
      new InMemoryOutboxIdempotencyStore(),
    );
    const event = {
      id: "event-1",
      eventType: "donation.submitted",
      payload: { donationId: "donation-1" },
      attemptCount: 0,
    };

    expect(await dispatcher.dispatch(event)).toEqual({
      handled: ["notification"],
      skipped: [],
    });
    expect(await dispatcher.dispatch(event)).toEqual({
      handled: [],
      skipped: ["notification"],
    });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("uses bounded exponential retry delays", () => {
    expect(outboxRetryDelaySeconds(0)).toBe(30);
    expect(outboxRetryDelaySeconds(3)).toBe(240);
    expect(outboxRetryDelaySeconds(99)).toBe(3600);
  });
});
