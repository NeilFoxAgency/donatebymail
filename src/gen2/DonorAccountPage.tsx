import { FormEvent, useEffect, useState } from "react";
import { authenticatedApi, logout, publicApi, sessionStatus } from "./AuthSession";

type Donation = { id: string; publicId: string; status: string; charityName: string; createdAt: string; deviceCount: number; shipment?: { status: string; carrier?: string; trackingLastFour?: string; mailedAt?: string } };
export function DonorAccountPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [donations, setDonations] = useState<Donation[]>([]);
  const [message, setMessage] = useState("");
  async function load() {
    const body = await authenticatedApi("/api/account/donations");
    setDonations(body.account.donations || []);
  }
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const publicId = fragment.get("donation"), claimToken = fragment.get("claim");
    void (async () => {
      try {
        if (publicId || claimToken) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        if (publicId && claimToken) {
          const body = await publicApi<{ claimed?: boolean }>("/api/account/claim-intents", { method: "POST", body: JSON.stringify({ publicId, claimToken }) });
          if (body.claimed) setMessage("Donation claimed.");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "The donation claim could not be continued.");
      } finally {
        setAuthenticated(await sessionStatus("/api/account/session"));
      }
    })();
  }, []);
  useEffect(() => { if (authenticated) load().catch((error) => { setMessage(error.message); setAuthenticated(false); }); }, [authenticated]);
  if (!authenticated) return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Donor account</p><h1>Track your claimed donations</h1><p>We’ll send a one-time secure sign-in link. If you arrived from a donation claim email, your claim will continue automatically after sign-in.</p><form onSubmit={async (event) => { event.preventDefault(); try { const body = await publicApi<{ message?: string }>("/api/account/auth/magic-link", { method: "POST", body: JSON.stringify({ email }) }); setMessage(body.message || "If the address can sign in, a secure link is on its way."); } catch (error) { setMessage(error instanceof Error ? error.message : "We could not request a secure link. Please try again."); } }}><label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><button className="button primary">Email secure sign-in link</button></form>{message && <p role="status">{message}</p>}</section></main>;
  return <main className="operations-main"><section className="operations-shell"><div className="staff-heading"><div><p className="kicker">Your donations</p><h1>Donation account</h1></div><button className="button text" onClick={() => void logout().finally(() => setAuthenticated(false))}>Sign out</button></div>{message && <p role="status">{message}</p>}<ClaimForm onClaimed={async () => { await load(); setMessage("Donation claimed."); }} /><div className="account-grid">{donations.length ? donations.map((donation) => <article className="account-card" key={donation.id}><p className="kicker">{donation.status.replace(/_/g, " ")}</p><h2>{donation.publicId}</h2><p>Supporting <strong>{donation.charityName}</strong><br />{donation.deviceCount} device{donation.deviceCount === 1 ? "" : "s"} · Started {new Date(donation.createdAt).toLocaleDateString()}</p>{donation.shipment ? <p>Shipment: {donation.shipment.status}{donation.shipment.carrier ? ` via ${donation.shipment.carrier}` : ""}{donation.shipment.trackingLastFour ? ` · ending ${donation.shipment.trackingLastFour}` : ""}</p> : <MailedForm onSubmit={async (carrier, trackingNumber) => { await authenticatedApi(`/api/account/donations/${donation.id}/mailed`, { method: "POST", body: JSON.stringify({ carrier, trackingNumber }) }); await load(); setMessage("Shipping update saved."); }} />}</article>) : <div className="empty-panel"><h2>No claimed donations yet</h2><p>Use the one-time claim link or reference from a donation confirmation.</p></div>}</div></section></main>;
}

function ClaimForm({ onClaimed }: { onClaimed: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  return <form className="inline-ops" onSubmit={async (event) => { event.preventDefault(); setMessage(""); const form = new FormData(event.currentTarget); try { await authenticatedApi("/api/account/claims", { method: "POST", body: JSON.stringify({ publicId: form.get("publicId"), claimToken: form.get("claimToken") }) }); event.currentTarget.reset(); await onClaimed(); } catch (error) { setMessage(error instanceof Error ? error.message : "The donation could not be claimed."); } }}><h2>Claim another donation</h2><label>Donation ID<input name="publicId" required /></label><label>One-time claim reference<input name="claimToken" autoComplete="off" required /></label><button>Claim donation</button>{message && <p role="status">{message}</p>}</form>;
}

function MailedForm({ onSubmit }: { onSubmit: (carrier: string, tracking: string) => Promise<void> }) {
  return <form className="inline-ops" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const f = new FormData(event.currentTarget); void onSubmit(String(f.get("carrier") || ""), String(f.get("tracking") || "")); }}><h3>Already mailed it?</h3><label>Carrier (optional)<input name="carrier" placeholder="USPS, UPS, FedEx…" /></label><label>Tracking number (optional)<input name="tracking" autoComplete="off" /></label><button>Mark as mailed</button><small>Carrier delivery does not count as staff verification of receipt.</small></form>;
}
