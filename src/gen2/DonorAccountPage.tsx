import { FormEvent, useEffect, useRef, useState } from "react";
import { authenticatedApi, logout, publicApi, sessionStatus } from "./AuthSession";
import { TURNSTILE_SITE_KEY, TurnstileWidget } from "./TurnstileWidget";

type Donation = { id: string; publicId: string; status: string; charityName: string; createdAt: string; deviceCount: number; shipment?: { status: string; carrier?: string; trackingLastFour?: string; mailedAt?: string } };
export function DonorAccountPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [donations, setDonations] = useState<Donation[]>([]);
  const [message, setMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [magicLinkBusy, setMagicLinkBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const handoffStartedRef = useRef(false);
  async function load() {
    const requestId = ++loadRequestRef.current;
    const body = await authenticatedApi("/api/account/donations");
    if (requestId === loadRequestRef.current) setDonations(body.account.donations || []);
  }
  useEffect(() => {
    mountedRef.current = true;
    if (handoffStartedRef.current) return () => { mountedRef.current = false; };
    handoffStartedRef.current = true;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const publicId = fragment.get("donation"), claimToken = fragment.get("claim");
    void (async () => {
      try {
        if (publicId && claimToken) {
          const body = await publicApi<{ claimed?: boolean }>("/api/account/claim-intents", { method: "POST", body: JSON.stringify({ publicId, claimToken }) });
          if (mountedRef.current && body.claimed) {
            setMessage("Donation claimed.");
          }
          // The unauthenticated handoff also returns a successful pending
          // claim (`claimed: false`) and sets a server cookie. Clear the
          // capability after either successful response, but preserve it when
          // the request throws so a transient failure remains retryable.
          if (mountedRef.current) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        } else if (publicId || claimToken) {
          // Malformed fragments contain no usable capability and should not
          // remain in the address bar.
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        }
      } catch (error) {
        if (mountedRef.current) setMessage(error instanceof Error ? error.message : "The donation claim could not be continued.");
      } finally {
        const nextAuthenticated = await sessionStatus("/api/account/session");
        if (mountedRef.current) setAuthenticated(nextAuthenticated);
      }
    })();
    return () => { mountedRef.current = false; loadRequestRef.current += 1; };
  }, []);
  useEffect(() => { if (authenticated === false) { loadRequestRef.current += 1; setDonations([]); } }, [authenticated]);
  useEffect(() => { if (authenticated) load().catch((error) => { setMessage(error.message); setAuthenticated(false); }); }, [authenticated]);
  if (authenticated === null) return <main className="operations-main"><section className="operations-shell compact"><p role="status">Checking your secure donor session…</p></section></main>;
  if (!authenticated) return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Donor account</p><h1>Track your claimed donations</h1><p>We’ll send a one-time secure sign-in link. If you arrived from a donation claim email, your claim will continue automatically after sign-in.</p><form onSubmit={async (event) => { event.preventDefault(); if (magicLinkBusy) return; setMagicLinkBusy(true); try { if (TURNSTILE_SITE_KEY && !turnstileToken) throw new Error("Please complete the security verification."); const body = await publicApi<{ message?: string }>("/api/account/auth/magic-link", { method: "POST", body: JSON.stringify({ email, turnstileToken }) }); setMessage(body.message || "If the address can sign in, a secure link is on its way."); } catch (error) { setMessage(error instanceof Error ? error.message : "We could not request a secure link. Please try again."); } finally { setMagicLinkBusy(false); } }}><label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={magicLinkBusy} /></label><TurnstileWidget action="auth_magic_link" onToken={setTurnstileToken} /><button className="button primary" disabled={magicLinkBusy}>{magicLinkBusy ? "Sending…" : "Email secure sign-in link"}</button></form>{message && <p role="status">{message}</p>}</section></main>;
  return <main className="operations-main"><section className="operations-shell"><div className="staff-heading"><div><p className="kicker">Your donations</p><h1>Donation account</h1></div><button className="button text" disabled={logoutBusy} onClick={async () => { if (logoutBusy) return; setLogoutBusy(true); try { await logout(); setAuthenticated(false); } catch (error) { setMessage(error instanceof Error ? error.message : "Sign out failed. Please try again."); setLogoutBusy(false); } }}>{logoutBusy ? "Signing out…" : "Sign out"}</button></div>{message && <p role="status">{message}</p>}<ClaimForm onClaimed={async () => { await load(); setMessage("Donation claimed."); }} /><div className="account-grid">{donations.length ? donations.map((donation) => <article className="account-card" key={donation.id}><p className="kicker">{donation.status.replace(/_/g, " ")}</p><h2>{donation.publicId}</h2><p>Supporting <strong>{donation.charityName}</strong><br />{donation.deviceCount} device{donation.deviceCount === 1 ? "" : "s"} · Started {new Date(donation.createdAt).toLocaleDateString()}</p>{donation.shipment ? <p>Shipment: {donation.shipment.status}{donation.shipment.carrier ? ` via ${donation.shipment.carrier}` : ""}{donation.shipment.trackingLastFour ? ` · ending ${donation.shipment.trackingLastFour}` : ""}</p> : <MailedForm onSubmit={async (carrier, trackingNumber) => { await authenticatedApi(`/api/account/donations/${donation.id}/mailed`, { method: "POST", body: JSON.stringify({ carrier, trackingNumber }) }); await load(); setMessage("Shipping update saved."); }} />}</article>) : <div className="empty-panel"><h2>No claimed donations yet</h2><p>Use the one-time claim link or reference from a donation confirmation.</p></div>}</div></section></main>;
}

function ClaimForm({ onClaimed }: { onClaimed: () => Promise<void> }) {
  const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  return <form className="inline-ops" onSubmit={async (event) => { event.preventDefault(); if (saving) return; setMessage(""); setSaving(true); const form = new FormData(event.currentTarget); try { await authenticatedApi("/api/account/claims", { method: "POST", body: JSON.stringify({ publicId: form.get("publicId"), claimToken: form.get("claimToken") }) }); event.currentTarget.reset(); await onClaimed(); } catch (error) { setMessage(error instanceof Error ? error.message : "The donation could not be claimed."); } finally { setSaving(false); } }}><h2>Claim another donation</h2><label>Donation ID<input name="publicId" required /></label><label>One-time claim reference<input name="claimToken" autoComplete="off" required /></label><button disabled={saving}>{saving ? "Claiming…" : "Claim donation"}</button>{message && <p role="status">{message}</p>}</form>;
}

function MailedForm({ onSubmit }: { onSubmit: (carrier: string, tracking: string) => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  return <form className="inline-ops" onSubmit={async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (saving) return; setMessage(""); setSaving(true); const f = new FormData(event.currentTarget); try { await onSubmit(String(f.get("carrier") || ""), String(f.get("tracking") || "")); } catch (error) { setMessage(error instanceof Error ? error.message : "The shipping update could not be saved."); } finally { setSaving(false); } }}><h3>Already mailed it?</h3><label>Carrier (optional)<input name="carrier" placeholder="USPS, UPS, FedEx…" disabled={saving} /></label><label>Tracking number (optional)<input name="tracking" autoComplete="off" disabled={saving} /></label><button disabled={saving}>{saving ? "Saving…" : "Mark as mailed"}</button><small>Carrier delivery does not count as staff verification of receipt.</small>{message && <p role="alert">{message}</p>}</form>;
}
