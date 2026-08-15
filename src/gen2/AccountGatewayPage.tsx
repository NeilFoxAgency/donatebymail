import { FormEvent, useEffect, useState } from "react";
import { authenticatedApi, logout, publicApi } from "./AuthSession";
import { TURNSTILE_SITE_KEY, TurnstileWidget } from "./TurnstileWidget";
import { MfaSettings } from "./MfaPage";

type AccountContext = {
  email?: string;
  staff?: boolean;
  donor?: boolean;
  hasClaimedDonations?: boolean;
  organizations?: Array<{ id: string; name: string; role: string }>;
};

async function requestMagicLink(path: string, email: string, turnstileToken: string): Promise<string> {
  if (TURNSTILE_SITE_KEY && !turnstileToken) throw new Error("Security verification is required.");
  const body = await publicApi<{ message?: string }>(path, {
    method: "POST",
    body: JSON.stringify({ email, turnstileToken }),
  });
  return body.message || "If the address can sign in, a secure link is on its way.";
}

export function AccountGatewayPage() {
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<AccountContext | null>(null);
  useEffect(() => {
    publicApi<{ authenticated?: boolean; context?: AccountContext }>("/api/auth/session")
      .then((body) => { setContext(body.authenticated ? body.context || {} : null); })
      .catch(() => setContext(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (loading || !context) return;
    const organizations = context.organizations || [];
    const hasDonor = Boolean(context.hasClaimedDonations ?? context.donor);
    const hasMultipleContexts = (Boolean(context.staff) && (hasDonor || organizations.length > 0)) || organizations.length > 1 || (hasDonor && organizations.length > 0);
    if (hasMultipleContexts) return;
    if (context.staff) window.location.replace("/staff");
    else if (organizations.length === 1) window.location.replace("/partner");
    else window.location.replace("/account");
  }, [loading, context]);
  if (loading) return <main className="operations-main"><section className="operations-shell compact"><p role="status">Loading your account options…</p></section></main>;
  if (context) return <AccountSwitcher context={context} />;
  return <SignedOutGateway />;
}

function SignedOutGateway() {
  const [donorEmail, setDonorEmail] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [donorTurnstileToken, setDonorTurnstileToken] = useState("");
  const [partnerTurnstileToken, setPartnerTurnstileToken] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState<"donor" | "partner" | null>(null);
  const send = async (path: string, email: string, turnstileToken: string) => {
    if (sending) return;
    const kind = path.includes("partner") ? "partner" : "donor";
    setSending(kind);
    setMessage("");
    try { setMessage(await requestMagicLink(path, email, turnstileToken)); }
    catch { setMessage("We could not request a secure link. Please try again."); }
    finally { setSending(null); }
  };
  return <main className="operations-main"><section className="operations-shell account-gateway">
    <p className="kicker">Your Donate by Mail account</p><h1>Manage your donation or phone drive.</h1>
    <p>Sign in with a one-time secure email link. Donor accounts are open to everyone; partner access is invitation-only.</p>
    <div className="account-grid">
      <article className="account-card"><p className="kicker">Personal / donor account</p><h2>Track your phone donations</h2><p>See your claimed donations, mailing updates, processing progress, and the charity you chose.</p>
        <form className="inline-ops" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send("/api/account/auth/magic-link", donorEmail, donorTurnstileToken); }}><label>Email<input type="email" autoComplete="email" value={donorEmail} onChange={(event) => setDonorEmail(event.target.value)} required disabled={sending !== null} /></label><TurnstileWidget action="auth_magic_link" onToken={setDonorTurnstileToken} /><div className="inline-actions"><button className="button primary" disabled={sending !== null}>{sending === "donor" ? "Sending…" : "Log in"}</button><button className="button text" type="submit" disabled={sending !== null}>{sending === "donor" ? "Sending…" : "Create an account"}</button></div></form>
      </article>
      <article className="account-card"><p className="kicker">Nonprofit partner account</p><h2>Manage a phone donation drive</h2><p>View your organization's campaigns, public pages, results, and campaign materials.</p>
        <form className="inline-ops" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send("/api/partner/auth/magic-link", partnerEmail, partnerTurnstileToken); }}><label>Invited partner email<input type="email" autoComplete="email" value={partnerEmail} onChange={(event) => setPartnerEmail(event.target.value)} required disabled={sending !== null} /></label><TurnstileWidget action="auth_magic_link" onToken={setPartnerTurnstileToken} /><button className="button primary" disabled={sending !== null}>{sending === "partner" ? "Sending…" : "Partner log in"}</button></form><div className="account-support-link"><a href="/for-nonprofits.html">Start a phone drive</a><small>New partner access requires staff approval.</small></div>
      </article>
    </div>
    {message && <p role="status" className="account-message">{message}</p>}
  </section></main>;
}

function AccountSwitcher({ context }: { context: AccountContext }) {
  const organizations = context.organizations || [];
  const [message,setMessage] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  return <main className="operations-main"><section className="operations-shell account-gateway"><div className="staff-heading"><div><p className="kicker">Signed in</p><h1>Choose where you want to go</h1><p>{context.email}</p></div><button className="button text" disabled={logoutBusy} onClick={async () => { if (logoutBusy) return; setLogoutBusy(true); try { await logout(); window.location.replace("/login"); } catch (error) { setMessage(error instanceof Error ? error.message : "Sign out failed. Please try again."); setLogoutBusy(false); } }}>{logoutBusy ? "Signing out…" : "Log out"}</button></div>
    <div className="account-grid">{(context.hasClaimedDonations ?? context.donor) && <a className="account-card account-card-link" href="/account"><p className="kicker">Personal</p><h2>My donations</h2><p>Track claimed phone donations and mailing updates.</p></a>}
      {organizations.map((organization) => <a className="account-card account-card-link" href="/partner" key={organization.id}><p className="kicker">Partner</p><h2>{organization.name}</h2><p>Partner dashboard · {organization.role.replace("partner_", "")}</p></a>)}
      {context.staff && <a className="account-card account-card-link" href="/staff"><p className="kicker">Staff</p><h2>Operations</h2><p>Donation, campaign, and partner administration.</p></a>}
    </div>
    <a href="/settings">Account settings</a>{message && <p role="alert">{message}</p>}
  </section></main>;
}

export function AccountSettingsPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  useEffect(() => { authenticatedApi("/api/account/profile").then((body) => { setEmail(body.profile.email); setDisplayName(body.profile.displayName || ""); }).catch(() => setMessage("Sign in to view your account settings.")); }, []);
  return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Account settings</p><h1>Your account</h1><p>Update your preferred display name. Donation address snapshots remain attached to the original donation and are not changed here.</p><form className="inline-ops" onSubmit={async (event) => { event.preventDefault(); if (saving) return; setSaving(true); setMessage(""); try { const body = await authenticatedApi("/api/account/profile", { method: "POST", body: JSON.stringify({ displayName }) }); setMessage(body.message || "Profile saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "The profile could not be saved."); } finally { setSaving(false); } }}><label>Verified email<input value={email} readOnly /></label><label>Preferred name<input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} disabled={saving} /></label><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></form><MfaSettings /><button className="button text" disabled={logoutBusy} onClick={async () => { if (logoutBusy) return; setLogoutBusy(true); try { await logout(); window.location.replace("/login"); } catch (error) { setMessage(error instanceof Error ? error.message : "Sign out failed. Please try again."); setLogoutBusy(false); } }}>{logoutBusy ? "Signing out…" : "Log out"}</button>{message && <p role="status">{message}</p>}</section></main>;
}
