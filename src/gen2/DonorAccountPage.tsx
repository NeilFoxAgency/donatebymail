import { FormEvent, useEffect, useState } from "react";
import { authenticatedApi, logout, sessionStatus } from "./AuthSession";

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
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    const publicId = fragment.get("donation"), claimToken = fragment.get("claim");
    if (publicId || claimToken) history.replaceState(null, "", `${location.pathname}${location.search}`);
    const handoff = publicId && claimToken
      ? fetch("/api/account/claim-intents", { method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ publicId, claimToken }) })
          .then(async (response) => {
            const body = await response.json() as { claimed?: boolean; message?: string };
            if (!response.ok) throw new Error(body.message || "The claim link could not be accepted.");
            if (body.claimed) setMessage("Donation claimed.");
          })
      : Promise.resolve();
    void handoff.catch((error) => setMessage(error.message)).finally(() => {
      sessionStatus("/api/account/session").then(setAuthenticated).catch(() => setAuthenticated(false));
    });
  }, []);
  useEffect(() => { if (authenticated) load().catch((error) => { setMessage(error.message); setAuthenticated(false); }); }, [authenticated]);
  if (!authenticated) return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Donor account</p><h1>Track your claimed donations</h1><p>We’ll send a one-time secure sign-in link. If you arrived from a donation claim email, your claim will continue automatically after sign-in.</p><form onSubmit={async (event) => { event.preventDefault(); const response = await fetch("/api/account/auth/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); const body = await response.json() as { message: string }; setMessage(body.message); }}><label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><button className="button primary">Email secure sign-in link</button></form>{message && <p role="status">{message}</p>}</section></main>;
  return <main className="operations-main"><section className="operations-shell"><div className="staff-heading"><div><p className="kicker">Your donations</p><h1>Donation account</h1></div><button className="button text" onClick={() => void logout().finally(() => setAuthenticated(false))}>Sign out</button></div>{message && <p role="status">{message}</p>}<ClaimForm onClaimed={async () => { await load(); setMessage("Donation claimed."); }} /><div className="account-grid">{donations.length ? donations.map((donation) => <article className="account-card" key={donation.id}><p className="kicker">{donation.status.replace(/_/g, " ")}</p><h2>{donation.publicId}</h2><p>Supporting <strong>{donation.charityName}</strong><br />{donation.deviceCount} device{donation.deviceCount === 1 ? "" : "s"} · Started {new Date(donation.createdAt).toLocaleDateString()}</p>{donation.shipment ? <p>Shipment: {donation.shipment.status}{donation.shipment.carrier ? ` via ${donation.shipment.carrier}` : ""}{donation.shipment.trackingLastFour ? ` · ending ${donation.shipment.trackingLastFour}` : ""}</p> : <MailedForm onSubmit={async (carrier, trackingNumber) => { await authenticatedApi(`/api/account/donations/${donation.id}/mailed`, { method: "POST", body: JSON.stringify({ carrier, trackingNumber }) }); await load(); setMessage("Shipping update saved."); }} />}</article>) : <div className="empty-panel"><h2>No claimed donations yet</h2><p>Use the one-time claim link or reference from a donation confirmation.</p></div>}</div></section></main>;
}

function ClaimForm({ onClaimed }: { onClaimed: () => Promise<void> }) {
  return <form className="inline-ops" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await authenticatedApi("/api/account/claims", { method: "POST", body: JSON.stringify({ publicId: form.get("publicId"), claimToken: form.get("claimToken") }) }); event.currentTarget.reset(); await onClaimed(); }}><h2>Claim another donation</h2><label>Donation ID<input name="publicId" required /></label><label>One-time claim reference<input name="claimToken" autoComplete="off" required /></label><button>Claim donation</button></form>;
}

function MailedForm({ onSubmit }: { onSubmit: (carrier: string, tracking: string) => Promise<void> }) {
  return <form className="inline-ops" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const f = new FormData(event.currentTarget); void onSubmit(String(f.get("carrier") || ""), String(f.get("tracking") || "")); }}><h3>Already mailed it?</h3><label>Carrier (optional)<input name="carrier" placeholder="USPS, UPS, FedEx…" /></label><label>Tracking number (optional)<input name="tracking" autoComplete="off" /></label><button>Mark as mailed</button><small>Carrier delivery does not count as staff verification of receipt.</small></form>;
}
