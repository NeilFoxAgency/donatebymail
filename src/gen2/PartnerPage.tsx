import { FormEvent, useEffect, useRef, useState } from "react";
import { BarChart3, Check, Clipboard, FileText, History, Image, LayoutDashboard, LogOut, Megaphone, Settings, Users } from "lucide-react";
import { authenticatedApi, authenticatedUpload, logout, publicApi, sessionStatus } from "./AuthSession";
import { TURNSTILE_SITE_KEY, TurnstileWidget } from "./TurnstileWidget";
import { safePrivateAssetUrl } from "./urlSafety";

type Metrics = { views: number; donationStarts: number; submittedDonations: number; phonesPledged: number; phonesReceived: number; phonesProcessed: number; completedDonations: number; sources?: Record<string, number> };
type Financial = { grossProceedsCents: number; eligibleCostCents: number; allocableBaseCents: number; allocationCents: number; provisional: boolean; disbursementStatus: string; policyVersions?: Array<{ id: string; version: number; shareBasisPoints?: number; calculationMethod: string }> };
type CampaignSummary = { id: string; slug: string; name: string; status: string; charityName: string; phoneGoal?: number | null; startsAt?: string | null; endsAt?: string | null; reviewState: string; reviewFeedback?: string | null; metrics: Metrics; financial: Financial };
type Charity = { id: string; name: string; pledgeId: string };
type TeamMember = { userId: string; email: string; role: string; status: string };
type Invitation = { id: string; email: string; role: string; status: string; expiresAt: string };
type Organization = { id: string; name: string; slug: string; role: "partner_admin" | "partner_editor" | "partner_viewer"; onboarding: Record<string, boolean>; campaigns: CampaignSummary[]; verifiedCharities: Charity[]; team: TeamMember[]; invitations: Invitation[]; recentActivity: Array<{ type: string; entityType: string; occurredAt: string }> };
type CampaignBlock = { type: "text" | "callout" | "statistic" | "quote"; content: Record<string, string> };
type CampaignDraft = { stage: number; headline: string; summary: string; story: string; ctaLabel: string; blocks: CampaignBlock[]; toolkit: Record<string, string>; heroAssetId?: string | null; supportingAssetId?: string | null; phoneGoal?: number | null; startsAt?: string | null; endsAt?: string | null; timezone: string; partnerReady: boolean; reviewState: string; reviewFeedback?: string | null; lockVersion: number };
type EditableCampaignDraft = CampaignDraft & { name: string };
type UpdateCampaignDraft = <K extends keyof EditableCampaignDraft>(key: K,value: EditableCampaignDraft[K]) => void;
type CampaignWorkspace = { campaign: { id: string; name: string; slug: string; status: string; charityName: string; phoneGoal?: number | null; startsAt?: string | null; endsAt?: string | null }; draft: CampaignDraft; metrics: Metrics; financial: Financial; toolkit: { canonicalUrl: string; vanityUrl?: string | null; sourceLinks: Record<string, string> }; assets: Array<{ id: string; assetKind: string; altText: string; previewUrl: string; used: boolean; width: number; height: number }>; revisions: Array<{ id: string; version: number; status: string; headline: string; summary: string; contentHash: string; createdAt: string; publishedAt?: string | null }>; reviews: Array<{ revisionId: string; outcome: string; feedback?: string | null; actorKind: string; createdAt: string }> };
type ProfileDetail = { organization: { id: string; name: string; slug: string; activeRevisionId?: string | null }; draft?: { mission: string; summary: string; websiteUrl: string; locality?: string; region?: string; countryCode: string; logoAssetId?: string | null; heroAssetId?: string | null; reviewState: string; reviewFeedback?: string | null; lockVersion: number }; assets: Array<{ id: string; assetKind: string; altText: string; previewUrl: string; used: boolean }>; revisions: Array<{ id: string; version: number; status: string; contentHash: string; createdAt: string }> };
type Tab = "overview" | "campaigns" | "profile" | "reports" | "team" | "activity";

const STEPS = ["Basics", "Beneficiary & terms", "Goal & dates", "Page content", "Preview", "Promotion toolkit", "Approval & review"];
const ONBOARDING_ITEMS = [
  { key: "organizationProfile", label: "Tell us about your organization", hint: "A short public description helps supporters understand who you are.", tab: "profile" as Tab },
  { key: "verifiedBeneficiary", label: "Confirm the nonprofit beneficiary", hint: "Donate by Mail verifies the organization that receives campaign proceeds.", tab: "profile" as Tab },
  { key: "team", label: "Invite a teammate (optional)", hint: "Give a trusted editor a way to help without sharing your sign-in link.", tab: "team" as Tab },
  { key: "campaignTerms", label: "Review campaign proceeds terms", hint: "We show the approved policy before anything is published.", tab: "campaigns" as Tab },
  { key: "campaignContent", label: "Write your campaign story", hint: "Use everyday language; you can revise it before review.", tab: "campaigns" as Tab },
  { key: "launchDates", label: "Choose when the campaign runs", hint: "Dates are optional while you are preparing the draft.", tab: "campaigns" as Tab },
  { key: "toolkit", label: "Prepare promotion materials", hint: "Copy a link, download a QR code, or print a flyer.", tab: "campaigns" as Tab },
  { key: "publicationReview", label: "Submit for staff review", hint: "A Donate by Mail staff member checks the exact revision before publication.", tab: "campaigns" as Tab },
] as const;
const money = (value = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
const dateInput = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";
const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export function PartnerPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const loadRequestRef = useRef(0);
  async function load() {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const body = await authenticatedApi("/api/partner/overview");
      const next = body.partner.organizations || [];
      if (requestId !== loadRequestRef.current) return;
      setOrganizations(next);
      setOrganizationId((current) => current && next.some((item: Organization) => item.id === current) ? current : next[0]?.id || "");
    } finally { if (requestId === loadRequestRef.current) setLoading(false); }
  }
  useEffect(() => { sessionStatus("/api/partner/session").then(setAuthenticated).catch(() => setAuthenticated(false)); }, []);
  useEffect(() => { if (authenticated === false) { loadRequestRef.current += 1; setOrganizations([]); setOrganizationId(""); setTab("overview"); } }, [authenticated]);
  useEffect(() => { if (authenticated) void load().catch((error) => { setMessage(error.message); setAuthenticated(false); }); }, [authenticated]);
  const organization = organizations.find(({ id }) => id === organizationId);
  if (authenticated === null) return <main className="operations-main"><section className="operations-shell compact"><p role="status">Checking your secure session…</p></section></main>;
  if (!authenticated) return <PartnerSignIn email={email} setEmail={setEmail} message={message} setMessage={setMessage} />;
  return <main className="operations-main partner-workspace"><section className="operations-shell">
    <header className="workspace-header"><div><p className="kicker">Nonprofit workspace</p><h1>{organization?.name || "Partner dashboard"}</h1><p>Campaign planning, review, promotion, and aggregate reporting in one place.</p></div>
      <div className="workspace-actions">{organizations.length > 1 && <label>Organization<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<a className="button text" href="/settings">Account security</a><button className="button text" disabled={logoutBusy} onClick={async () => { if (logoutBusy) return; setLogoutBusy(true); try { await logout(); setAuthenticated(false); } catch (error) { setMessage(error instanceof Error ? error.message : "Sign out failed. Please try again."); setLogoutBusy(false); } }}><LogOut aria-hidden="true" /> {logoutBusy ? "Signing out…" : "Sign out"}</button></div></header>
    {message && <p className="workspace-message" role="status">{message}</p>}
    {loading && <p role="status">Refreshing workspace…</p>}
    {!organization ? <div className="empty-panel"><h2>No active partner membership</h2><p>Your sign-in is valid, but this address does not have an active nonprofit workspace.</p><a href="/partner/apply">Apply for a partnership</a></div> : <>
      <nav className="workspace-tabs" aria-label="Partner workspace">{([
        ["overview",LayoutDashboard,"Overview"],["campaigns",Megaphone,"Campaigns"],["profile",Settings,"Organization profile"],
        ["reports",BarChart3,"Reports"],["team",Users,"Team"],["activity",History,"Activity"],
      ] as const).map(([value,Icon,label]) => <button key={value} aria-current={tab === value ? "page" : undefined} onClick={() => setTab(value)}><Icon aria-hidden="true" />{label}</button>)}</nav>
      {tab === "overview" && <Overview organization={organization} selectCampaign={() => setTab("campaigns")} selectTab={setTab} />}
      {tab === "campaigns" && <Campaigns organization={organization} refresh={load} notify={setMessage} />}
      {tab === "profile" && <Profile organization={organization} refresh={load} notify={setMessage} />}
      {tab === "reports" && <Reports organization={organization} />}
      {tab === "team" && <Team organization={organization} refresh={load} notify={setMessage} />}
      {tab === "activity" && <Activity organization={organization} />}
    </>}
  </section></main>;
}

function PartnerSignIn({ email, setEmail, message, setMessage }: { email: string; setEmail: (value: string) => void; message: string; setMessage: (value: string) => void }) {
  const [turnstileToken, setTurnstileToken] = useState("");
  const [sending, setSending] = useState(false);
  return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Nonprofit partners</p><h1>Partner sign in</h1><p>Use an email address associated with your organization. We will send a one-time secure link.</p>
    <form onSubmit={async (event) => { event.preventDefault(); if (sending) return; setSending(true); try { if (TURNSTILE_SITE_KEY && !turnstileToken) throw new Error("Please complete the security verification."); const body = await publicApi<{ message?: string }>("/api/partner/auth/magic-link", { method: "POST", body: JSON.stringify({ email, turnstileToken }) }); setMessage(body.message || "If the address is authorized, a secure link is on its way."); } catch (error) { setMessage(error instanceof Error ? error.message : "We could not request a secure link."); } finally { setSending(false); } }}>
      <label>Email<input name="partner-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" required disabled={sending} /></label><TurnstileWidget action="auth_magic_link" onToken={setTurnstileToken} /><button className="button primary" disabled={sending}>{sending ? "Sending…" : "Email secure sign-in link"}</button></form>{message && <p role="status">{message}</p>}
  </section></main>;
}

function Overview({ organization, selectCampaign, selectTab }: { organization: Organization; selectCampaign: () => void; selectTab: (tab: Tab) => void }) {
  // Render the same known checklist that the progress meter counts. This
  // keeps the headline and visible rows consistent if the API adds an
  // internal onboarding flag that is not yet actionable in the workspace.
  const onboardingItems = ONBOARDING_ITEMS.filter((item) => item.key in organization.onboarding);
  const completed = onboardingItems.filter((item) => organization.onboarding[item.key]).length;
  const metrics = organization.campaigns.reduce((sum, item) => ({ views: sum.views + item.metrics.views, starts: sum.starts + item.metrics.donationStarts, received: sum.received + item.metrics.phonesReceived }), { views: 0, starts: 0, received: 0 });
  const firstIncomplete = onboardingItems.find((item) => !organization.onboarding[item.key]);
  return <div className="workspace-panel"><section className="dashboard-hero"><div><p className="kicker">Getting started</p><h2>{completed} of {onboardingItems.length} essentials complete</h2><p className="dashboard-intro">You do not need technical skills to run a campaign. We will guide you one small step at a time, and nothing becomes public until you approve it.</p>{onboardingItems.length > 0 && <progress max={onboardingItems.length} value={completed}>{completed}/{onboardingItems.length}</progress>}{firstIncomplete && <button className="button primary" onClick={() => selectTab(firstIncomplete.tab)}>{firstIncomplete.key === "campaignContent" ? "Continue campaign setup" : "Continue organization setup"}</button>}</div><ul>{onboardingItems.map((item) => { const value = organization.onboarding[item.key]; return <li key={item.key} className={value ? "complete" : ""}><Check aria-hidden="true" /><span><strong>{item.label}</strong><small>{value ? "Complete" : item.hint}</small></span>{!value && <button className="button text" onClick={() => selectTab(item.tab)}>Open</button>}</li>; })}</ul></section>
    <section><div className="panel-heading"><div><p className="kicker">At a glance</p><h2>Campaign performance</h2></div><button className="button text" onClick={selectCampaign}>Manage campaigns</button></div><div className="metric-grid"><Metric label="Page views" value={metrics.views} /><Metric label="Donation starts" value={metrics.starts} /><Metric label="Phones received" value={metrics.received} /><Metric label="Active campaigns" value={organization.campaigns.filter(({ status }) => status === "published").length} /></div></section>
    <section><h2>Campaigns needing attention</h2><div className="account-grid">{organization.campaigns.filter(({ reviewState,status }) => reviewState !== "editing" || status === "draft").slice(0,4).map((campaign) => <article className="account-card" key={campaign.id}><span className="status-pill">{campaign.reviewState}</span><h3>{campaign.name}</h3><p>{campaign.reviewFeedback || `Supporting ${campaign.charityName}`}</p></article>)}</div></section>
  </div>;
}

function Metric({ label, value }: { label: string; value: number | string }) { return <article className="metric-card"><strong>{value}</strong><span>{label}</span></article>; }

function Campaigns({ organization, refresh, notify }: { organization: Organization; refresh: () => Promise<void>; notify: (value: string) => void }) {
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [workspace, setWorkspace] = useState<CampaignWorkspace | null>(null);
  const [workspaceOrganizationId, setWorkspaceOrganizationId] = useState("");
  const [message, setMessage] = useState("");
  const openRequestRef = useRef(0);
  useEffect(() => {
    // Organization switching must invalidate the previous campaign workspace
    // before the next render can display it. A partner may belong to more than
    // one tenant, so retaining the prior workspace would be a cross-tenant
    // privacy leak and could direct a mutation at the wrong organization.
    openRequestRef.current += 1;
    setWorkspace(null);
    setWorkspaceOrganizationId("");
    setSelectedId("");
    setCreating(false);
    setMessage("");
  }, [organization.id]);
  async function open(id: string) {
    const requestId = ++openRequestRef.current;
    const requestedOrganizationId = organization.id;
    setMessage(""); setSelectedId(id);
    try {
      const body = await authenticatedApi(`/api/partner/campaigns/${id}`);
      if (requestId === openRequestRef.current && requestedOrganizationId === organization.id) {
        setWorkspace(body.workspace);
        setWorkspaceOrganizationId(requestedOrganizationId);
      }
    } catch (error) {
      if (requestId === openRequestRef.current && requestedOrganizationId === organization.id) {
        setWorkspace(null); setSelectedId("");
        setMessage(error instanceof Error ? error.message : "The campaign could not be opened.");
      }
    }
  }
  if (workspace && selectedId && workspaceOrganizationId === organization.id) return <CampaignBuilder workspace={workspace} role={organization.role} close={() => { setWorkspace(null); setWorkspaceOrganizationId(""); setSelectedId(""); void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "The campaign list could not be refreshed.")); }} reload={() => open(selectedId)} notify={notify} />;
  const groups = ["published","scheduled","draft","ended","archived"].map((status) => ({ status, items: organization.campaigns.filter((campaign) => campaign.status === status) })).filter(({ items }) => items.length);
  return <div className="workspace-panel"><div className="panel-heading"><div><p className="kicker">Campaigns</p><h2>Plan, review, and promote</h2><p className="panel-intro">Start with a private draft. We will ask for the essentials first, then give you a fuller editor when you are ready.</p></div>{organization.role === "partner_admin" && <button className="button primary" onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "Create campaign"}</button>}</div>{message && <p role="alert">{message}</p>}
    {creating && <CreateCampaign organization={organization} done={async (id) => { setCreating(false); await refresh(); await open(id); }} />}
    {groups.map(({ status,items }) => <section key={status}><h3 className="campaign-group-title">{status}</h3><div className="account-grid">{items.map((campaign) => <article className="account-card" key={campaign.id}><span className="status-pill">{campaign.reviewState || campaign.status}</span><h3>{campaign.name}</h3><p>Supporting {campaign.charityName}</p><p>{campaign.metrics.phonesReceived} phones received · {campaign.metrics.views} views</p><button className="button text" onClick={() => void open(campaign.id)}>{organization.role === "partner_viewer" ? "View dashboard" : "Open campaign"}</button></article>)}</div></section>)}
    {!organization.campaigns.length && !creating && <div className="empty-panel"><h3>No campaigns yet</h3><p>Create a draft after Donate by Mail verifies the nonprofit beneficiary.</p><ul className="plain-language-list"><li>Answer four short groups of questions.</li><li>Review the wording before you save anything.</li><li>Invite a teammate later if you want help.</li></ul><button className="button primary" onClick={() => setCreating(true)} disabled={organization.role !== "partner_admin"}>{organization.role === "partner_admin" ? "Start my first campaign" : "Ask an admin to start a campaign"}</button></div>}
  </div>;
}

function CreateCampaign({ organization, done }: { organization: Organization; done: (id: string) => Promise<void> }) {
  type WizardStep = 1 | 2 | 3 | 4;
  type Details = { name: string; slug: string; charityId: string; headline: string; summary: string; story: string; phoneGoal: string };
  const [step, setStep] = useState<WizardStep>(1);
  const [details, setDetails] = useState<Details>({ name: "", slug: "", charityId: "", headline: "", summary: "", story: "", phoneGoal: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "error">("idle");
  const slugStatusRef = useRef<"idle" | "checking" | "available" | "taken" | "error">("idle");
  const slugRequestRef = useRef(0);
  const setSlugCheckStatus = (status: "idle" | "checking" | "available" | "taken" | "error") => { slugStatusRef.current = status; setSlugStatus(status); };
  const update = <K extends keyof Details>(key: K, value: Details[K]) => setDetails((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    const slug = slugify(details.slug);
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { setSlugCheckStatus("idle"); return; }
    const requestId = ++slugRequestRef.current;
    setSlugCheckStatus("checking");
    const timer = window.setTimeout(() => {
      void authenticatedApi(`/api/partner/organizations/${organization.id}/campaign-slugs/${slug}`)
        .then((body) => { if (requestId === slugRequestRef.current) setSlugCheckStatus(body.available ? "available" : "taken"); })
        .catch(() => { if (requestId === slugRequestRef.current) setSlugCheckStatus("error"); });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [details.slug, organization.id]);
  const selectedCharity = organization.verifiedCharities.find((charity) => charity.id === details.charityId);
  const canContinue = (current: WizardStep) => {
    if (current === 1) return details.name.trim().length >= 3 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugify(details.slug)) && slugStatusRef.current !== "taken";
    if (current === 2) return Boolean(details.charityId);
    return details.headline.trim().length >= 8 && details.summary.trim().length >= 20 && details.story.trim().length >= 40;
  };
  const next = () => { setMessage(""); if (!canContinue(step)) { setMessage(step === 1 ? slugStatusRef.current === "taken" ? "That campaign link is already in use. Try a different link." : "Please choose a campaign name and a simple web link." : step === 2 ? "Choose the verified nonprofit this campaign will support." : "Add a clear headline, a short explanation, and a few sentences about the campaign."); return; } setStep((current) => Math.min(4, current + 1) as WizardStep); };
  async function create() {
    if (saving || !canContinue(3)) { setMessage("Finish the campaign details before creating the draft."); return; }
    setSaving(true); setMessage("");
    try {
      const body = await authenticatedApi("/api/partner/campaigns", { method: "POST", body: JSON.stringify({
        organizationId: organization.id, charityId: details.charityId, slug: slugify(details.slug), name: details.name.trim(),
        headline: details.headline.trim(), summary: details.summary.trim(), story: details.story.trim(), ctaLabel: "Donate a Phone",
        phoneGoal: details.phoneGoal ? Number(details.phoneGoal) : null, startsAt: null, endsAt: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York", blocks: [], toolkit: {},
      }) });
      await done(body.result.campaignId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We could not create the draft. Your answers are still here; please try again."); }
    finally { setSaving(false); }
  }
  return <form className="campaign-editor create-campaign wizard-card" onSubmit={(event) => { event.preventDefault(); if (step === 4) void create(); else next(); }}>
    <div className="wizard-heading"><div><p className="kicker">First campaign setup</p><h3>Let’s build this together</h3><p>Answer a few simple questions. This creates a private draft only; a Donate by Mail staff member reviews the exact page before it can go public.</p></div><span className="wizard-count">Step {step} of 4</span></div>
    <ol className="wizard-progress" aria-label="Campaign setup progress">{["Name it", "Choose support", "Tell the story", "Review"].map((label, index) => <li key={label} className={index + 1 === step ? "current" : index + 1 < step ? "complete" : ""}><span>{index + 1}</span>{label}</li>)}</ol>
    {step === 1 && <section className="wizard-step" aria-labelledby="campaign-wizard-name"><h4 id="campaign-wizard-name">1. Give your campaign a clear name</h4><p className="form-hint">Use words your supporters will recognize, such as “Spring phone drive” or “Phones for the community.” You can change the public wording later.</p><label>Campaign name<input autoFocus name="name" value={details.name} onChange={(event) => { update("name", event.target.value); update("slug", slugify(event.target.value)); }} maxLength={200} aria-describedby="campaign-name-hint" required /><small id="campaign-name-hint">This is an internal working name and can be changed later.</small></label><label>Campaign link<input name="slug" value={details.slug} onChange={(event) => update("slug", slugify(event.target.value))} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="campaign-slug-hint" required />{slugStatus === "checking" && <small role="status">Checking whether this link is available…</small>}{slugStatus === "available" && <small className="form-success" role="status">This link is available.</small>}{slugStatus === "taken" && <small className="form-error" role="alert">That link is already in use. Try adding your organization or year.</small>}{slugStatus === "error" && <small className="form-error" role="alert">We could not check the link yet. Check your connection and try again.</small>}<small id="campaign-slug-hint">Use lowercase letters, numbers, and hyphens. Supporters will see this in the web address.</small></label></section>}
    {step === 2 && <section className="wizard-step" aria-labelledby="campaign-wizard-support"><h4 id="campaign-wizard-support">2. Choose what the campaign supports</h4><p className="form-hint">Only verified nonprofit beneficiaries appear here. This protects your organization and helps supporters know where the proceeds are intended to go.</p><label>Verified nonprofit<select autoFocus name="charityId" value={details.charityId} onChange={(event) => update("charityId", event.target.value)} required><option value="">Choose a verified nonprofit</option>{organization.verifiedCharities.map((charity) => <option value={charity.id} key={charity.id}>{charity.name}</option>)}</select></label>{selectedCharity && <div className="wizard-confirmation"><Check aria-hidden="true" /><div><strong>{selectedCharity.name}</strong><p>This beneficiary is verified by Donate by Mail. You can continue when this looks right.</p></div></div>}{!organization.verifiedCharities.length && <p className="form-error" role="alert">There are no verified beneficiaries available yet. Ask your Donate by Mail contact to finish verification before creating a campaign.</p>}</section>}
    {step === 3 && <section className="wizard-step" aria-labelledby="campaign-wizard-story"><h4 id="campaign-wizard-story">3. Tell supporters why this matters</h4><p className="form-hint">Write as if you are explaining the campaign to a neighbor. Short, honest, specific sentences work best. You can ask a teammate to polish this later.</p><label>Working headline<input autoFocus name="headline" value={details.headline} onChange={(event) => update("headline", event.target.value)} maxLength={160} required /><small>{details.headline.length}/160 characters</small></label><label>Short explanation<textarea name="summary" value={details.summary} onChange={(event) => update("summary", event.target.value)} maxLength={600} rows={3} required /><small>One or two sentences. {details.summary.length}/600 characters</small></label><label>Campaign story<textarea name="story" value={details.story} onChange={(event) => update("story", event.target.value)} maxLength={12000} rows={7} required /><small>Include who you are helping and what donated phones make possible. {details.story.length}/12,000 characters</small></label><label>Phone goal <span className="optional-label">(optional)</span><input name="phoneGoal" type="number" min="1" max="1000000" value={details.phoneGoal} onChange={(event) => update("phoneGoal", event.target.value)} /><small>Leave this blank if you are not ready to choose a number yet.</small></label></section>}
    {step === 4 && <section className="wizard-step" aria-labelledby="campaign-wizard-review"><h4 id="campaign-wizard-review">4. Review your private draft</h4><p className="form-hint">Nothing is published by this button. We create a draft, then open the full editor so you can add images, dates, promotion copy, and revisions.</p><dl className="wizard-review"><div><dt>Campaign</dt><dd>{details.name}</dd></div><div><dt>Link</dt><dd>/c/{slugify(details.slug)}</dd></div><div><dt>Supports</dt><dd>{selectedCharity?.name || "Not selected"}</dd></div><div><dt>Headline</dt><dd>{details.headline}</dd></div><div><dt>Phone goal</dt><dd>{details.phoneGoal || "Not set yet"}</dd></div></dl><div className="wizard-note"><strong>You stay in control.</strong><p>The draft is private until the exact revision passes partner and staff review. You can go back to change any answer.</p></div></section>}
    {message && <p role="alert" className="form-error wizard-message">{message}</p>}
    <div className="wizard-actions">{step > 1 ? <button type="button" className="button text" onClick={() => { setMessage(""); setStep((current) => Math.max(1, current - 1) as WizardStep); }} disabled={saving}>Back</button> : <span />}{step < 4 ? <button type="submit" className="button primary">Next: {["", "choose support", "tell the story", "review"][step]}</button> : <button type="submit" className="button primary" disabled={saving}>{saving ? "Creating private draft…" : "Create private campaign draft"}</button>}</div>
  </form>;
}

function CampaignBuilder({ workspace, role, close, reload, notify }: { workspace: CampaignWorkspace; role: Organization["role"]; close: () => void; reload: () => Promise<void>; notify: (value: string) => void }) {
  const [draft,setDraft] = useState({ ...workspace.draft, name: workspace.campaign.name });
  const [dirty,setDirty] = useState(false); const [saving,setSaving] = useState(false); const [saveState,setSaveState] = useState("All changes saved");
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft); const dirtyRef = useRef(false); const savingRef = useRef(false); const savePromiseRef = useRef<Promise<boolean> | null>(null); const editVersionRef = useRef(0);
  const editable = role !== "partner_viewer" && draft.reviewState !== "staff_review";
  useEffect(() => { const listener = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload",listener); return () => { window.removeEventListener("beforeunload",listener); if (saveRef.current) clearTimeout(saveRef.current); }; },[dirty]);
  useEffect(() => {
    // A review/restore/upload reload replaces the parent workspace. Once there
    // are no local edits, reflect that authoritative server state in the
    // builder instead of leaving stale review status or lock versions visible.
    if (dirtyRef.current) return;
    const next = { ...workspace.draft, name: workspace.campaign.name };
    draftRef.current = next;
    setDraft(next);
    setSaveState("All changes saved");
  }, [workspace.draft, workspace.campaign.name]);
  async function save(): Promise<boolean> {
    if (!editable || !dirtyRef.current) return !dirtyRef.current;
    if (savingRef.current) {
      return await (savePromiseRef.current || Promise.resolve(false));
    }
    savingRef.current=true; setSaving(true); setSaveState("Saving…");
    const submittedVersion=editVersionRef.current; const submittedDraft=draftRef.current;
    const request = (async () => {
      let saved = false;
      try {
        const body = await authenticatedApi(`/api/partner/campaigns/${workspace.campaign.id}`, { method: "PATCH", body: JSON.stringify(submittedDraft) });
        setDraft((value) => { const next={ ...value, lockVersion: body.result.lockVersion }; draftRef.current=next; return next; });
        if (editVersionRef.current===submittedVersion) { dirtyRef.current=false; setDirty(false); setSaveState("Saved"); }
        else { setSaveState("Unsaved changes"); saveRef.current=setTimeout(() => void save(),250); }
        saved = true;
      } catch (error) { setSaveState(error instanceof Error && error.message.toLowerCase().includes("conflict") ? "Another editor changed this draft. Reload before continuing." : "Save failed. Your changes are still on this screen."); }
      return saved && !dirtyRef.current;
    })();
    savePromiseRef.current = request;
    try { return await request; } finally { savingRef.current=false; setSaving(false); savePromiseRef.current=null; }
  }
  async function leaveBuilder() {
    if (dirtyRef.current) {
      if (!window.confirm("You have unsaved campaign changes. Save them before leaving? Select Cancel to stay.")) return;
      if (!await save()) return;
    }
    close();
  }
  const update: UpdateCampaignDraft = (key,value) => { setDraft((current) => { const next={ ...current,[key]:value }; draftRef.current=next; return next; }); editVersionRef.current+=1; dirtyRef.current=true; setDirty(true); setSaveState("Unsaved changes"); if (saveRef.current) clearTimeout(saveRef.current); saveRef.current = setTimeout(() => void save(),1400); };
  const step = Math.min(7,Math.max(1,draft.stage || 1));
  return <div className="campaign-builder"><div className="builder-heading"><button className="button text" onClick={() => void leaveBuilder()}>← All campaigns</button><div><span className="status-pill">{workspace.campaign.status}</span><h2>{workspace.campaign.name}</h2><p role="status" className={saveState.includes("failed") || saveState.includes("changed") ? "form-error" : ""}>{saveState}</p></div><div className="inline-actions"><a href={`/c/${workspace.campaign.slug}`} target="_blank" rel="noopener noreferrer">Public page</a>{editable && <button className="button text" onClick={() => void save()} disabled={!dirty || saving}>Save now</button>}</div></div>
    <ol className="builder-steps">{STEPS.map((label,index) => <li key={label} className={index + 1 === step ? "current" : index + 1 < step ? "complete" : ""}><button onClick={() => update("stage",index + 1)} aria-current={index + 1 === step ? "step" : undefined}><span>{index + 1}</span>{label}</button></li>)}</ol>
    {draft.reviewFeedback && <div className="review-feedback" role="alert"><strong>Staff feedback</strong><p>{draft.reviewFeedback}</p></div>}
    <section className="builder-stage">{step === 1 && <><h3>Campaign basics</h3><label>Campaign name<input value={draft.name} onChange={(event) => update("name",event.target.value)} maxLength={200} disabled={!editable} /></label><label>Headline<input value={draft.headline} onChange={(event) => update("headline",event.target.value)} maxLength={160} disabled={!editable} /></label><label>Short summary<textarea value={draft.summary} onChange={(event) => update("summary",event.target.value)} maxLength={600} disabled={!editable} /></label></>}
      {step === 2 && <><h3>Beneficiary and proceeds terms</h3><div className="terms-card"><strong>{workspace.campaign.charityName}</strong><p>This beneficiary was verified by Donate by Mail. The dashboard reports the approved proceeds-policy version once allocations exist; the builder does not promise an unapproved percentage.</p></div></>}
      {step === 3 && <><h3>Goal and campaign dates</h3><div className="form-grid"><label>Phone-count goal (optional)<input type="number" min="1" max="1000000" value={draft.phoneGoal || ""} onChange={(event) => update("phoneGoal",event.target.value ? Number(event.target.value) : null)} disabled={!editable} /></label><label>Timezone<input value={draft.timezone} onChange={(event) => update("timezone",event.target.value)} disabled={!editable} /></label><label>Starts<input type="datetime-local" value={dateInput(draft.startsAt)} onChange={(event) => update("startsAt",event.target.value ? new Date(event.target.value).toISOString() : null)} disabled={!editable} /></label><label>Ends<input type="datetime-local" value={dateInput(draft.endsAt)} onChange={(event) => update("endsAt",event.target.value ? new Date(event.target.value).toISOString() : null)} disabled={!editable} /></label></div><p><small>Campaign attribution is accepted only while a published campaign is inside its active window.</small></p></>}
      {step === 4 && <CampaignContent draft={draft} update={update} editable={editable} workspace={workspace} reload={reload} />}
      {step === 5 && <CampaignPreview draft={draft} campaign={workspace.campaign} />}
      {step === 6 && <Toolkit draft={draft} update={update} editable={editable} toolkit={workspace.toolkit} campaignId={workspace.campaign.id} />}
      {step === 7 && <ReviewStage workspace={workspace} role={role} dirty={dirty} save={save} reload={reload} notify={notify} />}
    </section>
    <div className="builder-navigation"><button className="button text" disabled={step === 1} onClick={() => update("stage",step - 1)}>Previous</button><button className="button primary" disabled={step === 7} onClick={() => update("stage",step + 1)}>Next step</button></div>
  </div>;
}

function CampaignContent({ draft,update,editable,workspace,reload }: { draft: EditableCampaignDraft; update: UpdateCampaignDraft; editable: boolean; workspace: CampaignWorkspace; reload: () => Promise<void> }) {
  const [uploading,setUploading] = useState(false); const [assetMessage,setAssetMessage] = useState("");
  async function upload(file: File, assetKind: "hero_image" | "supporting_image", altText: string) { setUploading(true); try { const form = new FormData(); form.append("file",file); form.append("assetKind",assetKind); form.append("altText",altText); form.append("decorative","false"); const body = await authenticatedUpload(`/api/partner/campaigns/${workspace.campaign.id}/assets`,form); update(assetKind === "hero_image" ? "heroAssetId" : "supportingAssetId",body.asset.id); setAssetMessage("Image sanitized and attached. Save the draft to preserve the selection."); await reload(); } catch (error) { setAssetMessage(error instanceof Error ? error.message : "Image upload failed."); } finally { setUploading(false); } }
  function setBlock(index: number, block: CampaignBlock) { update("blocks",draft.blocks.map((item,i) => i === index ? block : item)); }
  return <><h3>Page content and images</h3><label>Campaign story<textarea value={draft.story} onChange={(event) => update("story",event.target.value)} rows={9} maxLength={12000} disabled={!editable} /></label><label>Button label<input value={draft.ctaLabel} onChange={(event) => update("ctaLabel",event.target.value)} maxLength={80} disabled={!editable} /></label>
    {editable && <div className="form-grid"><AssetUpload label="Hero image" kind="hero_image" uploading={uploading} upload={upload} /><AssetUpload label="Story image" kind="supporting_image" uploading={uploading} upload={upload} /></div>}{assetMessage && <p role="status">{assetMessage}</p>}
    <fieldset><legend>Structured story blocks</legend>{draft.blocks.map((block,index) => <div className="block-editor" key={index}><label>Block type<select value={block.type} disabled={!editable} onChange={(event) => setBlock(index,{ type: event.target.value as CampaignBlock["type"],content:{} })}><option value="text">Text</option><option value="callout">Callout</option><option value="statistic">Statistic</option><option value="quote">Quote</option></select></label>
      {(block.type === "text" || block.type === "callout") && <><label>Heading<input value={block.content.heading || ""} onChange={(event) => setBlock(index,{ ...block,content:{...block.content,heading:event.target.value} })} disabled={!editable} /></label><label>Body<textarea value={block.content.body || ""} onChange={(event) => setBlock(index,{ ...block,content:{...block.content,body:event.target.value} })} disabled={!editable} /></label></>}
      {block.type === "statistic" && <><label>Value<input value={block.content.value || ""} onChange={(event) => setBlock(index,{ ...block,content:{...block.content,value:event.target.value} })} disabled={!editable} /></label><label>Label<input value={block.content.label || ""} onChange={(event) => setBlock(index,{ ...block,content:{...block.content,label:event.target.value} })} disabled={!editable} /></label></>}
      {block.type === "quote" && <><label>Quote<textarea value={block.content.body || ""} onChange={(event) => setBlock(index,{ ...block,content:{...block.content,body:event.target.value} })} disabled={!editable} /></label><label>Attribution<input value={block.content.attribution || ""} onChange={(event) => setBlock(index,{ ...block,content:{...block.content,attribution:event.target.value} })} disabled={!editable} /></label></>}
      {editable && <button className="button text" onClick={() => update("blocks",draft.blocks.filter((_,i) => i !== index))}>Remove block</button>}</div>)}{editable && draft.blocks.length < 12 && <button className="button text" onClick={() => update("blocks",[...draft.blocks,{ type:"text",content:{ heading:"",body:"" } }])}>Add content block</button>}</fieldset>
    <h4>Media library</h4><div className="asset-grid">{workspace.assets.map((asset) => { const previewUrl = safePrivateAssetUrl(asset.previewUrl, ["/api/partner/campaign-assets/"]); return <article key={asset.id}>{previewUrl && <img src={previewUrl} alt={asset.altText} />}<span>{asset.assetKind.replace("_"," ")} · {asset.width}×{asset.height}</span>{!asset.used && editable && <button className="button text" onClick={async () => { setAssetMessage(""); try { await authenticatedApi(`/api/partner/campaigns/${workspace.campaign.id}/assets/${asset.id}`,{ method:"DELETE" }); await reload(); } catch (error) { setAssetMessage(error instanceof Error ? error.message : "The unused image could not be deleted."); } }}>Delete unused asset</button>}</article>; })}</div>
  </>;
}

function AssetUpload({ label,kind,uploading,upload }: { label: string; kind: "hero_image" | "supporting_image"; uploading: boolean; upload: (file: File,kind: "hero_image" | "supporting_image",alt: string) => Promise<void> }) {
  const [alt,setAlt] = useState(""); return <fieldset><legend>{label}</legend><label>Alt text<input value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={300} required /></label><label className="file-control"><Image aria-hidden="true" />Choose image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || !alt} onChange={(event) => { const file=event.target.files?.[0]; if (file) void upload(file,kind,alt); }} /></label><small>JPG, PNG, or WebP under 5 MB. Metadata is removed before storage.</small></fieldset>;
}

function CampaignPreview({ draft,campaign }: { draft: EditableCampaignDraft; campaign: CampaignWorkspace["campaign"] }) { return <div className="campaign-preview"><p className="kicker">Support {campaign.charityName}</p><h3>{draft.headline}</h3><p>{draft.summary}</p><div className="preview-story">{draft.story.split(/\n{2,}/).map((item,index) => <p key={index}>{item}</p>)}{draft.blocks.map((block,index) => <article key={index}><strong>{block.content.heading || block.content.value}</strong><p>{block.content.body || block.content.label}</p>{block.content.attribution && <cite>{block.content.attribution}</cite>}</article>)}</div><button className="button primary" disabled>{draft.ctaLabel}</button><small>This preview uses the working draft. Public pages always use the exact staff-approved revision.</small></div>; }

function Toolkit({ draft,update,editable,toolkit,campaignId }: { draft: EditableCampaignDraft; update: UpdateCampaignDraft; editable: boolean; toolkit: CampaignWorkspace["toolkit"]; campaignId: string }) {
  const fields = [["emailSubject","Email subject"],["emailBody","Email copy"],["socialShort","Short social post"],["socialLong","Long social post"],["flyerHeadline","Flyer headline"],["flyerBody","Flyer body"]] as const;
  const set = (key: string,value: string) => update("toolkit",{ ...draft.toolkit,[key]:value });
  return <><h3>Promotion toolkit</h3><div className="toolkit-links"><CopyValue label="Canonical link" value={toolkit.canonicalUrl} />{toolkit.vanityUrl && <CopyValue label="Vanity link" value={toolkit.vanityUrl} />}{Object.entries(toolkit.sourceLinks).map(([source,value]) => <CopyValue key={source} label={`${source} tracking link`} value={value} />)}</div>
    {fields.map(([key,label]) => <label key={key}>{label}{key.toLowerCase().includes("body") || key.toLowerCase().includes("social") ? <textarea value={draft.toolkit[key] || ""} onChange={(event) => set(key,event.target.value)} rows={4} disabled={!editable} /> : <input value={draft.toolkit[key] || ""} onChange={(event) => set(key,event.target.value)} disabled={!editable} />}</label>)}
    <div className="inline-actions"><a className="button text" href={`/partner/campaigns/${campaignId}/flyer`} target="_blank" rel="noopener noreferrer">Print campaign flyer</a><a className="button text" href={`/api/partner/campaigns/${campaignId}/qr.svg`} download>Download QR code</a></div><p><small>These tools copy or download approved materials. Donate by Mail does not send or post them externally from this screen.</small></p>
  </>;
}

function CopyValue({ label,value }: { label: string; value: string }) { const [copied,setCopied] = useState(false); const [message,setMessage] = useState(""); return <div className="copy-value"><span><strong>{label}</strong><code>{value}</code></span><button className="button text" onClick={async () => { setMessage(""); try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false),1200); } catch { setMessage("Copy failed. Select the link manually."); } }}><Clipboard aria-hidden="true" />{copied ? "Copied" : "Copy"}</button>{message && <small role="alert">{message}</small>}</div>; }

function ReviewStage({ workspace,role,dirty,save,reload,notify }: { workspace: CampaignWorkspace; role: Organization["role"]; dirty: boolean; save: () => Promise<boolean>; reload: () => Promise<void>; notify: (value: string) => void }) {
  const [busy,setBusy] = useState(false); const [restoring,setRestoring] = useState(false); const draft = workspace.draft;
  const [message,setMessage] = useState("");
  async function act(path: string) { setBusy(true); setMessage(""); try { if (dirty && !await save()) { setMessage("Save the current campaign changes before submitting this review."); return; } await authenticatedApi(path,{ method:"POST",body:"{}" }); await reload(); notify("Campaign review status updated."); } catch (error) { setMessage(error instanceof Error ? error.message : "The campaign review status could not be updated."); } finally { setBusy(false); } }
  async function restore(revisionId: string) { if (busy || restoring) return; setRestoring(true); setMessage(""); try { await authenticatedApi(`/api/partner/campaigns/${workspace.campaign.id}/revisions/${revisionId}/restore`,{ method:"POST",body:"{}" }); await reload(); notify("The selected revision is now the working draft."); } catch (error) { setMessage(error instanceof Error ? error.message : "The revision could not be restored."); } finally { setRestoring(false); } }
  return <><h3>Partner approval and staff review</h3><div className="review-checklist"><p><Check aria-hidden="true" /> Content is complete and accurate.</p><p><Check aria-hidden="true" /> Images have meaningful alt text.</p><p><Check aria-hidden="true" /> Dates and the verified beneficiary are correct.</p><p><Check aria-hidden="true" /> Promotion copy is ready.</p></div><p>Current review state: <strong>{draft.reviewState}</strong></p>
    {role === "partner_editor" && draft.reviewState === "editing" && <button className="button primary" disabled={busy} onClick={() => void act(`/api/partner/campaigns/${workspace.campaign.id}/ready`)}>Mark ready for partner admin</button>}
    {role === "partner_admin" && draft.reviewState === "editing" && <button className="button text" disabled={busy} onClick={() => void act(`/api/partner/campaigns/${workspace.campaign.id}/ready`)}>Mark partner review complete</button>}
    {role === "partner_admin" && draft.reviewState === "partner_review" && <button className="button primary" disabled={busy} onClick={() => void act(`/api/partner/campaigns/${workspace.campaign.id}/review`)}>Submit exact revision for staff review</button>}{message && <p role="alert">{message}</p>}
    <h4>Revision history</h4><div className="revision-list">{workspace.revisions.map((revision) => <article key={revision.id}><div><strong>Revision {revision.version}</strong><span className="status-pill">{revision.status}</span><small>{new Date(revision.createdAt).toLocaleString()}</small></div><code>{revision.contentHash.slice(0,12)}…</code>{role !== "partner_viewer" && <button className="button text" disabled={busy || restoring} onClick={() => void restore(revision.id)}>Restore as working draft</button>}</article>)}</div>
    <h4>Review history</h4>{workspace.reviews.map((review,index) => <p key={`${review.revisionId}-${index}`}><strong>{review.outcome}</strong> by {review.actorKind} · {new Date(review.createdAt).toLocaleString()}{review.feedback && <> — {review.feedback}</>}</p>)}
  </>;
}

function Profile({ organization,refresh,notify }: { organization: Organization; refresh: () => Promise<void>; notify: (value: string) => void }) {
  const [detail,setDetail] = useState<ProfileDetail | null>(null); const [message,setMessage] = useState("");
  const [logoAssetId,setLogoAssetId] = useState(""); const [heroAssetId,setHeroAssetId] = useState(""); const [uploading,setUploading] = useState(false); const [saving,setSaving] = useState(false); const [reviewing,setReviewing] = useState(false);
  const profileRequestRef = useRef(0);
  const organizationIdRef = useRef(organization.id);
  organizationIdRef.current = organization.id;
  async function reloadProfile() {
    const requestId = ++profileRequestRef.current;
    const requestedOrganizationId = organization.id;
    const body=await authenticatedApi(`/api/partner/organizations/${requestedOrganizationId}/profile`);
    if (requestId !== profileRequestRef.current || organizationIdRef.current !== requestedOrganizationId) return;
    setDetail(body.profile); setLogoAssetId(body.profile.draft?.logoAssetId || ""); setHeroAssetId(body.profile.draft?.heroAssetId || "");
  }
  async function uploadProfileAsset(file: File, kind: "logo" | "hero_image", alt: string) {
    const requestedOrganizationId = organization.id;
    setMessage(""); setUploading(true);
    try {
      const form=new FormData(); form.append("file",file); form.append("assetKind",kind); form.append("altText",alt); form.append("decorative","false");
      const body=await authenticatedUpload(`/api/partner/organizations/${requestedOrganizationId}/assets`,form);
      if (organizationIdRef.current !== requestedOrganizationId) return;
      if (kind === "logo") setLogoAssetId(body.asset.id); else setHeroAssetId(body.asset.id);
      await reloadProfile();
      if (organizationIdRef.current === requestedOrganizationId) notify(`${labelForAsset(kind)} uploaded and sanitized.`);
    } catch (error) { if (organizationIdRef.current === requestedOrganizationId) setMessage(error instanceof Error ? error.message : "The image could not be uploaded."); }
    finally { if (organizationIdRef.current === requestedOrganizationId) setUploading(false); }
  }
  useEffect(() => { setDetail(null); setLogoAssetId(""); setHeroAssetId(""); setUploading(false); setMessage(""); void reloadProfile().catch((error) => { if (organizationIdRef.current === organization.id) setMessage(error.message); }); },[organization.id]);
  if (!detail || detail.organization.id !== organization.id) return <div className="workspace-panel"><p role="status">{message || "Loading organization profile…"}</p></div>;
  const draft = detail.draft || { mission:"",summary:"",websiteUrl:"",locality:"",region:"",countryCode:"US",lockVersion:0,reviewState:"editing" };
  const editable = organization.role !== "partner_viewer";
  return <div className="workspace-panel"><div className="panel-heading"><div><p className="kicker">Public organization profile</p><h2>{detail.organization.name}</h2></div>{detail.organization.activeRevisionId && <a href={`/nonprofits/${detail.organization.slug}`}>View public profile</a>}</div>
    {draft.reviewFeedback && <div className="review-feedback"><strong>Staff feedback</strong><p>{draft.reviewFeedback}</p></div>}
    <form key={`${organization.id}-${draft.lockVersion}`} className="campaign-editor" onSubmit={async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (saving) return; setSaving(true); const values=Object.fromEntries(new FormData(event.currentTarget)); try { await authenticatedApi(`/api/partner/organizations/${organization.id}/profile`,{ method:"PATCH",body:JSON.stringify({ ...values,lockVersion:draft.lockVersion,logoAssetId:logoAssetId || null,heroAssetId:heroAssetId || null }) }); notify("Organization profile draft saved."); await refresh(); await reloadProfile(); } catch (error) { setMessage(error instanceof Error ? error.message : "Profile could not be saved."); } finally { setSaving(false); } }}>
      <label>Mission statement<input name="mission" defaultValue={draft.mission} maxLength={300} required disabled={!editable} /></label><label>Organization summary<textarea name="summary" defaultValue={draft.summary} rows={7} maxLength={4000} required disabled={!editable} /></label><label>Website<input name="website" type="url" pattern="https://.*" defaultValue={draft.websiteUrl} required disabled={!editable} /></label><div className="form-grid"><label>City<input name="locality" defaultValue={draft.locality} disabled={!editable} /></label><label>State or region<input name="region" defaultValue={draft.region} disabled={!editable} /></label><label>Country code<input name="countryCode" defaultValue={draft.countryCode} pattern="[A-Za-z]{2}" disabled={!editable} /></label></div>{message && <p role="alert">{message}</p>}{editable && <button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save profile draft"}</button>}
      {editable && <div className="form-grid"><ProfileAssetUpload label="Logo" kind="logo" disabled={uploading} upload={uploadProfileAsset} /><ProfileAssetUpload label="Hero image" kind="hero_image" disabled={uploading} upload={uploadProfileAsset} /></div>}
      {detail.assets.length > 0 && <div className="asset-grid">{detail.assets.map((asset) => { const previewUrl = safePrivateAssetUrl(asset.previewUrl, ["/api/partner/organization-assets/"]); return <article key={asset.id}>{previewUrl && <img src={previewUrl} alt={asset.altText} />}<span>{asset.assetKind}</span>{editable && <button type="button" className="button text" onClick={() => asset.assetKind === "logo" ? setLogoAssetId(asset.id) : setHeroAssetId(asset.id)}>Use in draft</button>}</article>; })}</div>}
    </form>
    {organization.role === "partner_admin" && draft.reviewState !== "staff_review" && <button className="button text" disabled={saving || reviewing} onClick={async () => { if (saving || reviewing) return; setReviewing(true); setMessage(""); try { await authenticatedApi(`/api/partner/organizations/${organization.id}/profile/review`,{ method:"POST",body:"{}" }); notify("Profile submitted for staff review."); await reloadProfile(); } catch (error) { setMessage(error instanceof Error ? error.message : "The profile could not be submitted for review."); } finally { setReviewing(false); } }}>{reviewing ? "Submitting…" : "Submit profile for staff review"}</button>}
    <h3>Revision history</h3>{detail.revisions.map((revision) => <p key={revision.id}>Revision {revision.version} · {revision.status} · <code>{revision.contentHash.slice(0,12)}…</code></p>)}
  </div>;
}

const labelForAsset = (kind: "logo" | "hero_image") => kind === "logo" ? "Logo" : "Hero image";
function ProfileAssetUpload({ label,kind,disabled,upload }: { label:string; kind:"logo"|"hero_image"; disabled:boolean; upload:(file:File,kind:"logo"|"hero_image",alt:string)=>Promise<void> }) { const [alt,setAlt]=useState(""); return <fieldset><legend>{label}</legend><label>Alt text<input value={alt} onChange={(event)=>setAlt(event.target.value)} maxLength={300} /></label><input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || !alt} onChange={(event)=>{const file=event.target.files?.[0];if(file)void upload(file,kind,alt);}} /><small>JPG, PNG, or WebP under 5 MB.</small></fieldset>; }

function Reports({ organization }: { organization: Organization }) { return <div className="workspace-panel"><div className="panel-heading"><div><p className="kicker">Aggregate reporting</p><h2>Campaign results without donor PII</h2></div></div>{organization.campaigns.map((campaign) => { const conversion = campaign.metrics.views ? ((campaign.metrics.submittedDonations / campaign.metrics.views) * 100).toFixed(1) : "0.0"; return <section className="report-card" key={campaign.id}><div className="panel-heading"><div><h3>{campaign.name}</h3><p>{campaign.charityName}</p></div><a href={`/api/partner/campaigns/${campaign.id}/report.csv`} download>Export aggregate CSV</a></div><div className="metric-grid"><Metric label="Views" value={campaign.metrics.views} /><Metric label="Starts" value={campaign.metrics.donationStarts} /><Metric label="Submitted" value={campaign.metrics.submittedDonations} /><Metric label="Conversion" value={`${conversion}%`} /><Metric label="Phones pledged" value={campaign.metrics.phonesPledged} /><Metric label="Phones received" value={campaign.metrics.phonesReceived} /><Metric label="Phones processed" value={campaign.metrics.phonesProcessed} /><Metric label="Completed" value={campaign.metrics.completedDonations} /></div><div className="financial-grid"><p><span>Gross proceeds</span><strong>{money(campaign.financial.grossProceedsCents)}</strong></p><p><span>Eligible costs</span><strong>{money(campaign.financial.eligibleCostCents)}</strong></p><p><span>Allocable base</span><strong>{money(campaign.financial.allocableBaseCents)}</strong></p><p><span>Allocation</span><strong>{money(campaign.financial.allocationCents)}</strong></p></div><p className="financial-status"><span className="status-pill">{campaign.financial.provisional ? "Provisional" : "Finalized"}</span> Disbursement: {campaign.financial.disbursementStatus}. Figures are aggregate and do not include donor-level details or payment credentials.</p></section>; })}</div>; }

function Team({ organization,refresh,notify }: { organization: Organization; refresh: () => Promise<void>; notify: (value: string) => void }) { const admin=organization.role === "partner_admin"; const [busy,setBusy]=useState(false); const change = async (path: string, options: RequestInit, success: string) => { if (busy) return; setBusy(true); try { await authenticatedApi(path, options); await refresh(); notify(success); } catch (error) { notify(error instanceof Error ? error.message : "The team change could not be saved."); } finally { setBusy(false); } }; return <div className="workspace-panel"><div className="panel-heading"><div><p className="kicker">Team access</p><h2>Editors and viewers</h2></div></div><p>Only Donate by Mail administrators can grant, transfer, or remove partner administrator access.</p>{admin && <form className="team-invite" onSubmit={async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; setBusy(true); const values=Object.fromEntries(new FormData(event.currentTarget)); try { await authenticatedApi(`/api/partner/organizations/${organization.id}/invitations`,{ method:"POST",body:JSON.stringify(values) }); event.currentTarget.reset(); await refresh(); notify("Invitation created. The outbox will deliver the one-time sign-in instructions."); } catch (error) { notify(error instanceof Error ? error.message : "The invitation could not be created."); } finally { setBusy(false); } }}><label>Email<input name="email" type="email" autoComplete="off" required disabled={busy} /></label><label>Role<select name="role" disabled={busy}><option value="partner_editor">Editor</option><option value="partner_viewer">Viewer</option></select></label><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Invite team member"}</button></form>}<h3>Active team</h3>{organization.team.map((member) => <div className="team-row" key={member.userId}><span><strong>{member.email}</strong><small>{member.role.replace("partner_","")} · {member.status}</small></span>{admin && member.role !== "partner_admin" && <button className="button text" disabled={busy} onClick={() => void change(`/api/partner/organizations/${organization.id}/members/${member.userId}`,{ method:"PATCH",body:JSON.stringify({ status:member.status === "active" ? "suspended" : "active" })}, "Team member status updated.")}>{busy ? "Working…" : member.status === "active" ? "Suspend" : "Reactivate"}</button>}</div>)}<h3>Pending invitations</h3>{organization.invitations.map((invite) => <div className="team-row" key={invite.id}><span><strong>{invite.email}</strong><small>{invite.role.replace("partner_","")} · expires {new Date(invite.expiresAt).toLocaleDateString()}</small></span>{admin && <button className="button text" disabled={busy} onClick={() => void change(`/api/partner/organizations/${organization.id}/invitations/${invite.id}`,{ method:"DELETE" }, "Invitation revoked.")}>{busy ? "Working…" : "Revoke"}</button>}</div>)}</div>; }

function Activity({ organization }: { organization: Organization }) { return <div className="workspace-panel"><p className="kicker">De-identified activity</p><h2>Recent workspace changes</h2><div className="activity-list">{organization.recentActivity.map((item,index) => <article key={`${item.type}-${index}`}><FileText aria-hidden="true" /><div><strong>{item.type.split(".").join(" ")}</strong><span>{item.entityType} · {new Date(item.occurredAt).toLocaleString()}</span></div></article>)}</div><p><small>This feed intentionally excludes donor names, email and mailing addresses, device serials, and internal staff notes.</small></p></div>; }
