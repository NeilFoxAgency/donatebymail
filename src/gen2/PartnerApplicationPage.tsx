import { FormEvent, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { publicApi } from "./AuthSession";
import { TURNSTILE_SITE_KEY, TurnstileWidget } from "./TurnstileWidget";

export function PartnerApplicationPage() {
  const idempotencyKey = useRef(crypto.randomUUID());
  const submitBusyRef = useRef(false);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [message, setMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  if (state === "sent") return <main className="partner-application-page"><section className="operations-shell compact application-success">
    <CheckCircle2 aria-hidden="true" /><p className="kicker">Application received</p><h1>Thank you for starting a conversation.</h1>
    <p>We sent an acknowledgment and will verify your organization before creating a workspace or publishing a campaign.</p>
    <a className="button primary" href="/for-nonprofits.html">Return to nonprofit partnerships <ArrowRight aria-hidden="true" /></a>
  </section></main>;
  return <main className="partner-application-page"><section className="operations-shell application-shell">
    <div className="application-intro"><p className="kicker">Nonprofit partnership application</p><h1>Tell us about the campaign you want to run.</h1>
      <p>This short application helps Donate by Mail verify your organization, understand your audience, and prepare the right workspace.</p>
      <div className="trust-note"><ShieldCheck aria-hidden="true" /><span>Your contact information stays private and is used only to review and support the partnership.</span></div></div>
    <form className="partner-application-form" onSubmit={async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitBusyRef.current) return;
      submitBusyRef.current = true;
      setState("sending"); setMessage("");
      const form = event.currentTarget;
      try {
        if (TURNSTILE_SITE_KEY && !turnstileToken) throw new Error("Please complete the security verification.");
        const values = Object.fromEntries(new FormData(form));
        await publicApi("/api/partner/applications", { method: "POST", body: JSON.stringify({
          ...values, consent: values.consent === "on", idempotencyKey: idempotencyKey.current, turnstileToken,
        }) });
        setState("sent");
      } catch (error) { setMessage(error instanceof Error ? error.message : "The application could not be submitted."); setState("idle"); }
      finally { submitBusyRef.current = false; }
    }}>
      <fieldset><legend>Your contact</legend><div className="form-grid">
        <label>Full name<input name="contactName" autoComplete="name" maxLength={160} required /></label>
        <label>Role or title<input name="role" autoComplete="organization-title" maxLength={160} required /></label>
      </div><label>Work email<input name="email" type="email" autoComplete="email" maxLength={320} required /></label></fieldset>
      <fieldset><legend>Your organization</legend><div className="form-grid">
        <label>Organization name<input name="organizationName" autoComplete="organization" maxLength={200} required /></label>
        <label>Website<input name="website" type="url" inputMode="url" placeholder="https://example.org" pattern="https://.*" maxLength={1000} required /></label>
      </div><label>Who would you invite to participate?<textarea name="audience" rows={4} maxLength={2000} required /></label>
      <label>What should this campaign accomplish?<textarea name="goal" rows={4} maxLength={2000} required /></label>
      <label>Desired timing<input name="timing" placeholder="For example, October through December" maxLength={500} required /></label></fieldset>
      <label className="check consent-check"><input name="consent" type="checkbox" required />I agree that Donate by Mail may email me about this application and potential partnership.</label>
      <TurnstileWidget action="partner_application" onToken={setTurnstileToken} />
      {message && <p className="form-error" role="alert">{message}</p>}
      <button className="button primary" disabled={state === "sending"}>{state === "sending" ? "Submitting…" : "Submit partnership application"}</button>
      <small>No campaign or public page is created until Donate by Mail verifies the organization and approves the exact content.</small>
    </form>
  </section></main>;
}
