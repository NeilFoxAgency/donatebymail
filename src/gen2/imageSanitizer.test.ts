import { describe, expect, it } from "vitest";
import { sanitizeImageUpload } from "./imageSanitizer";

function chunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [(length >>> 24) & 255,(length >>> 16) & 255,(length >>> 8) & 255,length & 255,
    ...new TextEncoder().encode(type),...data,0,0,0,0];
}

describe("partner image sanitizer", () => {
  it("removes PNG text metadata and preserves dimensions", () => {
    const ihdr = [0,0,2,0,0,0,1,0,8,2,0,0,0];
    const source = new Uint8Array([137,80,78,71,13,10,26,10,...chunk("IHDR",ihdr),...chunk("tEXt",[65,0,66]),...chunk("IEND",[])]);
    const result = sanitizeImageUpload("image/png", source);
    expect(result.width).toBe(512);
    expect(result.height).toBe(256);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("tEXt");
  });

  it("removes JPEG APP metadata", () => {
    const source = new Uint8Array([0xff,0xd8,0xff,0xe1,0,6,69,88,73,70,
      0xff,0xc0,0,11,8,0,100,0,200,3,1,17,0,0xff,0xda,0,8,1,1,0,0,63,0,0xff,0xd9]);
    const result = sanitizeImageUpload("image/jpeg", source);
    expect([result.width,result.height]).toEqual([200,100]);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("EXIF");
  });

  it("rejects excessive pixel counts and spoofed formats", () => {
    const ihdr = [0,0,31,64,0,0,31,64,8,2,0,0,0];
    const huge = new Uint8Array([137,80,78,71,13,10,26,10,...chunk("IHDR",ihdr),...chunk("IEND",[])]);
    expect(() => sanitizeImageUpload("image/png", huge)).toThrow("invalid_image_dimensions");
    expect(() => sanitizeImageUpload("image/png", new Uint8Array([1,2,3]))).toThrow();
  });

  it("rejects data appended after a JPEG end marker", () => {
    const source = new Uint8Array([0xff,0xd8,0xff,0xc0,0,11,8,0,100,0,200,3,1,17,0,
      0xff,0xda,0,8,1,1,0,0,63,0,0xff,0xd9,60,115,99,114,105,112,116,62]);
    expect(() => sanitizeImageUpload("image/jpeg", source)).toThrow("invalid_image_signature");
  });

  it("removes unrecognized ancillary PNG chunks", () => {
    const ihdr = [0,0,0,32,0,0,0,32,8,2,0,0,0];
    const source = new Uint8Array([137,80,78,71,13,10,26,10,...chunk("IHDR",ihdr),
      ...chunk("vpAg",[60,115,99,114,105,112,116,62]),...chunk("IEND",[])]);
    const result = sanitizeImageUpload("image/png", source);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("vpAg");
  });
});
