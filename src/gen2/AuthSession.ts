export function consumeAccessToken(storageKey: string, cleanPath: string): string {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const incoming = hash.get("access_token");
  if (incoming) {
    sessionStorage.setItem(storageKey, incoming);
    history.replaceState({}, "", cleanPath);
    return incoming;
  }
  return sessionStorage.getItem(storageKey) || "";
}

export async function authenticatedApi(path: string, token: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const body = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(body.message || "The secure request failed.");
  return body;
}
