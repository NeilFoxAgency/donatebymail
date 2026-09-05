import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, MapPin, ShieldCheck } from "lucide-react";
import { publicApi } from "./AuthSession";
import { safeExternalHttpsUrl, safePrivateAssetUrl } from "./urlSafety";

type PublicNonprofit = {
  slug: string; name: string; mission: string; summary: string; websiteUrl: string;
  locality?: string | null; region?: string | null; countryCode?: string | null;
  logoImageUrl?: string | null; heroImageUrl?: string | null; logoAltText?: string | null; heroAltText?: string | null;
  primaryCharity?: { name: string; pledgeId: string; ein?: string | null } | null;
  campaigns?: Array<{ slug: string; name: string; status: string; startsAt?: string | null; endsAt?: string | null; phoneGoal?: number | null }>;
};

function safeAsset(value?: string | null): string | null {
  return safePrivateAssetUrl(value, ["/api/nonprofit-assets/"]);
}

export function NonprofitPage({ slug }: { slug: string }) {
  const [profile, setProfile] = useState<PublicNonprofit | null>(null);
  const [message, setMessage] = useState("Loading nonprofit profile…");
  useEffect(() => {
    let active = true;
    // Clear the previous tenant profile before loading a different slug.
    setProfile(null);
    setMessage("Loading nonprofit profile…");
    publicApi<{ nonprofit?: PublicNonprofit }>(`/api/nonprofits/${encodeURIComponent(slug)}`)
      .then((body) => { if (!body.nonprofit) throw new Error("Nonprofit profile not found."); if (active) { setProfile(body.nonprofit); setMessage(""); } })
      .catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [slug]);
  if (!profile) return <main className="nonprofit-public loading-panel"><p role="status">{message}</p></main>;
  const logo = safeAsset(profile.logoImageUrl), hero = safeAsset(profile.heroImageUrl);
  const website = safeExternalHttpsUrl(profile.websiteUrl);
  const location = [profile.locality, profile.region, profile.countryCode].filter(Boolean).join(", ");
  const active = (profile.campaigns || []).filter(({ status }) => status === "published" || status === "scheduled");
  const past = (profile.campaigns || []).filter(({ status }) => status === "ended");
  return <main className="nonprofit-public">
    <section className="nonprofit-hero"><div className="campaign-wrap nonprofit-hero-grid"><div>
      <p className="campaign-eyebrow">Verified nonprofit partner</p><div className="nonprofit-identity">{logo && <img src={logo} alt={profile.logoAltText || `${profile.name} logo`} />}<h1>{profile.name}</h1></div>
      <p className="nonprofit-mission">{profile.mission}</p>{location && <p className="nonprofit-location"><MapPin aria-hidden="true" />{location}</p>}
      <div className="campaign-actions"><a className="button primary" href="/donate-phone">Donate a Phone <ArrowRight aria-hidden="true" /></a>
        {website && <a className="campaign-text-link" href={website} target="_blank" rel="noopener noreferrer">Visit nonprofit website <ExternalLink aria-hidden="true" /></a>}</div>
    </div>{hero && <img className="nonprofit-hero-image" src={hero} alt={profile.heroAltText || `${profile.name} community`} />}</div></section>
    <section className="campaign-trust"><div className="campaign-wrap campaign-trust-grid"><span><ShieldCheck aria-hidden="true" /> Organization verified by Donate by Mail</span><span>Nonprofit record verified through Pledge</span><span>Campaign pages publish only after staff review</span></div></section>
    <section className="campaign-section"><div className="campaign-wrap nonprofit-story"><div><p className="campaign-eyebrow">About the organization</p><h2>{profile.mission}</h2></div><p>{profile.summary}</p></div></section>
    <section className="campaign-section nonprofit-campaigns"><div className="campaign-wrap"><p className="campaign-eyebrow">Phone donation campaigns</p><h2>Support an active campaign.</h2>
      {active.length ? <div className="account-grid">{active.map((campaign) => <article className="account-card" key={campaign.slug}><span className="status-pill">{campaign.status}</span><h3>{campaign.name}</h3>{campaign.phoneGoal && <p>Goal: {campaign.phoneGoal} phones received</p>}<a href={`/c/${campaign.slug}`}>View campaign <ArrowRight aria-hidden="true" /></a></article>)}</div> : <p>No active phone campaigns are open right now. You can still choose this nonprofit in the standard donation flow.</p>}
      {past.length > 0 && <details className="past-campaigns"><summary>Past campaigns</summary><ul>{past.map((campaign) => <li key={campaign.slug}><a href={`/c/${campaign.slug}`}>{campaign.name}</a></li>)}</ul></details>}
    </div></section>
  </main>;
}
