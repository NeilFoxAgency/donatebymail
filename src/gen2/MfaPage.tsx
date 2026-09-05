import { FormEvent, useEffect, useRef, useState } from "react";
import { authenticatedApi, logout } from "./AuthSession";
import { safeInternalRedirect } from "./urlSafety";

type Enrollment = { factorId: string; qrCode: string; secret: string };
type Factor = { id: string; friendlyName: string };

export function MfaChallengePage() {
  const started = useRef(false);
  const [challenge, setChallenge] = useState<{ factorId: string; challengeId: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("Starting your security challenge…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    authenticatedApi("/api/auth/mfa/challenge", { method: "POST", body: "{}" })
      .then((body) => { setChallenge({ factorId: body.factorId, challengeId: body.challengeId }); setMessage(""); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "The security challenge could not start."));
  }, []);
  return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Two-step verification</p><h1>Enter your authenticator code</h1><p>Your email link was accepted. Complete the second step to open your private workspace.</p>
    <form className="inline-ops" onSubmit={async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!challenge) return; setBusy(true); setMessage(""); try { const body=await authenticatedApi("/api/auth/mfa/verify",{ method:"POST",body:JSON.stringify({ ...challenge,code }) }); window.location.replace(safeInternalRedirect(body.redirect, "/login")); } catch (error) { setMessage(error instanceof Error ? error.message : "The authenticator code was not accepted."); setBusy(false); } }}><label>Six-digit code<input value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required autoFocus /></label><button className="button primary" disabled={!challenge || busy}>{busy ? "Verifying…" : "Verify and continue"}</button></form>
    <button className="button text" disabled={busy} onClick={async () => { if (busy) return; setBusy(true); try { await logout(); window.location.replace("/login"); } catch (error) { setMessage(error instanceof Error ? error.message : "Sign out failed. Please try again."); setBusy(false); } }}>{busy ? "Signing out…" : "Cancel and sign out"}</button>{message && <p role={challenge ? "alert" : "status"}>{message}</p>}
  </section></main>;
}

export function MfaSettings() {
  const [factors,setFactors]=useState<Factor[]>([]);
  const [enrollment,setEnrollment]=useState<Enrollment|null>(null);
  const [code,setCode]=useState("");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [actionBusy,setActionBusy]=useState(false);
  const [verifyBusy,setVerifyBusy]=useState(false);
  const [enrollmentRequired,setEnrollmentRequired]=useState(new URLSearchParams(window.location.search).get("mfa") === "required");
  const load=()=>authenticatedApi("/api/auth/mfa/status").then((body)=>{setFactors(body.factors || []);setEnrollmentRequired(body.enrollmentRequired === true);}).finally(()=>setLoading(false));
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error ? error.message : "Security settings could not be loaded."));},[]);
  const qrCode = typeof enrollment?.qrCode === "string" ? enrollment.qrCode : "";
  const qrSource = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:[;,])/i.test(qrCode)
    ? qrCode
    : qrCode ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}` : "";
  return <section className="account-card"><p className="kicker">{enrollmentRequired ? "Required staff security" : "Optional account security"}</p><h2>Authenticator app</h2><p>{enrollmentRequired ? "Staff and administrator workspaces require a verified authenticator code in addition to the email sign-in link." : "Add a time-based one-time code for a second step after future email-link sign-ins."}</p>
    {loading ? <p role="status">Loading security settings…</p> : factors.length ? factors.map((factor)=><div className="team-row" key={factor.id}><span><strong>{factor.friendlyName}</strong><small>Verified authenticator</small></span><button className="button text" disabled={actionBusy} onClick={async()=>{if(actionBusy)return;setActionBusy(true);setMessage("");try{const body=await authenticatedApi("/api/auth/mfa/unenroll",{method:"POST",body:JSON.stringify({factorId:factor.id})});if(body.signInRequired)window.location.replace(safeInternalRedirect(body.redirect, "/login"));else{await load();setMessage("Authenticator removed.");}}catch(error){setMessage(error instanceof Error?error.message:"Authenticator could not be removed.");}finally{setActionBusy(false);}}}>{actionBusy ? "Working…" : "Remove"}</button></div>) : !enrollment && <button className="button text" disabled={actionBusy} onClick={async()=>{if(actionBusy)return;setActionBusy(true);setMessage("");try{const body=await authenticatedApi("/api/auth/mfa/enroll",{method:"POST",body:JSON.stringify({friendlyName:"Donate by Mail authenticator"})});setEnrollment(body.enrollment);}catch(error){setMessage(error instanceof Error?error.message:"Authenticator enrollment could not start.");}finally{setActionBusy(false);}}}>{actionBusy ? "Starting…" : enrollmentRequired ? "Set up required authenticator" : "Add authenticator app"}</button>}
    {enrollment && <div className="mfa-enrollment"><h3>Scan and verify</h3><p>Scan this QR code with an authenticator app. If you cannot scan it, enter the setup key manually.</p><img src={qrSource} alt="Authenticator setup QR code" /><p><strong>Setup key:</strong> <code>{enrollment.secret}</code></p><form className="inline-ops" onSubmit={async(event)=>{event.preventDefault();if(verifyBusy)return;setVerifyBusy(true);setMessage("");try{const body=await authenticatedApi("/api/auth/mfa/enroll/verify",{method:"POST",body:JSON.stringify({factorId:enrollment.factorId,code})});window.location.replace(safeInternalRedirect(body.redirect, "/settings?mfa=enrolled"));}catch(error){setMessage(error instanceof Error?error.message:"The authenticator code was not accepted.");}finally{setVerifyBusy(false);}}}><label>Six-digit code<input value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label><button className="button primary" disabled={verifyBusy}>{verifyBusy ? "Verifying…" : "Verify authenticator"}</button><button type="button" className="button text" disabled={verifyBusy} onClick={()=>{setEnrollment(null);setCode("");}}>Cancel</button></form></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
