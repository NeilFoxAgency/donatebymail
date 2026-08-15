import { useEffect, useState } from "react";
import { Printer, Smartphone } from "lucide-react";
import { authenticatedApi } from "./AuthSession";

type FlyerWorkspace = { campaign: { id: string; name: string; charityName: string }; draft: { headline: string; summary: string; toolkit: Record<string,string> }; toolkit: { canonicalUrl: string; sourceLinks: { qr: string } } };

export function CampaignFlyerPage({ campaignId }: { campaignId: string }) {
  const [workspace,setWorkspace] = useState<FlyerWorkspace | null>(null); const [message,setMessage] = useState("Loading print flyer…");
  useEffect(() => {
    let active = true;
    setWorkspace(null);
    setMessage("Loading campaign flyer…");
    authenticatedApi(`/api/partner/campaigns/${campaignId}`)
      .then((body) => { if (active) { setWorkspace(body.workspace); setMessage(""); } })
      .catch((error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  },[campaignId]);
  if (!workspace) return <main className="flyer-page"><p role="status">{message}</p></main>;
  return <main className="flyer-page"><div className="flyer-controls"><button className="button primary" onClick={() => window.print()}><Printer aria-hidden="true" />Print or save PDF</button><a href="/partner">Return to workspace</a></div><article className="campaign-flyer"><div className="flyer-brand"><Smartphone aria-hidden="true" /><strong>Donate by Mail</strong></div><p className="kicker">Phone donation campaign</p><h1>{workspace.draft.toolkit.flyerHeadline || workspace.draft.headline}</h1><p className="flyer-summary">{workspace.draft.toolkit.flyerBody || workspace.draft.summary}</p><div className="flyer-beneficiary"><span>Your old phone can support</span><strong>{workspace.campaign.charityName}</strong></div><ol><li>Tell us about your phone.</li><li>Prepare your device and remove your personal data.</li><li>Mail it to Donate by Mail using your own packaging and postage.</li></ol><div className="flyer-qr"><img src={`/api/partner/campaigns/${campaignId}/qr.svg`} alt={`QR code for ${workspace.campaign.name}`} /><div><strong>Start here</strong><span>{workspace.toolkit.sourceLinks.qr}</span></div></div><small>Donate by Mail is a U.S. 501(c)(3) public charity. Donation documentation follows physical receipt and verification. We never ask for your phone passcode.</small></article></main>;
}
