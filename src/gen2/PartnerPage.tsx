import { FormEvent, useEffect, useState } from "react";
import { authenticatedApi, logout, sessionStatus } from "./AuthSession";

type Campaign = { id: string; slug: string; name: string; status: string; charityName: string };
type VerifiedCharity = { id: string; name: string; pledgeId: string };
type Organization = { id: string; name: string; role: string; campaigns: Campaign[]; verifiedCharities: VerifiedCharity[] };
type Revision = { id: string; version: number; status: string; headline: string; summary: string; story: string; ctaLabel: string; heroAssetId?: string };
type CampaignDetail = Campaign & { revisions: Revision[] };
export function PartnerPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
  const [message, setMessage] = useState("");
  async function load() {
    const body = await authenticatedApi("/api/partner/overview");
    setOrganizations(body.partner.organizations || []);
  }
  useEffect(() => {
    sessionStatus("/api/partner/session").then(setAuthenticated).catch(() => setAuthenticated(false));
  }, []);
  useEffect(() => { if (authenticated) load().catch((error) => { setMessage(error.message); setAuthenticated(false); }); }, [authenticated]);
  if (!authenticated) return <main className="operations-main"><section className="operations-shell compact">
    <p className="kicker">Nonprofit partners</p><h1>Partner sign in</h1>
    <p>Use an email address associated with your organization.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
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
      <button className="button text" onClick={() => void logout().finally(() => setAuthenticated(false))}>Sign out</button></div>
    {message && <p role="status">{message}</p>}
    {organizations.length ? organizations.map((organization) => <section className="partner-organization" key={organization.id}>
      <h2>{organization.name}</h2><p>Your role: {organization.role.replace("partner_", "")}</p>
      <div className="account-grid">{organization.campaigns.map((campaign) => <article className="account-card" key={campaign.id}>
        <p className="kicker">{campaign.status}</p><h3>{campaign.name}</h3><p>Supporting {campaign.charityName}</p>
        <div className="inline-actions"><button className="button text" onClick={async () => {
          const body = await authenticatedApi(`/api/partner/campaigns/${campaign.id}`);
          setSelectedCampaign(body.campaign);
        }}>Edit campaign</button>
        {campaign.status === "published" ? <a href={`/c/${campaign.slug}`}>View public page</a> : <span>Awaiting publication</span>}</div>
      </article>)}</div>
      {selectedCampaign && organization.campaigns.some(({ id }) => id === selectedCampaign.id) &&
        <RevisionForm campaign={selectedCampaign} onSaved={async () => {
          const body = await authenticatedApi(`/api/partner/campaigns/${selectedCampaign.id}`);
          setSelectedCampaign(body.campaign); await load(); setMessage("A new campaign revision was saved for review.");
        }} />}
      {organization.role === "partner_admin" && <CampaignForm organizationId={organization.id} charities={organization.verifiedCharities} onSaved={async () => {
        await load(); setMessage("Campaign draft created for review.");
      }} />}
    </section>) : <div className="empty-panel"><h2>No active partner membership</h2>
      <p>Your sign-in is valid, but this address has not yet been assigned to a partner organization.</p></div>}
  </section></main>;
}

function RevisionForm({ campaign, onSaved }: { campaign: CampaignDetail; onSaved: () => Promise<void> }) {
  const latest = campaign.revisions[0];
  if (!latest) return null;
  return <form className="campaign-editor" key={`${campaign.id}-${latest.version}`} onSubmit={async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    await authenticatedApi(`/api/partner/campaigns/${campaign.id}`, {
      method: "POST", body: JSON.stringify(Object.fromEntries(values)),
    });
    await onSaved();
  }}><div className="staff-heading"><div><p className="kicker">Revision {latest.version}</p><h3>Edit {campaign.name}</h3></div>
    <span className="status-pill">{latest.status}</span></div>
    <p>Saving creates a new immutable revision. Staff publication is a separate reviewed action.</p>
    <label>Headline<input name="headline" defaultValue={latest.headline} required maxLength={160} /></label>
    <label>Short summary<textarea name="summary" defaultValue={latest.summary} required maxLength={600} /></label>
    <label>Campaign story<textarea name="story" defaultValue={latest.story} required maxLength={12000} rows={8} /></label>
    <div className="form-grid"><label>Button label<input name="ctaLabel" defaultValue={latest.ctaLabel} required maxLength={80} /></label></div>
    <p><small>Campaign images are selected from reviewed Donate by Mail assets; arbitrary remote URLs are not accepted.</small></p>
    <button>Save new revision</button>
  </form>;
}

function CampaignForm({ organizationId, charities, onSaved }: { organizationId: string; charities: VerifiedCharity[]; onSaved: () => Promise<void> }) {
  return <form className="campaign-editor" onSubmit={async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    await authenticatedApi("/api/partner/campaigns", {
      method: "POST", body: JSON.stringify(Object.fromEntries(values)),
    });
    form.reset(); await onSaved();
  }}><h3>Create a campaign draft</h3><div className="form-grid">
    <label>Campaign name<input name="name" required maxLength={200} /></label>
    <label>URL slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></label>
    <label>Verified nonprofit<select name="charityId" required><option value="">Select a verified nonprofit</option>{charities.map((charity) => <option value={charity.id} key={charity.id}>{charity.name}</option>)}</select></label>
  </div><label>Headline<input name="headline" required maxLength={160} /></label>
    <label>Short summary<textarea name="summary" required maxLength={600} /></label>
    <label>Campaign story<textarea name="story" required maxLength={12000} rows={8} /></label>
    <input type="hidden" name="organizationId" value={organizationId} />
    <input type="hidden" name="ctaLabel" value="Donate a Phone" />
    <button>Create draft</button><small>Drafts are not public until a staff member publishes a reviewed revision.</small>
  </form>;
}
