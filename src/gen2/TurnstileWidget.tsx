import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: string;
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

export const TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || "";

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dbm-turnstile-script="true"]');
    if (existing?.dataset.failed === "true") existing.remove();
    const script = existing?.dataset.failed === "true" ? null : existing;
    if (script) {
      const finish = () => window.turnstile ? resolve() : reject(new Error("Turnstile API unavailable"));
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", () => {
        script.dataset.failed = "true";
        script.remove();
        reject(new Error("load failed"));
      }, { once: true });
      // A component can mount after another widget has already loaded the
      // shared script; in that case the load event has already fired.
      if ((script as HTMLScriptElement & { readyState?: string }).readyState === "complete") queueMicrotask(finish);
      return;
    }
    const next = document.createElement("script");
    next.async = true;
    next.defer = true;
    next.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    next.dataset.dbmTurnstileScript = "true";
    next.addEventListener("load", () => window.turnstile ? resolve() : reject(new Error("Turnstile API unavailable")), { once: true });
    next.addEventListener("error", () => {
      next.dataset.failed = "true";
      next.remove();
      reject(new Error("load failed"));
    }, { once: true });
    document.head.appendChild(next);
  }).catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });
  return turnstileScriptPromise;
}

export function TurnstileWidget({
  action,
  onToken,
  onResetReady,
}: {
  action: "donation_submit" | "partner_application" | "auth_magic_link";
  onToken: (token: string) => void;
  onResetReady?: (reset: () => void) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(onToken);
  const [loadError, setLoadError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  tokenRef.current = onToken;
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return;
    let widgetId: string | null = null;
    let disposed = false;
    setLoadError(false);
    setErrorMessage("");
    const reset = () => {
      tokenRef.current("");
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    };
    onResetReady?.(reset);
    void loadTurnstileScript()
      .then(() => {
        if (disposed) return;
        const container = containerRef.current;
        const api = window.turnstile;
        if (!container || !api) throw new Error("Turnstile API unavailable");
        try {
          container.replaceChildren();
          widgetId = api.render(container, {
            sitekey: TURNSTILE_SITE_KEY,
            action,
            callback: (token) => tokenRef.current(token),
            "expired-callback": () => tokenRef.current(""),
            "error-callback": () => {
              tokenRef.current("");
              if (disposed) return;
              setLoadError(true);
              setErrorMessage("Security verification failed. Please retry the verification.");
            },
          });
          if (!widgetId) throw new Error("Turnstile render returned no widget ID");
        } catch {
          throw new Error("render failed");
        }
      })
      .catch(() => {
        if (disposed) return;
        tokenRef.current("");
        setLoadError(true);
        setErrorMessage("Security verification could not load. Check your connection and try again.");
      });
    return () => {
      disposed = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, loadAttempt, onResetReady]);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div className="turnstile-field" aria-label="Security verification">
    <p>Security verification</p>
    {loadError && <>
      <button type="button" onClick={() => { setLoadError(false); setLoadAttempt((value) => value + 1); }}>Retry security verification</button>
    </>}
    {errorMessage && <p role="alert">{errorMessage}</p>}
    <div ref={containerRef} data-action={action} hidden={loadError} />
  </div>;
}
