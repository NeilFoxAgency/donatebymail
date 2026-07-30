import { FormEvent, useEffect, useState } from "react";
import { logout } from "./AuthSession";

type AccountContext = {
  email?: string;
  staff?: boolean;
  donor?: boolean;
  organizations?: Array<{ id: string; name: string; role: string }>;
};

async function requestMagicLink(path: string, email: string): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await response.json() as { message?: string };
  return body.message || "If the address can sign in, a secure link is on its way.";
}

export function AccountGatewayPage() {
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<AccountContext | null>(null);
  useEffect(() => {
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json() as Promise<{ authenticated?: boolean; context?: AccountContext }>)
      .then((body) => { setContext(body.authenticated ? body.context || {} : null); })
      .catch(() => setContext(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (loading || !context) return;
    const organizations = context.organizations || [];
    if (context.staff || organizations.length > 1) return;
    if (organizations.length === 1) window.location.replace("/partner");
    else window.location.replace("/account");
  }, [loading, context]);
  if (loading) return <main className="operations-main"><section className="operations-shell compact"><p role="status">Loading your account options…</p></section></main>;
  if (context) return <AccountSwitcher context={context} />;
  return <SignedOutGateway />;
}

function SignedOutGateway() {
  const [donorEmail, setDonorEmail] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [message, setMessage] = useState("");
  const send = async (path: string, email: string) => {
    setMessage("");
    try { setMessage(await requestMagicLink(path, email)); }
    catch { setMessage("We could not request a secure link. Please try again."); }
  };
  return <main className="operations-main"><section className="operations-shell account-gateway">
    <p className="kicker">Your Donate by Mail account</p><h1>Manage your donation or phone drive.</h1>
    <p>Sign in with a one-time secure email link. Donor accounts are open to everyone; partner access is invitation-only.</p>
    <div className="account-grid">
      <article className="account-card"><p className="kicker">Personal / donor account</p><h2>Track your phone donations</h2><p>See your claimed donations, mailing updates, processing progress, and the charity you chose.</p>
        <form className="inline-ops" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send("/api/account/auth/magic-link", donorEmail); }}><label>Email<input type="email" autoComplete="email" value={donorEmail} onChange={(event) => setDonorEmail(event.target.value)} required /></label><div className="inline-actions"><button className="button primary">Log in</button><button className="button text" type="submit">Create an account</button></div></form>
      </article>
      <article className="account-card"><p className="kicker">Nonprofit partner account</p><h2>Manage a phone donation drive</h2><p>View your organization's campaigns, public pages, results, and campaign materials.</p>
        <form className="inline-ops" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send("/api/partner/auth/magic-link", partnerEmail); }}><label>Invited partner email<input type="email" autoComplete="email" value={partnerEmail} onChange={(event) => setPartnerEmail(event.target.value)} required /></label><button className="button primary">Partner log in</button></form><a href="/for-nonprofits.html">Start a phone drive</a><small>New partner access requires staff approval.</small>
      </article>
    </div>
    {message && <p role="status" className="account-message">{message}</p>}
  </section></main>;
}

function AccountSwitcher({ context }: { context: AccountContext }) {
  const organizations = context.organizations || [];
  return <main className="operations-main"><section className="operations-shell account-gateway"><div className="staff-heading"><div><p className="kicker">Signed in</p><h1>Choose where you want to go</h1><p>{context.email}</p></div><button className="button text" onClick={() => void logout().then(() => window.location.replace("/login"))}>Log out</button></div>
    <div className="account-grid"><a className="account-card account-card-link" href="/account"><p className="kicker">Personal</p><h2>My donations</h2><p>Track claimed phone donations and mailing updates.</p></a>
      {organizations.map((organization) => <a className="account-card account-card-link" href="/partner" key={organization.id}><p className="kicker">Partner</p><h2>{organization.name}</h2><p>Partner dashboard · {organization.role.replace("partner_", "")}</p></a>)}
      {context.staff && <a className="account-card account-card-link" href="/staff"><p className="kicker">Staff</p><h2>Operations</h2><p>Donation, campaign, and partner administration.</p></a>}
    </div>
    <a href="/settings">Account settings</a>
  </section></main>;
}

export function AccountSettingsPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { fetch("/api/account/profile", { credentials: "same-origin" }).then(async (response) => { if (!response.ok) throw new Error(); const body = await response.json() as { profile: { email: string; displayName?: string } }; setEmail(body.profile.email); setDisplayName(body.profile.displayName || ""); }).catch(() => setMessage("Sign in to view your account settings.")); }, []);
  return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Account settings</p><h1>Your account</h1><p>Update your preferred display name. Donation address snapshots remain attached to the original donation and are not changed here.</p><form className="inline-ops" onSubmit={async (event) => { event.preventDefault(); const response = await fetch("/api/account/profile", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName }) }); const body = await response.json() as { message?: string }; setMessage(body.message || (response.ok ? "Profile saved." : "The profile could not be saved.")); }}><label>Verified email<input value={email} readOnly /></label><label>Preferred name<input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} /></label><button className="button primary">Save profile</button></form><button className="button text" onClick={() => void logout().then(() => window.location.replace("/login"))}>Log out</button>{message && <p role="status">{message}</p>}</section></main>;
}
