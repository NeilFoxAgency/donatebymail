const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const SESSION_COOKIE = "__Host-dbm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type BffSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  absoluteExpiresAt: number;
  csrf: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function keyFor(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("BFF session secret must be at least 32 characters.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`dbm:bff-session:v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealSession(session: BffSession, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret), encoder.encode(JSON.stringify(session)));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openSession(value: string, secret: string, now = Date.now()): Promise<BffSession | null> {
  try {
    const [version, iv, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !ciphertext) return null;
    const ivBytes = base64UrlToBytes(iv), cipherBytes = base64UrlToBytes(ciphertext);
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes.buffer as ArrayBuffer }, await keyFor(secret), cipherBytes.buffer as ArrayBuffer);
    const session = JSON.parse(decoder.decode(clear)) as BffSession;
    if (!session.accessToken || !session.refreshToken || !session.csrf || session.absoluteExpiresAt <= now) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, maxAge = SESSION_MAX_AGE_SECONDS): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return sessionCookie("", 0);
}

export function cookieValue(cookieHeader: string | null, name = SESSION_COOKIE): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function constantTimeEqual(left: string | null, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
