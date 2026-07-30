import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, HeartHandshake, LockKeyhole, PackageCheck, Smartphone } from "lucide-react";

type Campaign = {
  slug: string;
  name: string;
  charityPledgeId: string;
  charityName: string;
  charity?: CharityDetails;
  headline: string;
  summary: string;
  story: string;
  ctaLabel: string;
  heroAssetId?: string | null;
  heroImageUrl?: string | null;
  supportingAssetId?: string | null;
  supportingImageUrl?: string | null;
  heroAltText?: string | null;
  heroDecorative?: boolean;
  supportingAltText?: string | null;
  supportingDecorative?: boolean;
  blocks?: Array<{ type: "text" | "callout" | "statistic" | "quote"; content: Record<string, string> }>;
  revision?: number;
};

type CharityDetails = {
  pledgeId: string;
  name: string;
  ein?: string;
  city?: string;
  state?: string;
  country?: string;
  logoUrl?: string;
  websiteUrl?: string;
};

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/campaign-assets/")) return url.pathname;
    if (url.protocol === "https:" && (url.hostname === "res.cloudinary.com" || url.hostname === "pledgeling-res.cloudinary.com")) return url.toString();
  } catch { /* An untrusted asset URL is ignored. */ }
  return null;
}

function safeWebsiteUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
}

function CharityLogo({ charity, large = false }: { charity: CharityDetails; large?: boolean }) {
  const image = safeImageUrl(charity.logoUrl);
  return image ? (
    <img className={`campaign-charity-logo${large ? " campaign-charity-logo-large" : ""}`} src={image} alt={`${charity.name} logo`} />
  ) : (
    <span className={`campaign-charity-logo campaign-charity-initials${large ? " campaign-charity-logo-large" : ""}`} aria-label={`${charity.name} initials`}>{initials(charity.name)}</span>
  );
}

export function CampaignPage({ slug }: { slug: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [charity, setCharity] = useState<CharityDetails | null>(null);
  const [message, setMessage] = useState("Loading campaign…");

  useEffect(() => {
    let active = true;
    setMessage("Loading campaign…");
    fetch(`/api/campaigns/${encodeURIComponent(slug)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { campaign?: Campaign; message?: string };
        if (!response.ok || !body.campaign) throw new Error(body.message || "Campaign unavailable.");
        if (!active) return;
        setCampaign(body.campaign);
        setCharity(body.campaign.charity || { pledgeId: body.campaign.charityPledgeId, name: body.campaign.charityName });
        setMessage("");
      })
      .catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [slug]);

  const paragraphs = useMemo(() => campaign?.story.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean) || [], [campaign?.story]);
  const heroImage = safeImageUrl(campaign?.heroImageUrl);
  const supportingImage = safeImageUrl(campaign?.supportingImageUrl);
  const website = safeWebsiteUrl(charity?.websiteUrl);
  const location = [charity?.city, charity?.state, charity?.country].filter(Boolean).join(", ");
  const betaOnly = campaign?.slug.startsWith("beta-");

  if (!campaign) return <main className="campaign-public campaign-loading"><p role="status">{message}</p></main>;

  return <main className="campaign-public">
    <section className="campaign-hero">
      <div className="campaign-wrap campaign-hero-grid">
        <div className="campaign-hero-copy">
          <p className="campaign-eyebrow">{betaOnly ? "Beta phone drive" : "A Donate by Mail phone drive"}</p>
          <h1>{campaign.headline}</h1>
          <p className="campaign-summary">{campaign.summary}</p>
          <div className="campaign-actions">
            <a className="button primary" href={`/donate-phone?campaign=${encodeURIComponent(campaign.slug)}`}>{campaign.ctaLabel || "Donate a Phone"}<ArrowRight aria-hidden="true" /></a>
            <a className="campaign-text-link" href="#how-it-works">See how it works <ArrowRight aria-hidden="true" /></a>
          </div>
          <p className="campaign-reassurance"><LockKeyhole aria-hidden="true" /> We never ask for your phone passcode.</p>
        </div>
        <div className="campaign-hero-visual">
          {heroImage ? (campaign.heroDecorative ? <img className="campaign-hero-image" src={heroImage} alt="" aria-hidden="true" /> : <img className="campaign-hero-image" src={heroImage} alt={campaign.heroAltText || `${campaign.name} campaign`} />) : <div className="campaign-phone-mark" aria-hidden="true"><Smartphone /></div>}
          <div className="campaign-support-card">
            <CharityLogo charity={charity || { pledgeId: campaign.charityPledgeId, name: campaign.charityName }} />
            <div><span>Supporting</span><strong>{charity?.name || campaign.charityName}</strong>{location && <small>{location}</small>}</div>
          </div>
        </div>
      </div>
    </section>

    <section className="campaign-trust" aria-label="Campaign trust signals">
      <div className="campaign-wrap campaign-trust-grid">
        <span><CheckCircle2 aria-hidden="true" /> Support the selected nonprofit</span>
        <span><PackageCheck aria-hidden="true" /> Mail with your own packaging and postage</span>
        <span><LockKeyhole aria-hidden="true" /> Documentation follows receipt and verification</span>
      </div>
    </section>

    <section className="campaign-section campaign-story-section">
      <div className="campaign-wrap campaign-story-grid">
        <div>
          <p className="campaign-eyebrow">About this campaign</p>
          <h2>A small device can carry a meaningful next chapter.</h2>
        </div>
        <div className="campaign-story-copy">{paragraphs.map((paragraph, index) => <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>)}{campaign.blocks?.map((block, index) => <article className={`campaign-block campaign-block-${block.type}`} key={`${block.type}-${index}`}><p className="campaign-eyebrow">{block.type === "statistic" ? "Impact" : block.type === "quote" ? "A partner's perspective" : "Campaign note"}</p>{block.content.heading && <h3>{block.content.heading}</h3>}{block.content.body && <p>{block.content.body}</p>}{block.content.value && <strong>{block.content.value}</strong>}</article>)}{supportingImage && <figure className="campaign-supporting-figure">{campaign.supportingDecorative ? <img src={supportingImage} alt="" aria-hidden="true" /> : <img src={supportingImage} alt={campaign.supportingAltText || `${campaign.name} story`} />}<figcaption>{campaign.name}</figcaption></figure>}</div>
      </div>
    </section>

    <section className="campaign-section campaign-choice-section">
      <div className="campaign-wrap campaign-choice-grid">
        <div><p className="campaign-eyebrow">Support this campaign</p><h2>Support {charity?.name || campaign.charityName} with your old phone.</h2><p className="campaign-choice-copy">The campaign nonprofit is already selected. When you start your donation, that beneficiary stays attached to the donation record and appears again in your confirmation.</p><a className="button primary" href={`/donate-phone?campaign=${encodeURIComponent(campaign.slug)}`}>Continue to mailing details <ArrowRight aria-hidden="true" /></a></div>
        <aside className="campaign-choice-card"><CharityLogo charity={charity || { pledgeId: campaign.charityPledgeId, name: campaign.charityName }} large /><p className="campaign-eyebrow">Verified nonprofit</p><h3>{charity?.name || campaign.charityName}</h3><p>Nonprofit details and logo are refreshed from the verified Pledge record before this public page is shown.</p>{website && <a href={website} target="_blank" rel="noreferrer">Learn more about this nonprofit <ExternalLink aria-hidden="true" /></a>}</aside>
      </div>
    </section>

    <section className="campaign-section campaign-process-section" id="how-it-works">
      <div className="campaign-wrap">
        <div className="campaign-section-heading"><p className="campaign-eyebrow">The simple path</p><h2>Three steps from drawer to donation.</h2><p>Donate by Mail keeps the process clear so you can focus on the cause you chose.</p></div>
        <div className="campaign-steps">
          <article><span>01</span><Smartphone aria-hidden="true" /><h3>Tell us about your phone</h3><p>Share a few basic details about the device you want to donate.</p></article>
          <article><span>02</span><HeartHandshake aria-hidden="true" /><h3>Support this campaign</h3><p>The selected beneficiary stays attached while you complete your donation.</p></article>
          <article><span>03</span><PackageCheck aria-hidden="true" /><h3>Mail it to Donate by Mail</h3><p>Prepare the phone, pay the carrier directly, and send it to our headquarters.</p></article>
        </div>
      </div>
    </section>

    <section className="campaign-section campaign-after-section">
      <div className="campaign-wrap campaign-after-grid">
        <div><p className="campaign-eyebrow">What happens next</p><h2>We verify the donation and handle the device responsibly.</h2></div>
        <div><p>After your phone arrives, Donate by Mail confirms what was received and determines the appropriate path, such as reuse, resale, parts recovery, or recycling. Any remaining value is handled according to the applicable proceeds policy for the selected nonprofit.</p><p className="campaign-note">Donation documentation is issued only after the device is received and verified. Donate by Mail does not assign a fair market value to donated property.</p></div>
      </div>
    </section>

    <section className="campaign-section campaign-charity-section">
      <div className="campaign-wrap campaign-charity-panel">
        <div className="campaign-charity-heading"><CharityLogo charity={charity || { pledgeId: campaign.charityPledgeId, name: campaign.charityName }} large /><div><p className="campaign-eyebrow">Your selected nonprofit</p><h2>{charity?.name || campaign.charityName}</h2>{location && <p>{location}</p>}</div></div>
        <div className="campaign-charity-details"><p>Donate through this campaign and your selection stays attached to the donation record.</p>{charity?.ein && <p><strong>EIN:</strong> {charity.ein}</p>}{website && <a href={website} target="_blank" rel="noreferrer">Visit the nonprofit website <ExternalLink aria-hidden="true" /></a>}<small>Nonprofit search and selection are provided through Pledge.</small></div>
      </div>
    </section>

    <section className="campaign-section campaign-faq-section">
      <div className="campaign-wrap campaign-faq-grid"><div><p className="campaign-eyebrow">Before you begin</p><h2>Good questions to have answered.</h2></div><div className="campaign-faqs">
        <details><summary>Do I pay for shipping?</summary><p>Yes. You use your own packaging and pay the carrier directly. The campaign page and printable documents show the Donate by Mail destination.</p></details>
        <details><summary>What should I do with my data?</summary><p>Back up what you need, sign out of accounts, remove activation locks, remove SIM or memory cards when possible, and factory reset the phone. Never include a passcode.</p></details>
        <details><summary>When is documentation issued?</summary><p>After Donate by Mail receives and verifies the device. The planning estimate is not a tax appraisal or a guaranteed sale amount.</p></details>
      </div></div>
    </section>

    <section className="campaign-final-cta"><div className="campaign-wrap"><p className="campaign-eyebrow">Ready when you are</p><h2>Give an old phone a purpose beyond the drawer.</h2><p>Choose your phone, support {charity?.name || campaign.charityName}, and we’ll guide you through the rest.</p><a className="button primary" href={`/donate-phone?campaign=${encodeURIComponent(campaign.slug)}`}>{campaign.ctaLabel || "Donate a Phone"}<ArrowRight aria-hidden="true" /></a></div></section>
  </main>;
}
