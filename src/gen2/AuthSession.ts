let csrfToken = "";

export async function sessionStatus(path = "/api/auth/session"): Promise<boolean> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  return response.ok;
}

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Your session ended. Request a new sign-in link.");
  const body = await response.json() as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function authenticatedApi(path: string, init?: RequestInit) {
  const method = (init?.method || "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(mutating ? { "x-csrf-token": await csrf() } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json() as Record<string, any>;
  if (!response.ok) {
    if (response.status === 401) csrfToken = "";
    throw new Error(body.message || "The secure request failed.");
  }
  return body;
}

export async function logout(): Promise<void> {
  await authenticatedApi("/api/auth/logout", { method: "POST" });
  csrfToken = "";
}
