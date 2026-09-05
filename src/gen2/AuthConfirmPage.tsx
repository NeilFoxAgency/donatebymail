import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { publicApi } from "./AuthSession";
import { safeInternalRedirect } from "./urlSafety";

export function AuthConfirmPage() {
  const credential = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return {
      state: query.get("state") || "",
      code: fragment.get("code") || query.get("code") || "",
      tokenHash: fragment.get("token_hash") || "",
      invalid: query.get("error") === "invalid",
    };
  }, []);
  const [status,setStatus] = useState<"ready" | "working" | "error">(credential.invalid ? "error" : "ready");
  const [message,setMessage] = useState(credential.invalid ? "This sign-in link is invalid or incomplete." : "");

  useEffect(() => {
    // One-time credentials remain in memory only. Removing them immediately also
    // keeps copied URLs, history, analytics, and referrers free of auth material.
    window.history.replaceState({}, "", "/auth/confirm");
  }, []);

  async function confirm() {
    if (!credential.state || (!credential.code && !credential.tokenHash)) {
      setStatus("error"); setMessage("This sign-in link is invalid or incomplete."); return;
    }
    setStatus("working"); setMessage("");
    try {
      const result = await publicApi<{ redirect: string }>("/api/auth/confirm", {
        method: "POST",
        body: JSON.stringify({ state: credential.state, code: credential.code || undefined, tokenHash: credential.tokenHash || undefined }),
      });
      window.location.assign(safeInternalRedirect(result.redirect, "/login"));
    } catch (error) {
      setStatus("error"); setMessage(error instanceof Error ? error.message : "The sign-in link could not be confirmed.");
    }
  }

  return <main className="auth-confirm-page"><section className="auth-confirm-card" aria-labelledby="confirm-title">
    <LockKeyhole aria-hidden="true" />
    <p className="kicker">Secure sign in</p>
    <h1 id="confirm-title">Confirm this sign-in</h1>
    <p>Email preview services sometimes open links automatically. This final confirmation makes sure only you use the one-time link.</p>
    {status === "error" && <p className="form-error" role="alert">{message}</p>}
    <button className="button primary" type="button" disabled={status === "working" || status === "error"} onClick={() => void confirm()}>
      <CheckCircle2 aria-hidden="true" />{status === "working" ? "Signing you in…" : "Continue securely"}
    </button>
    {status === "error" && <p><a href="/partner">Request a new partner link</a> or <a href="/staff">request a new staff link</a>.</p>}
  </section></main>;
}
