import { describe, expect, it } from "vitest";
import { countries } from "./countries";

describe("country options", () => {
  it("offers the complete ISO country list with the United States available", () => {
    expect(countries).toHaveLength(249);
    expect(countries).toContainEqual({ code: "US", name: "United States" });
    expect(new Set(countries.map(({ code }) => code)).size).toBe(249);
  });
});
