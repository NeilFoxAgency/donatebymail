import { FormEvent, useEffect, useState } from "react";
import { authenticatedApi, consumeAccessToken } from "./AuthSession";

type Donation = { id: string; publicId: string; status: string; charityName: string; createdAt: string; deviceCount: number; shipment?: { status: string; carrier?: string; trackingLastFour?: string; mailedAt?: string } };
const key = "dbm-beta-donor-session";

export function DonorAccountPage() {
  const [token, setToken] = useState(() => consumeAccessToken(key, "/account"));
  const [email, setEmail] = useState("");
  const [donations, setDonations] = useState<Donation[]>([]);
  const [message, setMessage] = useState("");
  async function load(activeToken = token) {
    const body = await authenticatedApi("/api/account/donations", activeToken);
    setDonations(body.account.donations || []);
  }
  useEffect(() => { if (token) load(token).catch((error) => { setMessage(error.message); sessionStorage.removeItem(key); setToken(""); }); }, [token]);
  if (!token) return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Donor account</p><h1>Track all your donations</h1><p>Use the email address from your donation. We’ll send a one-time secure sign-in link.</p><form onSubmit={async (event) => { event.preventDefault(); sessionStorage.setItem("dbm-beta-auth-destination", "/account"); const response = await fetch("/api/account/auth/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); const body = await response.json() as { message: string }; setMessage(body.message); }}><label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><button className="button primary">Email secure sign-in link</button></form>{message && <p role="status">{message}</p>}</section></main>;
  return <main className="operations-main"><section className="operations-shell"><div className="staff-heading"><div><p className="kicker">Your donations</p><h1>Donation account</h1></div><button className="button text" onClick={() => { sessionStorage.removeItem(key); setToken(""); }}>Sign out</button></div>{message && <p role="status">{message}</p>}<div className="account-grid">{donations.length ? donations.map((donation) => <article className="account-card" key={donation.id}><p className="kicker">{donation.status.replace(/_/g, " ")}</p><h2>{donation.publicId}</h2><p>Supporting <strong>{donation.charityName}</strong><br />{donation.deviceCount} device{donation.deviceCount === 1 ? "" : "s"} · Started {new Date(donation.createdAt).toLocaleDateString()}</p>{donation.shipment ? <p>Shipment: {donation.shipment.status}{donation.shipment.carrier ? ` via ${donation.shipment.carrier}` : ""}{donation.shipment.trackingLastFour ? ` · ending ${donation.shipment.trackingLastFour}` : ""}</p> : <MailedForm onSubmit={async (carrier, trackingNumber) => { await authenticatedApi(`/api/account/donations/${donation.id}/mailed`, token, { method: "POST", body: JSON.stringify({ carrier, trackingNumber }) }); await load(); setMessage("Shipping update saved."); }} />}</article>) : <div className="empty-panel"><h2>No linked donations yet</h2><p>Donations made with this verified email will appear here automatically.</p></div>}</div></section></main>;
}

function MailedForm({ onSubmit }: { onSubmit: (carrier: string, tracking: string) => Promise<void> }) {
  return <form className="inline-ops" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const f = new FormData(event.currentTarget); void onSubmit(String(f.get("carrier") || ""), String(f.get("tracking") || "")); }}><h3>Already mailed it?</h3><label>Carrier (optional)<input name="carrier" placeholder="USPS, UPS, FedEx…" /></label><label>Tracking number (optional)<input name="tracking" autoComplete="off" /></label><button>Mark as mailed</button><small>Carrier delivery does not count as staff verification of receipt.</small></form>;
}
