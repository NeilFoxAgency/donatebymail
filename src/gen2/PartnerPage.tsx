import { FormEvent, useEffect, useState } from "react";
import { authenticatedApi, authenticatedUpload, logout, publicApi, sessionStatus } from "./AuthSession";

type Campaign = { id: string; slug: string; name: string; status: string; charityName: string };
type VerifiedCharity = { id: string; name: string; pledgeId: string };
type Organization = { id: string; name: string; role: string; campaigns: Campaign[]; verifiedCharities: VerifiedCharity[] };
type CampaignBlock = { type: "text" | "callout" | "statistic" | "quote"; content: { heading?: string; body?: string; value?: string } };
type Revision = { id: string; version: number; status: string; headline: string; summary: string; story: string; ctaLabel: string; heroAssetId?: string; supportingAssetId?: string; heroAltText?: string; heroDecorative?: boolean; supportingAltText?: string; supportingDecorative?: boolean; blocks?: CampaignBlock[] };
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
      try {
        const body = await publicApi<{ message?: string }>("/api/partner/auth/magic-link", { method: "POST", body: JSON.stringify({ email }) });
        setMessage(body.message || "If the address is authorized, a secure link is on its way.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "We could not request a secure link. Please try again."); }
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
  const [heroAssetId, setHeroAssetId] = useState(latest?.heroAssetId || "");
  const [supportingAssetId, setSupportingAssetId] = useState(latest?.supportingAssetId || "");
  const [heroAltText, setHeroAltText] = useState(latest?.heroAltText || "");
  const [supportingAltText, setSupportingAltText] = useState(latest?.supportingAltText || "");
  const [heroDecorative, setHeroDecorative] = useState(Boolean(latest?.heroDecorative));
  const [supportingDecorative, setSupportingDecorative] = useState(Boolean(latest?.supportingDecorative));
  const [blocks, setBlocks] = useState<CampaignBlock[]>(latest?.blocks || []);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  useEffect(() => { setHeroAssetId(latest?.heroAssetId || ""); setSupportingAssetId(latest?.supportingAssetId || ""); setHeroAltText(latest?.heroAltText || ""); setSupportingAltText(latest?.supportingAltText || ""); setHeroDecorative(Boolean(latest?.heroDecorative)); setSupportingDecorative(Boolean(latest?.supportingDecorative)); setBlocks(latest?.blocks || []); setUploadMessage(""); }, [latest?.id, latest?.heroAssetId, latest?.supportingAssetId]);
  if (!latest) return null;
  async function uploadImage(file: File, assetKind: "hero_image" | "supporting_image") {
    setUploading(true); setUploadMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("assetKind", assetKind);
      const decorative = assetKind === "hero_image" ? heroDecorative : supportingDecorative;
      form.append("altText", assetKind === "hero_image" ? heroAltText : supportingAltText);
      form.append("decorative", String(decorative));
      const body = await authenticatedUpload(`/api/partner/campaigns/${campaign.id}/assets`, form);
      if (assetKind === "hero_image") setHeroAssetId(body.asset.id); else setSupportingAssetId(body.asset.id);
      setUploadMessage(`${assetKind === "hero_image" ? "Hero" : "Story"} image uploaded. Save this revision to send it for staff review.`);
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "The image could not be uploaded.");
    } finally { setUploading(false); }
  }
  return <form className="campaign-editor" key={`${campaign.id}-${latest.version}`} onSubmit={async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    const payload = { ...Object.fromEntries(values), heroAssetId: heroAssetId || null, supportingAssetId: supportingAssetId || null, blocks };
    await authenticatedApi(`/api/partner/campaigns/${campaign.id}`, {
      method: "POST", body: JSON.stringify(payload),
    });
    await onSaved();
  }}><div className="staff-heading"><div><p className="kicker">Revision {latest.version}</p><h3>Edit {campaign.name}</h3></div>
    <span className="status-pill">{latest.status}</span></div>
    <p>Saving creates a new immutable revision. Staff publication is a separate reviewed action.</p>
    <label>Headline<input name="headline" defaultValue={latest.headline} required maxLength={160} /></label>
    <label>Short summary<textarea name="summary" defaultValue={latest.summary} required maxLength={600} /></label>
    <label>Campaign story<textarea name="story" defaultValue={latest.story} required maxLength={12000} rows={8} /></label>
    <div className="form-grid"><label>Button label<input name="ctaLabel" defaultValue={latest.ctaLabel} required maxLength={80} /></label></div>
    <div className="form-grid campaign-image-fields"><fieldset><legend>Hero image (optional)</legend><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadImage(file, "hero_image"); }} /><label>Alt text<input value={heroAltText} onChange={(event) => setHeroAltText(event.target.value)} placeholder="Describe what this image shows" disabled={heroDecorative} /></label><label className="check"><input type="checkbox" checked={heroDecorative} onChange={(event) => setHeroDecorative(event.target.checked)} />Decorative image (no alt text)</label></fieldset><fieldset><legend>Story image (optional)</legend><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadImage(file, "supporting_image"); }} /><label>Alt text<input value={supportingAltText} onChange={(event) => setSupportingAltText(event.target.value)} placeholder="Describe what this image shows" disabled={supportingDecorative} /></label><label className="check"><input type="checkbox" checked={supportingDecorative} onChange={(event) => setSupportingDecorative(event.target.checked)} />Decorative image (no alt text)</label></fieldset></div>
    <fieldset><legend>Story blocks</legend><p><small>Add short structured sections to help supporters understand the drive. HTML, scripts, embeds, and external URLs are not allowed.</small></p>{blocks.map((block, index) => <div className="account-card" key={`${block.type}-${index}`}><label>Type<select value={block.type} onChange={(event) => setBlocks((current) => current.map((item, i) => i === index ? { ...item, type: event.target.value as CampaignBlock["type"] } : item))}><option value="text">Text</option><option value="callout">Callout</option><option value="statistic">Impact statistic</option><option value="quote">Quote</option></select></label><label>Heading<input value={block.content.heading || ""} onChange={(event) => setBlocks((current) => current.map((item, i) => i === index ? { ...item, content: { ...item.content, heading: event.target.value } } : item))} /></label><label>Body<textarea value={block.content.body || ""} onChange={(event) => setBlocks((current) => current.map((item, i) => i === index ? { ...item, content: { ...item.content, body: event.target.value } } : item))} /></label><label>Value (optional)<input value={block.content.value || ""} onChange={(event) => setBlocks((current) => current.map((item, i) => i === index ? { ...item, content: { ...item.content, value: event.target.value } } : item))} /></label><div className="inline-actions"><button type="button" className="button text" onClick={() => setBlocks((current) => current.filter((_, i) => i !== index))}>Remove</button>{index > 0 && <button type="button" className="button text" onClick={() => setBlocks((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>Move up</button>}{index < blocks.length - 1 && <button type="button" className="button text" onClick={() => setBlocks((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>Move down</button>}</div></div>)}{blocks.length < 12 && <button type="button" className="button text" onClick={() => setBlocks((current) => [...current, { type: "text", content: {} }])}>Add block</button>}</fieldset>
    <p><small>Use clear JPG, PNG, or WebP images under 5 MB. Images are stored privately, served only from the published campaign, and reviewed by Donate by Mail staff before publication.</small></p>
    {heroAssetId && <p className="status-pill">A reviewed hero image is attached to this revision.</p>}
    {supportingAssetId && <p className="status-pill">A reviewed story image is attached to this revision.</p>}
    {uploadMessage && <p role="status">{uploadMessage}</p>}
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
