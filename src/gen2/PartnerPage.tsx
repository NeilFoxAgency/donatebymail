import { FormEvent, useEffect, useState } from "react";
import { authenticatedApi, consumeAccessToken } from "./AuthSession";

type Campaign = { id: string; slug: string; name: string; status: string; charityName: string };
type Organization = { id: string; name: string; role: string; campaigns: Campaign[] };
type Revision = { id: string; version: number; status: string; headline: string; summary: string; story: string; ctaLabel: string; heroImageUrl?: string };
type CampaignDetail = Campaign & { revisions: Revision[] };
const key = "dbm-beta-partner-session";

export function PartnerPage() {
  const [token, setToken] = useState(() => consumeAccessToken(key, "/partner"));
  const [email, setEmail] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
  const [message, setMessage] = useState("");
  async function load(activeToken = token) {
    const body = await authenticatedApi("/api/partner/overview", activeToken);
    setOrganizations(body.partner.organizations || []);
  }
  useEffect(() => {
    if (token) load(token).catch((error) => {
      setMessage(error.message); sessionStorage.removeItem(key); setToken("");
    });
  }, [token]);
  if (!token) return <main className="operations-main"><section className="operations-shell compact">
    <p className="kicker">Nonprofit partners</p><h1>Partner sign in</h1>
    <p>Use an email address associated with your organization.</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); sessionStorage.setItem("dbm-beta-auth-destination", "/partner");
      const response = await fetch("/api/partner/auth/magic-link", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
      });
      setMessage(((await response.json()) as { message: string }).message);
    }}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <button className="button primary">Email secure sign-in link</button></form>
    {message && <p role="status">{message}</p>}
  </section></main>;
  return <main className="operations-main"><section className="operations-shell">
    <div className="staff-heading"><div><p className="kicker">Partner workspace</p><h1>Phone-drive campaigns</h1></div>
      <button className="button text" onClick={() => { sessionStorage.removeItem(key); setToken(""); }}>Sign out</button></div>
    {message && <p role="status">{message}</p>}
    {organizations.length ? organizations.map((organization) => <section className="partner-organization" key={organization.id}>
      <h2>{organization.name}</h2><p>Your role: {organization.role.replace("partner_", "")}</p>
      <div className="account-grid">{organization.campaigns.map((campaign) => <article className="account-card" key={campaign.id}>
        <p className="kicker">{campaign.status}</p><h3>{campaign.name}</h3><p>Supporting {campaign.charityName}</p>
        <div className="inline-actions"><button className="button text" onClick={async () => {
          const body = await authenticatedApi(`/api/partner/campaigns/${campaign.id}`, token);
          setSelectedCampaign(body.campaign);
        }}>Edit campaign</button>
        {campaign.status === "published" ? <a href={`/c/${campaign.slug}`}>View public page</a> : <span>Awaiting publication</span>}</div>
      </article>)}</div>
      {selectedCampaign && organization.campaigns.some(({ id }) => id === selectedCampaign.id) &&
        <RevisionForm campaign={selectedCampaign} token={token} onSaved={async () => {
          const body = await authenticatedApi(`/api/partner/campaigns/${selectedCampaign.id}`, token);
          setSelectedCampaign(body.campaign); await load(); setMessage("A new campaign revision was saved for review.");
        }} />}
      {organization.role === "partner_admin" && <CampaignForm organizationId={organization.id} token={token} onSaved={async () => {
        await load(); setMessage("Campaign draft created for review.");
      }} />}
    </section>) : <div className="empty-panel"><h2>No active partner membership</h2>
      <p>Your sign-in is valid, but this address has not yet been assigned to a partner organization.</p></div>}
  </section></main>;
}

function RevisionForm({ campaign, token, onSaved }: { campaign: CampaignDetail; token: string; onSaved: () => Promise<void> }) {
  const latest = campaign.revisions[0];
  if (!latest) return null;
  return <form className="campaign-editor" key={`${campaign.id}-${latest.version}`} onSubmit={async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    await authenticatedApi(`/api/partner/campaigns/${campaign.id}`, token, {
      method: "POST", body: JSON.stringify(Object.fromEntries(values)),
    });
    await onSaved();
  }}><div className="staff-heading"><div><p className="kicker">Revision {latest.version}</p><h3>Edit {campaign.name}</h3></div>
    <span className="status-pill">{latest.status}</span></div>
    <p>Saving creates a new immutable revision. Staff publication is a separate reviewed action.</p>
    <label>Headline<input name="headline" defaultValue={latest.headline} required maxLength={160} /></label>
    <label>Short summary<textarea name="summary" defaultValue={latest.summary} required maxLength={600} /></label>
    <label>Campaign story<textarea name="story" defaultValue={latest.story} required maxLength={12000} rows={8} /></label>
    <div className="form-grid"><label>Button label<input name="ctaLabel" defaultValue={latest.ctaLabel} required maxLength={80} /></label>
      <label>Hero image URL (optional)<input name="heroImageUrl" type="url" defaultValue={latest.heroImageUrl || ""} /></label></div>
    <button>Save new revision</button>
  </form>;
}

function CampaignForm({ organizationId, token, onSaved }: { organizationId: string; token: string; onSaved: () => Promise<void> }) {
  return <form className="campaign-editor" onSubmit={async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    await authenticatedApi("/api/partner/campaigns", token, {
      method: "POST", body: JSON.stringify(Object.fromEntries(values)),
    });
    form.reset(); await onSaved();
  }}><h3>Create a campaign draft</h3><div className="form-grid">
    <label>Campaign name<input name="name" required maxLength={200} /></label>
    <label>URL slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></label>
    <label>Pledge nonprofit ID<input name="charityPledgeId" required /></label>
    <label>Nonprofit name<input name="charityName" required /></label>
  </div><label>Headline<input name="headline" required maxLength={160} /></label>
    <label>Short summary<textarea name="summary" required maxLength={600} /></label>
    <label>Campaign story<textarea name="story" required maxLength={12000} rows={8} /></label>
    <input type="hidden" name="organizationId" value={organizationId} />
    <input type="hidden" name="ctaLabel" value="Donate a Phone" />
    <button>Create draft</button><small>Drafts are not public until a staff member publishes a reviewed revision.</small>
  </form>;
}
