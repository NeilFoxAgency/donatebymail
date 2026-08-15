import { describe, expect, it } from "vitest";
import { safeJsonLdText } from "./jsonLd";

describe("article JSON-LD serialization", () => {
  it("cannot terminate the script element with article-controlled text", () => {
    const serialized = safeJsonLdText({ description: "</script><script>alert(1)</script>&" });
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
    expect(JSON.parse(serialized).description).toBe("</script><script>alert(1)</script>&");
  });
});
