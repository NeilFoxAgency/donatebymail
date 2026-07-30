let csrfToken = "";

export async function responseJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      "This beta page needs an active Cloudflare Access session. Reload the page and sign in before trying again.",
    );
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error("The secure service returned an invalid response. Please reload and try again.");
  }
}

export async function publicApi<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
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
    const body = await publicApi<{ authenticated?: boolean }>(path);
    return body.authenticated === true;
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
    credentials: "include",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(mutating ? { "x-csrf-token": await csrf() } : {}),
      ...init?.headers,
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
