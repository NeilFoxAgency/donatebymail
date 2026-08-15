import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { authenticatedApi, logout, publicApi } from "./AuthSession";
import { TURNSTILE_SITE_KEY, TurnstileWidget } from "./TurnstileWidget";
import { safeExternalHttpsUrl, safePrivateAssetUrl } from "./urlSafety";

type StaffRole = "staff" | "admin";

type SearchItem = { id: string; publicId: string; status: string; donorName: string; donorEmail: string; charityName: string; deviceCount: number; createdAt: string };
type Device = { id: string; donor_brand?: string; donor_model?: string; actual_brand?: string; actual_model?: string; receipt_status: string; inspection_status: string; processing_status: string; data_wipe_status: string; assessed_value_cents?: number };
type FinancialSale = { id: string; device_id: string; gross_amount_cents: number; status: string; reversal_of?: string | null; external_reference?: string | null };
type FinancialCost = { id: string; category: string; amount_cents: number; status: string; reversal_of?: string | null };
type Financial = { revision: number; finalizedAt?: string | null; disbursed: boolean; activeAllocation?: { id: string; status: string; settlement_status?: string; gross_cents: number; eligible_cost_cents: number; allocated_cents?: number | null } | null; allocations: Array<{ id: string; status: string; settlement_status?: string; gross_cents: number; eligible_cost_cents: number; allocated_cents?: number | null }>; sales: FinancialSale[]; costs: FinancialCost[] };
type Detail = SearchItem & { receivedAt?: string; packageCondition?: string; donor: { name: string; email: string; address1: string; address2: string; city: string; state: string; zip: string; country: string }; charity: { name: string }; devices: Device[]; notes: Array<{ id: string; body: string; createdAt: string }>; events: Array<{ status: string; message: string; occurredAt: string }>; financial?: Financial };
type Finance = { policyHolds: number; failedOutbox: number; openEscalations: number; allocations: Array<{ id: string; donationId: string; status: string; settlementStatus?: string; grossCents: number; eligibleCostCents: number; allocatedCents?: number; createdAt: string }>; disbursements: Array<{ id: string; preparationId: string; status: string; completedAt?: string }> };
type StaffCampaign = { id: string; name: string; slug: string; status: string; organizationName: string; charityName: string; revisions: Array<{ id: string; version: number; status: string; headline: string; summary: string; contentHash: string }> };
type CampaignPreview = { campaign: { id: string; name: string; slug: string; status: string }; organization: { name: string }; charity: { name: string; pledgeId: string; ein?: string }; publishedRevisionId?: string | null; differsFromPublished: boolean; changedFields: string[]; revision: { id: string; version: number; status: string; headline: string; summary: string; story: string; ctaLabel: string; contentHash: string; phoneGoal?: number | null; startsAt?: string | null; endsAt?: string | null; timezone?: string; blocks: Array<{ type: string; content: Record<string, string> }>; heroAsset?: { imageUrl: string; altText?: string; isDecorative?: boolean; contentSha256: string } | null; supportingAsset?: { imageUrl: string; altText?: string; isDecorative?: boolean; contentSha256: string } | null } };
type ProfilePreview = { organization: { id: string; name: string; slug: string }; publishedRevisionId?: string | null; differsFromPublished: boolean; changedFields: string[]; revision: { id: string; version: number; status: string; mission: string; summary: string; websiteUrl: string; locality?: string | null; region?: string | null; countryCode: string; contentHash: string; logoAsset?: { imageUrl: string; altText?: string; isDecorative?: boolean; contentSha256: string } | null; heroAsset?: { imageUrl: string; altText?: string; isDecorative?: boolean; contentSha256: string } | null } };
type PartnerOrganization = { id: string; name: string; slug: string; status: string; charities: Array<{ id: string; name: string; pledgeId: string }>; members: Array<{ userId: string; email: string; role: string; status: string }>; invitations: Array<{ id: string; email: string; role: string; status: string }>; campaigns: Array<{ id: string; name: string; slug: string; status: string }> };
type PartnerReviewQueue = { applications: Array<{ id: string; organizationName: string; contactName: string; roleTitle: string; email: string; websiteUrl: string; audience: string; goal: string; desiredTiming: string; status: string; createdAt: string }>; profiles: Array<{ organizationId: string; organizationName: string; organizationSlug: string; revisionId: string; version: number; status: string; mission: string; summary: string; websiteUrl: string; location: string; contentHash: string; createdAt: string }>; campaigns: Array<{ campaignId: string; campaignName: string; organizationName: string; revisionId: string; version: number; status: string; headline: string; summary: string; contentHash: string; createdAt: string }> };

const nextStatuses: Record<string, string[]> = {
  submitted: ["in_transit", "received", "exception", "cancelled"],
  in_transit: ["received", "exception", "cancelled"],
  received: ["inspecting", "processing", "exception"],
  inspecting: ["processing", "exception"],
  processing: ["completed", "exception"],
  exception: ["received", "inspecting", "processing", "cancelled"],
};
export function StaffPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [magicLinkBusy, setMagicLinkBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [campaigns, setCampaigns] = useState<StaffCampaign[]>([]);
  const [campaignPreview, setCampaignPreview] = useState<CampaignPreview | null>(null);
  const [profilePreview, setProfilePreview] = useState<ProfilePreview | null>(null);
  const [partners, setPartners] = useState<PartnerOrganization[]>([]);
  const [partnerReviews, setPartnerReviews] = useState<PartnerReviewQueue | null>(null);
  const authenticatedRef = useRef<boolean | null>(null);
  authenticatedRef.current = authenticated;
  const searchRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const dashboardRequestRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  useEffect(() => {
    if (authenticated !== false) return;
    // Never retain private operational records across logout or session expiry;
    // a later login may belong to a different staff user.
    setResults([]); setDetail(null); setFinance(null); setCampaigns([]); setCampaignPreview(null); setProfilePreview(null); setPartners([]); setPartnerReviews(null);
    searchRequestRef.current += 1; detailRequestRef.current += 1; dashboardRequestRef.current += 1;
    // Chrome can restore a previously submitted staff address after hydration;
    // clear that browser-only value so a staff member must deliberately enter it.
    const frame = window.requestAnimationFrame(() => setEmail(""));
    return () => window.cancelAnimationFrame(frame);
  }, [authenticated]);
  const load = useCallback(async (q = query) => {
    if (!authenticated || authenticatedRef.current !== true) return;
    const requestId = ++searchRequestRef.current;
    try {
      const body = await authenticatedApi(`/api/staff/donations?q=${encodeURIComponent(q)}`);
      // A slower request for an older query must not replace the newest search.
      if (requestId === searchRequestRef.current && authenticatedRef.current === true) setResults(body.donations);
    } catch (error) {
      if (requestId === searchRequestRef.current && authenticatedRef.current === true) setMessage(error instanceof Error ? error.message : "The donation search failed.");
    }
  }, [query, authenticated]);
  const open = useCallback(async (id: string) => {
    if (authenticatedRef.current !== true) return;
    const requestId = ++detailRequestRef.current;
    try {
      const [body, financeBody] = await Promise.all([
        authenticatedApi(`/api/staff/donations/${id}`),
        authenticatedApi(`/api/staff/donations/${id}/financials`),
      ]);
      // Staff can click through results faster than the API responds. Keep the
      // detail pane aligned with the most recently selected donation.
      if (requestId === detailRequestRef.current && authenticatedRef.current === true) setDetail({ ...body.donation, financial: financeBody.financials });
    } catch (error) {
      if (requestId === detailRequestRef.current && authenticatedRef.current === true) setMessage(error instanceof Error ? error.message : "The donation could not be opened.");
    }
  }, []);
  const loadDashboards = useCallback(async () => {
    if (!authenticated || authenticatedRef.current !== true) return;
    const requestId = ++dashboardRequestRef.current;
    const [financeBody, campaignBody, partnerBody, reviewBody] = await Promise.all([
      authenticatedApi("/api/staff/finance"), authenticatedApi("/api/staff/campaigns"), authenticatedApi("/api/staff/partners"), authenticatedApi("/api/staff/partner-reviews"),
    ]);
    // Session expiry can resolve after these parallel calls start. Never
    // repopulate private dashboards after the unauthenticated transition.
    if (requestId !== dashboardRequestRef.current || authenticatedRef.current !== true) return;
    setFinance(financeBody.finance); setCampaigns(campaignBody.campaigns.campaigns || []); setPartners(partnerBody.partners.organizations || []);
    setPartnerReviews(reviewBody.queue);
  }, [authenticated]);
  useEffect(() => {
    publicApi<{ ok?: boolean; user?: { role?: string } }>("/api/staff/session")
      .then((body) => {
        const role = body.user?.role === "admin" || body.user?.role === "staff" ? body.user.role : null;
        setStaffRole(role);
        setAuthenticated(Boolean(body.ok && role));
      })
      .catch(() => { setStaffRole(null); setAuthenticated(false); });
  }, []);
  useEffect(() => { if (authenticated) Promise.all([load(""), loadDashboards()]).catch(() => { setAuthenticated(false); setMessage("Your session ended. Request a new sign-in link."); }); }, [authenticated]);
  async function mutate(path: string, payload: unknown) {
    if (mutationInFlightRef.current) {
      setMessage("Another staff change is still being saved. Please wait for it to finish.");
      return;
    }
    mutationInFlightRef.current = true;
    const selectedDonationId = detail?.id;
    setMessage("");
    try {
      await authenticatedApi(path, { method: "POST", body: JSON.stringify(payload) });
      if (authenticatedRef.current !== true) return;
      if (selectedDonationId && detail?.id === selectedDonationId) await open(selectedDonationId);
      await load();
      await loadDashboards();
      if (authenticatedRef.current === true) setMessage("Saved and audited.");
    } catch (error) {
      if (authenticatedRef.current === true) setMessage(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      mutationInFlightRef.current = false;
    }
  }
  if (authenticated === null) return <main className="operations-main"><section className="operations-shell compact"><p role="status">Checking your secure staff session…</p></section></main>;
  if (!authenticated) return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Authorized staff</p><h1>Staff sign in</h1><p>We’ll email a one-time secure link to an authorized staff address.</p><form autoComplete="off" onSubmit={async (event) => { event.preventDefault(); if (magicLinkBusy) return; setMagicLinkBusy(true); try { if (TURNSTILE_SITE_KEY && !turnstileToken) throw new Error("Please complete the security verification."); const body = await publicApi<{ message?: string }>("/api/staff/auth/magic-link", { method: "POST", body: JSON.stringify({ email, turnstileToken }) }); setMessage(body.message || "If the address is authorized, a secure link is on its way."); } catch (error) { setMessage(error instanceof Error ? error.message : "We could not request a secure link. Please try again."); } finally { setMagicLinkBusy(false); } }}><label>Email<input name="staff-login-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={magicLinkBusy} /></label><TurnstileWidget action="auth_magic_link" onToken={setTurnstileToken} /><button className="button primary" disabled={magicLinkBusy}>{magicLinkBusy ? "Sending…" : "Email secure sign-in link"}</button></form>{message && <p role="status">{message}</p>}</section></main>;
  const isAdmin = staffRole === "admin";
  return <main className="operations-main"><section className="operations-shell"><div className="staff-heading"><div><p className="kicker">Operations workspace</p><h1>Donation management</h1><p className="staff-role">Signed in as {isAdmin ? "administrator" : "operations staff"}.</p></div><div className="workspace-actions"><a className="button text" href="/settings">Account security</a><button className="button text" disabled={logoutBusy} onClick={async () => { if (logoutBusy) return; setLogoutBusy(true); try { await logout(); setStaffRole(null); setAuthenticated(false); } catch (error) { setMessage(error instanceof Error ? error.message : "Sign out failed. Please try again."); setLogoutBusy(false); } }}>{logoutBusy ? "Signing out…" : "Sign out"}</button></div></div>
    <form className="staff-search" onSubmit={(e) => { e.preventDefault(); void load(); }}><label>Search donations<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, donor, email, or charity" /></label><button className="button primary">Search</button></form>
    {message && <p role="status">{message}</p>}
    <div className="staff-layout"><aside><h2>Donations</h2>{results.map((item) => <button key={item.id} className="donation-result" onClick={() => void open(item.id)}><strong>{item.publicId}</strong><span>{item.donorName}</span><small>{item.status} · {item.deviceCount} device(s)</small></button>)}</aside>
    <div>{detail ? <DonationDetail detail={detail} mutate={mutate} /> : <div className="empty-panel">Select a donation to manage it.</div>}</div></div>
    <OperationsOverview isAdmin={isAdmin} finance={finance} campaigns={campaigns} preview={async (campaignId, revisionId) => {
      try {
        const body = await authenticatedApi(`/api/staff/campaigns/${campaignId}/revisions/${revisionId}/preview`);
        setCampaignPreview(body.preview);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "The campaign preview could not be loaded.");
      }
    }} financialAction={mutate} />
    {campaignPreview && <CampaignRevisionPreview preview={campaignPreview} canPublish={isAdmin} publish={async (campaignId, revisionId) => { await mutate("/api/staff/campaigns/publish", { campaignId, revisionId }); setCampaignPreview(null); }} close={() => setCampaignPreview(null)} />}
    {profilePreview && <ProfileRevisionPreview preview={profilePreview} canPublish={isAdmin} publish={async (organizationId, revisionId) => { await mutate(`/api/staff/partners/organizations/${organizationId}/profiles/${revisionId}/publish`, {}); setProfilePreview(null); }} close={() => setProfilePreview(null)} />}
    <PartnerAdministration isAdmin={isAdmin} organizations={partners} mutate={mutate} />
    <PartnerReviewOperations isAdmin={isAdmin} queue={partnerReviews} organizations={partners} mutate={mutate} previewCampaign={async (campaignId, revisionId) => { try { const body = await authenticatedApi(`/api/staff/campaigns/${campaignId}/revisions/${revisionId}/preview`); setCampaignPreview(body.preview); } catch (error) { setMessage(error instanceof Error ? error.message : "The campaign preview could not be loaded."); } }} previewProfile={async (organizationId, revisionId) => { try { const body = await authenticatedApi(`/api/staff/partners/organizations/${organizationId}/profiles/${revisionId}/preview`); setProfilePreview(body.preview); } catch (error) { setMessage(error instanceof Error ? error.message : "The profile preview could not be loaded."); } }} />
  </section></main>;
}

function PartnerReviewOperations({ isAdmin,queue,organizations,mutate,previewCampaign,previewProfile }: { isAdmin: boolean; queue: PartnerReviewQueue | null; organizations: PartnerOrganization[]; mutate: (path:string,payload:unknown)=>Promise<void>; previewCampaign:(campaignId:string,revisionId:string)=>Promise<void>; previewProfile:(organizationId:string,revisionId:string)=>Promise<void> }) {
  return <section className="operations-overview"><h2>Partner intake and publication review</h2>{!queue ? <p>Loading review queue…</p> : <>{queue.applications.length > 0 && <><h3>Partnership applications</h3>{queue.applications.map((application) => <article className="account-card" key={application.id}><span className="status-pill">{application.status}</span><h4>{application.organizationName}</h4><p>{application.contactName} · {application.roleTitle} · {application.email}</p>{safeExternalHttpsUrl(application.websiteUrl) && <p><a href={safeExternalHttpsUrl(application.websiteUrl)!} target="_blank" rel="noopener noreferrer">{application.websiteUrl}</a></p>}<p><strong>Audience:</strong> {application.audience}<br /><strong>Goal:</strong> {application.goal}<br /><strong>Timing:</strong> {application.desiredTiming}</p>{isAdmin && <form className="inline-ops" onSubmit={(event) => { event.preventDefault(); const values=Object.fromEntries(new FormData(event.currentTarget)); void mutate(`/api/staff/partner-applications/${application.id}/review`,values); }}><label>Decision<select name="status"><option value="under_review">Under review</option><option value="verified">Verified</option><option value="converted">Accepted</option><option value="declined">Rejected</option></select></label><label>Associate workspace (for verified/accepted)<select name="organizationId"><option value="">None yet</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label><button>Record application review</button></form>}</article>)}</>}
    {queue.profiles.length > 0 && <><h3>Organization profile revisions</h3>{queue.profiles.map((profile) => <article className="account-card" key={profile.revisionId}><span className="status-pill">Revision {profile.version} · {profile.status}</span><h4>{profile.organizationName}</h4><p><strong>{profile.mission}</strong></p><p>{profile.summary}</p><p>{profile.websiteUrl} · {profile.location}</p><code>{profile.contentHash}</code><button className="button text" onClick={() => void previewProfile(profile.organizationId,profile.revisionId)}>Preview exact profile revision</button>{isAdmin && profile.status === "staff_review" && <form className="inline-ops" onSubmit={(event) => { event.preventDefault(); const values=Object.fromEntries(new FormData(event.currentTarget)); void mutate(`/api/staff/partners/organizations/${profile.organizationId}/profiles/${profile.revisionId}/review`,values); }}><label>Review outcome<select name="outcome"><option value="approved">Approve exact revision</option><option value="changes_requested">Request changes</option></select></label><label>Feedback<textarea name="feedback" /></label><button>Record review</button></form>}{isAdmin && profile.status === "approved" && <button className="button primary" onClick={() => void mutate(`/api/staff/partners/organizations/${profile.organizationId}/profiles/${profile.revisionId}/publish`,{})}>Publish exact approved profile</button>}</article>)}</>}
    {queue.campaigns.length > 0 && <><h3>Campaign revisions awaiting staff review</h3>{queue.campaigns.map((campaign) => <article className="account-card" key={campaign.revisionId}><span className="status-pill">Revision {campaign.version}</span><h4>{campaign.campaignName}</h4><p>{campaign.organizationName}</p><p><strong>{campaign.headline}</strong><br />{campaign.summary}</p><code>{campaign.contentHash}</code><button className="button text" onClick={() => void previewCampaign(campaign.campaignId,campaign.revisionId)}>Preview exact revision</button>{isAdmin && <form className="inline-ops" onSubmit={(event) => { event.preventDefault(); const values=Object.fromEntries(new FormData(event.currentTarget)); void mutate(`/api/staff/campaigns/${campaign.campaignId}/revisions/${campaign.revisionId}/review`,values); }}><label>Review outcome<select name="outcome"><option value="approved">Approve exact revision</option><option value="changes_requested">Request changes</option></select></label><label>Feedback<textarea name="feedback" /></label><button>Record review</button></form>}</article>)}</>}</>}</section>;
}

function PartnerAdministration({ isAdmin, organizations, mutate }: { isAdmin: boolean; organizations: PartnerOrganization[]; mutate: (path: string, payload: unknown) => Promise<void> }) {
  if (!isAdmin) return <section className="operations-overview"><h2>Partner administration</h2><p>Administrator access is required for partner organization, nonprofit verification, invitation, and membership controls.</p></section>;
  return <section className="operations-overview"><h2>Partner administration</h2><p>These role and membership actions are human staff controls and are fully audited.</p>
    <form className="inline-ops" onSubmit={(event)=>{event.preventDefault();const f=new FormData(event.currentTarget);void mutate("/api/staff/partners/organizations",{name:f.get("name"),slug:f.get("slug")});event.currentTarget.reset();}}><h3>Create organization</h3><label>Name<input name="name" required /></label><label>URL-safe slug<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label><button>Create partner organization</button></form>
    {organizations.map((organization)=><article className="account-card" key={organization.id}><p className="kicker">{organization.status}</p><h3>{organization.name}</h3><p>{organization.campaigns.length} campaign(s) · {organization.charities.map((c)=>c.name).join(", ") || "No verified charity"}</p>
      <form className="inline-ops" onSubmit={(event)=>{event.preventDefault();const f=new FormData(event.currentTarget);void mutate(`/api/staff/partners/organizations/${organization.id}/charities`,{pledgeId:f.get("pledgeId")});}}><label>Verify and associate Pledge nonprofit ID<input name="pledgeId" required /></label><button>Verify nonprofit</button></form>
      <form className="inline-ops" onSubmit={(event)=>{event.preventDefault();const f=new FormData(event.currentTarget);void mutate(`/api/staff/partners/organizations/${organization.id}/invitations`,{email:f.get("email")});}}><label>Invite partner administrator<input name="email" type="email" autoComplete="off" required /></label><button>Create passwordless invitation</button></form>
      {organization.invitations.map((i)=><p key={i.id}>{i.email} · {i.role} · {i.status}</p>)}
      {organization.members.map((m)=><p key={m.userId}>{m.email} · {m.role} · {m.status} {m.status==="active"&&<button onClick={()=>void mutate(`/api/staff/partners/organizations/${organization.id}/members/${m.userId}/status`,{status:"suspended"})}>Suspend member</button>}</p>)}
      <button onClick={()=>void mutate(`/api/staff/partners/organizations/${organization.id}/status`,{status:organization.status==="active"?"paused":"active"})}>{organization.status==="active"?"Suspend organization":"Reactivate organization"}</button>
    </article>)}
  </section>;
}

function OperationsOverview({ isAdmin, finance, campaigns, preview, financialAction }: { isAdmin: boolean; finance: Finance | null; campaigns: StaffCampaign[]; preview: (campaignId: string, revisionId: string) => Promise<void>; financialAction: (path: string, payload: unknown) => Promise<void> }) {
  return <section className="operations-overview"><h2>Operations overview</h2>
    {finance && <><div className="account-grid"><article className="account-card"><strong>{finance.policyHolds}</strong><span> policy holds</span></article><article className="account-card"><strong>{finance.failedOutbox}</strong><span> failed outbox jobs</span></article><article className="account-card"><strong>{finance.openEscalations}</strong><span> agent escalations</span></article></div><h3>Allocation ledger</h3>{finance.allocations.length ? finance.allocations.map((allocation) => <article className="account-card" key={allocation.id}><strong>{allocation.settlementStatus === "no_proceeds" ? "No proceeds — no disbursement required" : allocation.status}</strong><p>Gross ${(allocation.grossCents/100).toFixed(2)} · eligible costs ${(allocation.eligibleCostCents/100).toFixed(2)} · allocated {allocation.allocatedCents == null ? "on hold" : `$${(allocation.allocatedCents/100).toFixed(2)}`}</p>{isAdmin && allocation.settlementStatus !== "no_proceeds" && allocation.allocatedCents != null && allocation.status === "calculated" && <form className="inline-ops" onSubmit={(event) => { event.preventDefault(); const f=new FormData(event.currentTarget); void financialAction("/api/staff/finance/disbursements/prepare", { allocationId:allocation.id, amountCents:Math.round(Number(f.get("amount"))*100), paymentMemo:f.get("memo"), evidence:{reference:f.get("evidence")} }); }}><p>The canonical charity is derived from this allocation and cannot be replaced here.</p><label>Prepare amount ($)<input name="amount" type="number" min="0.01" max={(allocation.allocatedCents/100).toFixed(2)} step="0.01" required /></label><label>Optional payment memo<input name="memo" /></label><label>Evidence reference<input name="evidence" /></label><button>Prepare manual disbursement</button></form>}</article>) : <p>No proceeds allocations recorded.</p>}<h3>Manual disbursement ledger</h3>{finance.disbursements.length ? finance.disbursements.map((entry) => <article className="account-card" key={entry.id}><strong>{entry.status}</strong><p>Preparation {entry.preparationId}</p>{isAdmin && entry.status==="prepared" && <form className="inline-ops" onSubmit={(event)=>{event.preventDefault();const f=new FormData(event.currentTarget);void financialAction(`/api/staff/finance/disbursements/${entry.preparationId}/decision`,{outcome:f.get("outcome"),reason:f.get("reason")});}}><label>Decision<select name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label>Reason<input name="reason" /></label><button>Record decision</button></form>}{isAdmin && entry.status==="approved" && <form className="inline-ops" onSubmit={(event)=>{event.preventDefault();const f=new FormData(event.currentTarget);void financialAction(`/api/staff/finance/disbursements/${entry.preparationId}/complete`,{externalReference:f.get("reference")});}}><label>External payment reference<input name="reference" required /></label><button>Record externally completed payment</button></form>}</article>) : <p>No disbursements recorded.</p>}</>}
    <h2>Campaign review</h2>{campaigns.length ? <div className="account-grid">{campaigns.map((campaign) => <article className="account-card" key={campaign.id}><p className="kicker">{campaign.status}</p><h3>{campaign.name}</h3><p>{campaign.organizationName} · {campaign.charityName}</p>{campaign.revisions.filter((revision) => ["staff_review","approved"].includes(revision.status)).map((revision) => <div key={revision.id}><strong>Revision {revision.version}: {revision.headline}</strong><p>{revision.summary}</p><small>Checksum {revision.contentHash}</small><br /><button onClick={() => void preview(campaign.id, revision.id)}>Review exact revision</button></div>)}</article>)}</div> : <p>No campaign drafts are waiting for review.</p>}
  </section>;
}

function CampaignRevisionPreview({ preview, canPublish, publish, close }: { preview: CampaignPreview; canPublish: boolean; publish: (campaignId: string, revisionId: string) => Promise<void>; close: () => void }) {
  const { revision } = preview;
  const heroUrl = revision.heroAsset && safePrivateAssetUrl(revision.heroAsset.imageUrl, ["/api/staff/campaign-assets/"]);
  const supportingUrl = revision.supportingAsset && safePrivateAssetUrl(revision.supportingAsset.imageUrl, ["/api/staff/campaign-assets/"]);
  return <section className="account-card campaign-staff-preview" aria-label="Exact campaign revision preview"><button className="button text" onClick={close}>Close preview</button><p className="kicker">Exact draft revision {revision.version}</p><h2>{revision.headline}</h2><p><strong>{preview.campaign.name}</strong> · {preview.organization.name} · supporting {preview.charity.name}</p><p><strong>Exact revision ID:</strong> <code>{revision.id}</code></p><RevisionChanges fields={preview.changedFields} differs={preview.differsFromPublished} /><p>{revision.summary}</p><div className="campaign-preview-story">{revision.story.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><p><strong>CTA:</strong> {revision.ctaLabel}</p><p><strong>Phone goal:</strong> {revision.phoneGoal ?? "No public goal"}<br /><strong>Campaign window:</strong> {revision.startsAt ? new Date(revision.startsAt).toLocaleString() : "No start date"} – {revision.endsAt ? new Date(revision.endsAt).toLocaleString() : "No end date"} ({revision.timezone || "UTC"})</p>{revision.heroAsset && heroUrl && <figure><img src={heroUrl} alt={revision.heroAsset.isDecorative ? "" : revision.heroAsset.altText || "Campaign hero"} aria-hidden={revision.heroAsset.isDecorative || undefined} /><figcaption>Hero · SHA-256 {revision.heroAsset.contentSha256}</figcaption></figure>}{revision.supportingAsset && supportingUrl && <figure><img src={supportingUrl} alt={revision.supportingAsset.isDecorative ? "" : revision.supportingAsset.altText || "Campaign supporting image"} aria-hidden={revision.supportingAsset.isDecorative || undefined} /><figcaption>Supporting image · SHA-256 {revision.supportingAsset.contentSha256}</figcaption></figure>}<h3>Structured blocks</h3>{revision.blocks.map((block, index) => <article key={index}><strong>{index + 1}. {block.type}</strong>{Object.entries(block.content).map(([key, value]) => <p key={key}><strong>{key}:</strong> {value}</p>)}</article>)}<p><strong>Full revision hash:</strong> {revision.contentHash}</p>{canPublish && revision.status === "approved" ? <button className="button primary" onClick={() => void publish(preview.campaign.id, revision.id)}>Publish this exact approved revision</button> : <p className="financial-warning">This exact revision must be approved by an administrator before publication.</p>}</section>;
}

function ProfileRevisionPreview({ preview, canPublish, publish, close }: { preview: ProfilePreview; canPublish: boolean; publish: (organizationId: string, revisionId: string) => Promise<void>; close: () => void }) {
  const { revision } = preview;
  const logoUrl = revision.logoAsset && safePrivateAssetUrl(revision.logoAsset.imageUrl, ["/api/staff/organization-assets/"]);
  const heroUrl = revision.heroAsset && safePrivateAssetUrl(revision.heroAsset.imageUrl, ["/api/staff/organization-assets/"]);
  return <section className="account-card campaign-staff-preview" aria-label="Exact organization profile revision preview"><button className="button text" onClick={close}>Close preview</button><p className="kicker">Exact profile revision {revision.version}</p><h2>{preview.organization.name}</h2><p><strong>Exact revision ID:</strong> <code>{revision.id}</code></p><RevisionChanges fields={preview.changedFields} differs={preview.differsFromPublished} /><p><strong>{revision.mission}</strong></p><p>{revision.summary}</p>{safeExternalHttpsUrl(revision.websiteUrl) && <p><a href={safeExternalHttpsUrl(revision.websiteUrl)!} target="_blank" rel="noopener noreferrer">{revision.websiteUrl}</a><br />{[revision.locality,revision.region,revision.countryCode].filter(Boolean).join(", ")}</p>}{revision.logoAsset && logoUrl && <figure><img src={logoUrl} alt={revision.logoAsset.isDecorative ? "" : revision.logoAsset.altText || "Organization logo"} aria-hidden={revision.logoAsset.isDecorative || undefined} /><figcaption>Logo · SHA-256 {revision.logoAsset.contentSha256}</figcaption></figure>}{revision.heroAsset && heroUrl && <figure><img src={heroUrl} alt={revision.heroAsset.isDecorative ? "" : revision.heroAsset.altText || "Organization hero"} aria-hidden={revision.heroAsset.isDecorative || undefined} /><figcaption>Hero image · SHA-256 {revision.heroAsset.contentSha256}</figcaption></figure>}{canPublish && revision.status === "approved" ? <button className="button primary" onClick={() => void publish(preview.organization.id,revision.id)}>Publish this exact approved profile</button> : <p className="financial-warning">This exact revision must be approved by an administrator before publication.</p>}</section>;
}

function RevisionChanges({ fields,differs }: { fields: string[]; differs: boolean }) {
  if (!differs) return <p>This is the currently published revision.</p>;
  return <div className="review-feedback"><strong>Changed from the published version</strong><p>{fields.length ? fields.join(", ") : "No field-level content changes detected."}</p></div>;
}

function DonationDetail({ detail, mutate }: { detail: Detail; mutate: (path: string, payload: unknown) => Promise<void> }) {
  const base = `/api/staff/donations/${detail.id}`;
  const finalized = Boolean(detail.financial?.finalizedAt);
  return <article className="staff-detail"><h2>{detail.publicId}</h2><p><strong>{detail.donor.name}</strong> · {detail.donor.email}<br />{detail.donor.address1} {detail.donor.address2}<br />{detail.donor.city}, {detail.donor.state} {detail.donor.zip} {detail.donor.country}<br />Charity: {detail.charity.name}</p>
    {detail.financial && <FinancialControls financial={detail.financial} donationId={detail.id} mutate={mutate} />}
    <section><h3>Receive package</h3>{detail.receivedAt ? <p><strong>Receipt confirmed</strong><br />{new Date(detail.receivedAt).toLocaleString()}<br />{detail.packageCondition}</p> : <form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void mutate(`${base}/receipt`, { receiptTime: new Date().toISOString(), packageCondition: form.get("condition"), deviceReceipts: detail.devices.map((device) => ({ deviceId: device.id, received: form.get(`received-${device.id}`) === "on" })) }); }}><label>Package condition<input name="condition" required placeholder="e.g. sealed, box intact" /></label>{detail.devices.map((d) => <label className="check" key={d.id}><input type="checkbox" name={`received-${d.id}`} defaultChecked />Received: {d.donor_brand} {d.donor_model}</label>)}<button>Confirm physical receipt</button></form>}</section>
    <section><h3>Devices</h3>{detail.devices.map((device) => <div key={device.id}><DeviceForm device={device} readOnly={finalized} onSave={(patch) => mutate(`${base}/devices/${device.id}`, patch)} />{!finalized && <form className="inline-ops" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate("/api/staff/finance/sales", { deviceId: device.id, grossAmountCents: Math.round(Number(f.get("gross"))*100), channel: f.get("channel"), externalReference: f.get("reference") }); }}><h4>Record completed sale</h4><label>Gross amount ($)<input name="gross" type="number" min="0" step="0.01" required /></label><label>Channel<input name="channel" required /></label><label>External reference<input name="reference" /></label><button>Record sale</button></form>}</div>)}{!finalized && <><form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void mutate(`${base}/unexpected-devices`, { actualBrand: form.get("brand"), actualModel: form.get("model") }); }}><h4>Add unexpected device</h4><label>Brand<input name="brand" required /></label><label>Model<input name="model" required /></label><button>Add device</button></form><form className="inline-ops" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate("/api/staff/finance/costs", { donationId: detail.id, category: f.get("category"), amountCents: Math.round(Number(f.get("amount"))*100), evidenceReference: f.get("evidence") }); }}><h4>Record eligible-cost candidate</h4><label>Category<input name="category" pattern="[a-z][a-z0-9_]{2,79}" required placeholder="shipping_materials" /></label><label>Amount ($)<input name="amount" type="number" min="0" step="0.01" required /></label><label>Evidence reference<input name="evidence" /></label><button>Record cost</button><small>Whether this cost is deductible is determined by the donation’s versioned proceeds policy.</small></form><form className="inline-ops" onSubmit={(e)=>{e.preventDefault();void mutate("/api/staff/finance/finalize",{donationId:detail.id});}}><h4>Finalize financial inputs</h4><p>Freeze the reconciled eligible-device set, effective sales, and eligible costs. Later corrections require an explicit reopen.</p><button>Finalize and calculate allocation</button></form></>}</section>
    <section><h3>Change donor-visible status</h3>{nextStatuses[detail.status]?.length ? <form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void mutate(`${base}/status`, { status: form.get("status"), publicMessage: form.get("message") }); }}><label>Status<select name="status">{nextStatuses[detail.status].map((status) => <option key={status}>{status}</option>)}</select></label><label>Public message<textarea name="message" required /></label><button>Save status and notify donor</button></form> : <p>No further status changes are available.</p>}</section>
    <section><h3>Internal notes</h3><form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void mutate(`${base}/notes`, { note: form.get("note") }); }}><label>Private staff note<textarea name="note" required /></label><button>Add internal note</button></form>{detail.notes.map((note) => <p key={note.id}><strong>{new Date(note.createdAt).toLocaleString()}</strong><br />{note.body}</p>)}</section>
  </article>;
}

function FinancialControls({ financial, donationId, mutate }: { financial: Financial; donationId: string; mutate: (path: string, payload: unknown) => Promise<void> }) {
  const open = !financial.finalizedAt;
  return <section className="financial-controls"><h3>Financial correction history</h3><p><strong>Revision {financial.revision}</strong> · {open ? "Open for staff corrections" : `Finalized ${new Date(financial.finalizedAt!).toLocaleString()}`} · {financial.disbursed ? "External payment completed" : "No external payment completed"}</p>{financial.activeAllocation && <p>Current allocation: <strong>{financial.activeAllocation.settlement_status === "no_proceeds" ? "no proceeds — no disbursement required" : financial.activeAllocation.status}</strong> · gross ${(financial.activeAllocation.gross_cents / 100).toFixed(2)} · eligible costs ${(financial.activeAllocation.eligible_cost_cents / 100).toFixed(2)} · allocated {financial.activeAllocation.allocated_cents == null ? "policy hold" : `$${(financial.activeAllocation.allocated_cents / 100).toFixed(2)}`}</p>}
    {!open && !financial.disbursed && <form className="inline-ops" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate("/api/staff/finance/reopen", { donationId, reason: form.get("reason") }); }}><h4>Reopen financials</h4><p>The previous allocation remains immutable in the audit history. Reopening creates a new correction revision.</p><label>Correction reason<textarea name="reason" required /></label><button>Reopen financials</button></form>}
    {!open && financial.disbursed && <p className="financial-warning">This donation has a completed external payout. Reopening is unavailable; use the separate adjustment process.</p>}
    <h4>Recorded sales</h4>{financial.sales.length ? financial.sales.map((sale) => <div className="financial-entry" key={sale.id}><span>{sale.status} · ${(sale.gross_amount_cents / 100).toFixed(2)}{sale.external_reference ? ` · ${sale.external_reference}` : ""}</span>{open && sale.status === "recorded" && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate(`/api/staff/finance/sales/${sale.id}/reverse`, { reason: form.get("reason") }); }}><input name="reason" placeholder="Reason required" required /><button>Reverse sale</button></form>}</div>) : <p>No sales recorded.</p>}
    <h4>Recorded costs</h4>{financial.costs.length ? financial.costs.map((cost) => <div className="financial-entry" key={cost.id}><span>{cost.status} · {cost.category} · ${(cost.amount_cents / 100).toFixed(2)}</span>{open && cost.status === "recorded" && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate(`/api/staff/finance/costs/${cost.id}/reverse`, { reason: form.get("reason") }); }}><input name="reason" placeholder="Reason required" required /><button>Reverse cost</button></form>}</div>) : <p>No costs recorded.</p>}
  </section>;
}

function DeviceForm({ device, readOnly = false, onSave }: { device: Device; readOnly?: boolean; onSave: (patch: unknown) => Promise<void> }) {
  return <form className="device-ops" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (readOnly) return; const f = new FormData(e.currentTarget); void onSave({ actualBrand: f.get("brand"), actualModel: f.get("model"), inspectionStatus: f.get("inspection"), processingStatus: f.get("processing"), dataWipeStatus: f.get("wipe"), assessedValueCents: f.get("value") ? Math.round(Number(f.get("value")) * 100) : null }); }}><h4>{device.actual_brand || device.donor_brand} {device.actual_model || device.donor_model}</h4>{readOnly && <p className="financial-warning">Financial inputs are finalized. Reopen the revision before changing device facts.</p>}<label>Actual brand<input name="brand" defaultValue={device.actual_brand || device.donor_brand} readOnly={readOnly} /></label><label>Actual model<input name="model" defaultValue={device.actual_model || device.donor_model} readOnly={readOnly} /></label><label>Inspection<select name="inspection" defaultValue={device.inspection_status} disabled={readOnly}><option>pending</option><option>inspecting</option><option>inspected</option><option>blocked</option></select></label><label>Processing<select name="processing" defaultValue={device.processing_status} disabled={readOnly}><option>pending</option><option>reuse</option><option>resale</option><option>parts</option><option>recycle</option><option>returned</option><option>complete</option></select></label><label>Data wipe<select name="wipe" defaultValue={device.data_wipe_status} disabled={readOnly}><option>not_started</option><option>pending</option><option>completed</option><option>not_required</option><option>blocked</option></select></label><label>Assessed value ($)<input name="value" type="number" min="0" step="0.01" defaultValue={device.assessed_value_cents == null ? "" : device.assessed_value_cents / 100} readOnly={readOnly} /></label>{!readOnly && <button>Save device inspection</button>}</form>;
}
