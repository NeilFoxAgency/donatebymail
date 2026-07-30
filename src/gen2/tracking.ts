const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  if (secret.length < 32) throw new Error("Tracking secret is not configured securely.");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64Url(new Uint8Array(signature));
}

export function trackingMessage(donationId: string, nonce: string): string {
  return `tracking:${donationId}.${nonce}`;
}

export function claimMessage(donationId: string, nonce: string): string {
  return `claim:${donationId}.${nonce}`;
}

export async function createClaimToken(secret: string, donationId: string, nonce: string): Promise<string> {
  return hmac(secret, claimMessage(donationId, nonce));
}

export async function verifyClaimToken(secret: string, donationId: string, nonce: string, candidate: string): Promise<boolean> {
  const expected = await createClaimToken(secret, donationId, nonce);
  if (expected.length !== candidate.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  return difference === 0;
}

export function claimUrl(origin: string, publicId: string, token: string): string {
  const base = new URL("/account", origin);
  base.hash = new URLSearchParams({ donation: publicId, claim: token }).toString();
  return base.toString();
}

export async function createTrackingToken(
  secret: string,
  donationId: string,
  nonce: string,
): Promise<string> {
  return hmac(secret, trackingMessage(donationId, nonce));
}

export async function verifyTrackingToken(
  secret: string,
  donationId: string,
  nonce: string,
  candidate: string,
): Promise<boolean> {
  const expected = await createTrackingToken(secret, donationId, nonce);
  if (expected.length !== candidate.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  }
  return difference === 0;
}

export function trackingUrl(origin: string, publicId: string, token: string): string {
  const base = new URL("/track", origin);
  base.hash = new URLSearchParams({ id: publicId, token }).toString();
  return base.toString();
}
