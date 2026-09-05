let csrfToken = "";
const MAX_CLIENT_JSON_BYTES = 512 * 1024;
const CLIENT_REQUEST_TIMEOUT_MS = 20_000;

function requestSignal(existing?: AbortSignal | null): AbortSignal | undefined {
  if (existing) return existing;
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return undefined;
  return AbortSignal.timeout(CLIENT_REQUEST_TIMEOUT_MS);
}

async function boundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_CLIENT_JSON_BYTES) throw new Error("response_too_large");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CLIENT_JSON_BYTES) {
        await reader.cancel("response_too_large");
        throw new Error("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function responseJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new Error("The secure service returned an unexpected response. Reload the page and try again.");
  }
  try {
    return JSON.parse(await boundedResponseText(response)) as T;
  } catch {
    throw new Error("The secure service returned an invalid response. Please reload and try again.");
  }
}

export async function publicApi<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: requestSignal(init?.signal),
    credentials: "include",
    cache: "no-store",
    headers: {
      ...init?.headers,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body = await responseJson<T>(response);
  if (!response.ok) {
    const message = (body as { message?: string }).message;
    throw new Error(message || "The request could not be completed.");
  }
  return body;
}

export async function sessionStatus(path = "/api/auth/session"): Promise<boolean> {
  try {
    const body = await publicApi<{ authenticated?: boolean; ok?: boolean }>(path);
    // The shared auth context reports `authenticated`; role-scoped session
    // endpoints intentionally return only `{ ok: true, user }` after their
    // authorization checks. Do not treat the generic auth context's
    // `authenticated: false` as a successful role session.
    return "authenticated" in body ? body.authenticated === true : body.ok === true;
  } catch {
    return false;
  }
}

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const body = await publicApi<{ csrfToken?: string }>("/api/auth/csrf");
  if (!body.csrfToken) throw new Error("Your session ended. Request a new sign-in link.");
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function authenticatedApi(path: string, init?: RequestInit) {
  const method = (init?.method || "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  const response = await fetch(path, {
    ...init,
    signal: requestSignal(init?.signal),
    credentials: "include",
    cache: "no-store",
    headers: {
      ...init?.headers,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(mutating ? { "x-csrf-token": await csrf() } : {}),
    },
  });
  const body = await responseJson<Record<string, any>>(response);
  if (!response.ok) {
    if (response.status === 401) csrfToken = "";
    throw new Error(body.message || "The secure request failed.");
  }
  return body;
}

export async function authenticatedUpload(path: string, form: FormData) {
  const response = await fetch(path, {
    method: "POST",
    body: form,
    credentials: "include",
    cache: "no-store",
    signal: requestSignal(),
    headers: { accept: "application/json", "x-csrf-token": await csrf() },
  });
  const body = await responseJson<Record<string, any>>(response);
  if (!response.ok) {
    if (response.status === 401) csrfToken = "";
    throw new Error(body.message || "The secure upload failed.");
  }
  return body;
}

export async function logout(): Promise<void> {
  await authenticatedApi("/api/auth/logout", { method: "POST" });
  csrfToken = "";
}
