export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_PIXELS = 30_000_000;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type SanitizedImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

function imageDimensionsAllowed(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function sanitizeJpeg(bytes: Uint8Array): SanitizedImage {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
    throw new Error("invalid_image_signature");
  const kept: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("malformed_jpeg");
    let markerStart = offset;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) { kept.push(bytes.slice(markerStart, offset)); break; }
    if (marker === 0xda) { kept.push(bytes.slice(markerStart)); offset = bytes.length; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.slice(markerStart, offset));
      continue;
    }
    if (offset + 2 > bytes.length) throw new Error("malformed_jpeg");
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error("malformed_jpeg");
    const segmentEnd = offset + segmentLength;
    const isStartOfFrame = [0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 7) throw new Error("malformed_jpeg");
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
    }
    const containsMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!containsMetadata) kept.push(bytes.slice(markerStart, segmentEnd));
    offset = segmentEnd;
  }
  if (!imageDimensionsAllowed(width, height)) throw new Error("invalid_image_dimensions");
  return { bytes: concat(kept), width, height, mimeType: "image/jpeg" };
}

const PNG_SIGNATURE = new Uint8Array([137,80,78,71,13,10,26,10]);
const PNG_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const PNG_SAFE_ANCILLARY_CHUNKS = new Set(["tRNS"]);

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function sanitizePng(bytes: Uint8Array): SanitizedImage {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value))
    throw new Error("invalid_image_signature");
  const parts = [bytes.slice(0, 8)];
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let paletteEntries = 0;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("malformed_png");
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
    if (type === "IHDR") {
      if (length !== 13 || width || height) throw new Error("malformed_png");
      width = readU32BE(bytes, offset + 8);
      height = readU32BE(bytes, offset + 12);
      colorType = bytes[offset + 17];
    }
    if (type === "PLTE") {
      if (length < 3 || length > 768 || length % 3 !== 0) throw new Error("malformed_png");
      paletteEntries = length / 3;
    }
    if (type === "tRNS") {
      const validTransparency = (colorType === 0 && length === 2)
        || (colorType === 2 && length === 6)
        || (colorType === 3 && length >= 1 && length <= paletteEntries);
      if (!validTransparency) throw new Error("malformed_png");
    }
    if (PNG_CRITICAL_CHUNKS.has(type) || PNG_SAFE_ANCILLARY_CHUNKS.has(type)) {
      parts.push(bytes.slice(offset, end));
    } else if (type[0] === type[0]?.toUpperCase()) {
      throw new Error("unsupported_png_chunk");
    }
    offset = end;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended || offset !== bytes.length) throw new Error("malformed_png");
  if (!imageDimensionsAllowed(width, height)) throw new Error("invalid_image_dimensions");
  return { bytes: concat(parts), width, height, mimeType: "image/png" };
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function writeU32LE(value: number): Uint8Array {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function sanitizeWebp(bytes: Uint8Array): SanitizedImage {
  const decoder = new TextDecoder();
  if (bytes.length < 20 || decoder.decode(bytes.slice(0, 4)) !== "RIFF" || decoder.decode(bytes.slice(8, 12)) !== "WEBP")
    throw new Error("invalid_image_signature");
  const declaredLength = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  if (declaredLength !== bytes.length - 8) throw new Error("malformed_webp");
  const parts: Uint8Array[] = [];
  let offset = 12;
  let width = 0;
  let height = 0;
  let hasImageData = false;
  while (offset + 8 <= bytes.length) {
    const type = decoder.decode(bytes.slice(offset, offset + 4));
    const length = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    const paddedLength = length + (length % 2);
    const end = offset + 8 + paddedLength;
    if (length < 0 || end > bytes.length) throw new Error("malformed_webp");
    const payload = bytes.slice(offset + 8, offset + 8 + length);
    if (type === "VP8X") {
      if (length < 10) throw new Error("malformed_webp");
      if (payload[0] & 0x02) throw new Error("animated_webp_not_supported");
      width = readU24LE(payload, 4) + 1;
      height = readU24LE(payload, 7) + 1;
      const sanitized = bytes.slice(offset, end);
      sanitized[8] &= ~(0x20 | 0x08 | 0x04);
      parts.push(sanitized);
    } else if (type === "VP8 ") {
      if (length < 10 || payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) throw new Error("malformed_webp");
      width = (payload[6] | (payload[7] << 8)) & 0x3fff;
      height = (payload[8] | (payload[9] << 8)) & 0x3fff;
      hasImageData = true;
      parts.push(bytes.slice(offset, end));
    } else if (type === "VP8L") {
      if (length < 5 || payload[0] !== 0x2f) throw new Error("malformed_webp");
      width = 1 + (((payload[2] & 0x3f) << 8) | payload[1]);
      height = 1 + (((payload[4] & 0x0f) << 10) | (payload[3] << 2) | (payload[2] >> 6));
      hasImageData = true;
      parts.push(bytes.slice(offset, end));
    } else if (type === "ALPH") {
      parts.push(bytes.slice(offset, end));
    }
    offset = end;
  }
  if (offset !== bytes.length || !hasImageData || !imageDimensionsAllowed(width, height)) throw new Error("invalid_image_dimensions");
  const chunks = concat(parts);
  const result = concat([new TextEncoder().encode("RIFF"), writeU32LE(chunks.length + 4), new TextEncoder().encode("WEBP"), chunks]);
  return { bytes: result, width, height, mimeType: "image/webp" };
}

export function sanitizeImageUpload(mimeType: string, bytes: Uint8Array): SanitizedImage {
  if (!ALLOWED_IMAGE_TYPES.has(mimeType) || bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES)
    throw new Error("invalid_image_upload");
  if (mimeType === "image/jpeg") return sanitizeJpeg(bytes);
  if (mimeType === "image/png") return sanitizePng(bytes);
  return sanitizeWebp(bytes);
}
