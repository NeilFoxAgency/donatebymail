import { FormEvent, useCallback, useEffect, useState } from "react";
import { authenticatedApi, logout, sessionStatus } from "./AuthSession";

type SearchItem = { id: string; publicId: string; status: string; donorName: string; donorEmail: string; charityName: string; deviceCount: number; createdAt: string };
type Device = { id: string; donor_brand?: string; donor_model?: string; actual_brand?: string; actual_model?: string; receipt_status: string; inspection_status: string; processing_status: string; data_wipe_status: string; assessed_value_cents?: number };
type FinancialSale = { id: string; device_id: string; gross_amount_cents: number; status: string; reversal_of?: string | null; external_reference?: string | null };
type FinancialCost = { id: string; category: string; amount_cents: number; status: string; reversal_of?: string | null };
type Financial = { revision: number; finalizedAt?: string | null; disbursed: boolean; activeAllocation?: { id: string; status: string; gross_cents: number; eligible_cost_cents: number; allocated_cents?: number | null } | null; allocations: Array<{ id: string; status: string; gross_cents: number; eligible_cost_cents: number; allocated_cents?: number | null }>; sales: FinancialSale[]; costs: FinancialCost[] };
type Detail = SearchItem & { receivedAt?: string; packageCondition?: string; donor: { name: string; email: string; address1: string; address2: string; city: string; state: string; zip: string; country: string }; charity: { name: string }; devices: Device[]; notes: Array<{ id: string; body: string; createdAt: string }>; events: Array<{ status: string; message: string; occurredAt: string }>; financial?: Financial };
type Finance = { policyHolds: number; failedOutbox: number; openEscalations: number; allocations: Array<{ id: string; donationId: string; status: string; grossCents: number; eligibleCostCents: number; allocatedCents?: number; createdAt: string }>; disbursements: Array<{ id: string; preparationId: string; status: string; completedAt?: string }> };
type StaffCampaign = { id: string; name: string; slug: string; status: string; organizationName: string; charityName: string; revisions: Array<{ id: string; version: number; status: string; headline: string; summary: string; contentHash: string }> };
type PartnerOrganization = { id: string; name: string; slug: string; status: string; charities: Array<{ id: string; name: string; pledgeId: string }>; members: Array<{ userId: string; email: string; role: string; status: string }>; invitations: Array<{ id: string; email: string; role: string; status: string }>; campaigns: Array<{ id: string; name: string; slug: string; status: string }> };

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
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [campaigns, setCampaigns] = useState<StaffCampaign[]>([]);
  const [partners, setPartners] = useState<PartnerOrganization[]>([]);
  const load = useCallback(async (q = query) => {
    if (!authenticated) return;
    const body = await authenticatedApi(`/api/staff/donations?q=${encodeURIComponent(q)}`);
    setResults(body.donations);
  }, [query, authenticated]);
  const open = useCallback(async (id: string) => {
    const [body, financeBody] = await Promise.all([
      authenticatedApi(`/api/staff/donations/${id}`),
      authenticatedApi(`/api/staff/donations/${id}/financials`),
    ]);
    setDetail({ ...body.donation, financial: financeBody.financials });
  }, []);
  const loadDashboards = useCallback(async () => {
    if (!authenticated) return;
    const [financeBody, campaignBody, partnerBody] = await Promise.all([
      authenticatedApi("/api/staff/finance"), authenticatedApi("/api/staff/campaigns"), authenticatedApi("/api/staff/partners"),
    ]);
    setFinance(financeBody.finance); setCampaigns(campaignBody.campaigns.campaigns || []); setPartners(partnerBody.partners.organizations || []);
  }, [authenticated]);
  useEffect(() => { sessionStatus("/api/staff/session").then(setAuthenticated).catch(() => setAuthenticated(false)); }, []);
  useEffect(() => { if (authenticated) Promise.all([load(""), loadDashboards()]).catch(() => { setAuthenticated(false); setMessage("Your session ended. Request a new sign-in link."); }); }, [authenticated]);
  async function mutate(path: string, payload: unknown) {
    setMessage("");
    try {
      await authenticatedApi(path, { method: "POST", body: JSON.stringify(payload) });
      if (detail) await open(detail.id);
      await load();
      await loadDashboards();
      setMessage("Saved and audited.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The change could not be saved.");
    }
  }
  if (!authenticated) return <main className="operations-main"><section className="operations-shell compact"><p className="kicker">Authorized staff</p><h1>Staff sign in</h1><p>We’ll email a one-time secure link to an authorized beta staff address.</p><form onSubmit={async (event) => { event.preventDefault(); const response = await fetch("/api/staff/auth/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); const body = await response.json() as { message: string }; setMessage(body.message); }}><label>Email<input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><button className="button primary">Email secure sign-in link</button></form>{message && <p role="status">{message}</p>}</section></main>;
  return <main className="operations-main"><section className="operations-shell"><div className="staff-heading"><div><p className="kicker">Beta operations</p><h1>Donation management</h1></div><button className="button text" onClick={() => void logout().finally(() => setAuthenticated(false))}>Sign out</button></div>
    <form className="staff-search" onSubmit={(e) => { e.preventDefault(); void load(); }}><label>Search donations<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, donor, email, or charity" /></label><button className="button primary">Search</button></form>
    {message && <p role="status">{message}</p>}
    <div className="staff-layout"><aside><h2>Donations</h2>{results.map((item) => <button key={item.id} className="donation-result" onClick={() => void open(item.id)}><strong>{item.publicId}</strong><span>{item.donorName}</span><small>{item.status} · {item.deviceCount} device(s)</small></button>)}</aside>
    <div>{detail ? <DonationDetail detail={detail} mutate={mutate} /> : <div className="empty-panel">Select a donation to manage it.</div>}</div></div>
    <OperationsOverview finance={finance} campaigns={campaigns} publish={async (campaignId, revisionId) => {
      await mutate("/api/staff/campaigns/publish", { campaignId, revisionId });
    }} financialAction={mutate} />
    <PartnerAdministration organizations={partners} mutate={mutate} />
  </section></main>;
}

function PartnerAdministration({ organizations, mutate }: { organizations: PartnerOrganization[]; mutate: (path: string, payload: unknown) => Promise<void> }) {
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

function OperationsOverview({ finance, campaigns, publish, financialAction }: { finance: Finance | null; campaigns: StaffCampaign[]; publish: (campaignId: string, revisionId: string) => Promise<void>; financialAction: (path: string, payload: unknown) => Promise<void> }) {
  return <section className="operations-overview"><h2>Operations overview</h2>
    {finance && <><div className="account-grid"><article className="account-card"><strong>{finance.policyHolds}</strong><span> policy holds</span></article><article className="account-card"><strong>{finance.failedOutbox}</strong><span> failed outbox jobs</span></article><article className="account-card"><strong>{finance.openEscalations}</strong><span> agent escalations</span></article></div><h3>Allocation ledger</h3>{finance.allocations.length ? finance.allocations.map((allocation) => <article className="account-card" key={allocation.id}><strong>{allocation.status}</strong><p>Gross ${(allocation.grossCents/100).toFixed(2)} · eligible costs ${(allocation.eligibleCostCents/100).toFixed(2)} · allocated {allocation.allocatedCents == null ? "on hold" : `$${(allocation.allocatedCents/100).toFixed(2)}`}</p>{allocation.allocatedCents != null && allocation.status === "calculated" && <form className="inline-ops" onSubmit={(event) => { event.preventDefault(); const f=new FormData(event.currentTarget); void financialAction("/api/staff/finance/disbursements/prepare", { allocationId:allocation.id, amountCents:Math.round(Number(f.get("amount"))*100), paymentMemo:f.get("memo"), evidence:{reference:f.get("evidence")} }); }}><p>The canonical charity is derived from this allocation and cannot be replaced here.</p><label>Prepare amount ($)<input name="amount" type="number" min="0.01" max={(allocation.allocatedCents/100).toFixed(2)} step="0.01" required /></label><label>Optional payment memo<input name="memo" /></label><label>Evidence reference<input name="evidence" /></label><button>Prepare manual disbursement</button></form>}</article>) : <p>No proceeds allocations recorded.</p>}<h3>Manual disbursement ledger</h3>{finance.disbursements.length ? finance.disbursements.map((entry) => <article className="account-card" key={entry.id}><strong>{entry.status}</strong><p>Preparation {entry.preparationId}</p>{entry.status==="prepared" && <form className="inline-ops" onSubmit={(event)=>{event.preventDefault();const f=new FormData(event.currentTarget);void financialAction(`/api/staff/finance/disbursements/${entry.preparationId}/decision`,{outcome:f.get("outcome"),reason:f.get("reason")});}}><label>Decision<select name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label>Reason<input name="reason" /></label><button>Record decision</button></form>}{entry.status==="approved" && <form className="inline-ops" onSubmit={(event)=>{event.preventDefault();const f=new FormData(event.currentTarget);void financialAction(`/api/staff/finance/disbursements/${entry.preparationId}/complete`,{externalReference:f.get("reference")});}}><label>External payment reference<input name="reference" required /></label><button>Record externally completed payment</button></form>}</article>) : <p>No disbursements recorded.</p>}</>}
    <h2>Campaign review</h2>{campaigns.length ? <div className="account-grid">{campaigns.map((campaign) => <article className="account-card" key={campaign.id}><p className="kicker">{campaign.status}</p><h3>{campaign.name}</h3><p>{campaign.organizationName} · {campaign.charityName}</p>{campaign.revisions.filter((revision) => revision.status === "draft").map((revision) => <div key={revision.id}><strong>Revision {revision.version}: {revision.headline}</strong><p>{revision.summary}</p><small>Checksum {revision.contentHash.slice(0, 12)}…</small><br /><button onClick={() => void publish(campaign.id, revision.id)}>Publish this exact revision</button></div>)}</article>)}</div> : <p>No campaign drafts are waiting for review.</p>}
  </section>;
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
  return <section className="financial-controls"><h3>Financial correction history</h3><p><strong>Revision {financial.revision}</strong> · {open ? "Open for staff corrections" : `Finalized ${new Date(financial.finalizedAt!).toLocaleString()}`} · {financial.disbursed ? "External payment completed" : "No external payment completed"}</p>{financial.activeAllocation && <p>Current allocation: <strong>{financial.activeAllocation.status}</strong> · gross ${(financial.activeAllocation.gross_cents / 100).toFixed(2)} · eligible costs ${(financial.activeAllocation.eligible_cost_cents / 100).toFixed(2)} · allocated {financial.activeAllocation.allocated_cents == null ? "policy hold" : `$${(financial.activeAllocation.allocated_cents / 100).toFixed(2)}`}</p>}
    {!open && !financial.disbursed && <form className="inline-ops" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate("/api/staff/finance/reopen", { donationId, reason: form.get("reason") }); }}><h4>Reopen financials</h4><p>The previous allocation remains immutable in the audit history. Reopening creates a new correction revision.</p><label>Correction reason<textarea name="reason" required /></label><button>Reopen financials</button></form>}
    {!open && financial.disbursed && <p className="financial-warning">This donation has a completed external payout. Reopening is unavailable; use the separate adjustment process.</p>}
    <h4>Recorded sales</h4>{financial.sales.length ? financial.sales.map((sale) => <div className="financial-entry" key={sale.id}><span>{sale.status} · ${(sale.gross_amount_cents / 100).toFixed(2)}{sale.external_reference ? ` · ${sale.external_reference}` : ""}</span>{open && sale.status === "recorded" && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate(`/api/staff/finance/sales/${sale.id}/reverse`, { reason: form.get("reason") }); }}><input name="reason" placeholder="Reason required" required /><button>Reverse sale</button></form>}</div>) : <p>No sales recorded.</p>}
    <h4>Recorded costs</h4>{financial.costs.length ? financial.costs.map((cost) => <div className="financial-entry" key={cost.id}><span>{cost.status} · {cost.category} · ${(cost.amount_cents / 100).toFixed(2)}</span>{open && cost.status === "recorded" && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate(`/api/staff/finance/costs/${cost.id}/reverse`, { reason: form.get("reason") }); }}><input name="reason" placeholder="Reason required" required /><button>Reverse cost</button></form>}</div>) : <p>No costs recorded.</p>}
  </section>;
}

function DeviceForm({ device, readOnly = false, onSave }: { device: Device; readOnly?: boolean; onSave: (patch: unknown) => Promise<void> }) {
  return <form className="device-ops" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (readOnly) return; const f = new FormData(e.currentTarget); void onSave({ actualBrand: f.get("brand"), actualModel: f.get("model"), inspectionStatus: f.get("inspection"), processingStatus: f.get("processing"), dataWipeStatus: f.get("wipe"), assessedValueCents: f.get("value") ? Math.round(Number(f.get("value")) * 100) : null }); }}><h4>{device.actual_brand || device.donor_brand} {device.actual_model || device.donor_model}</h4>{readOnly && <p className="financial-warning">Financial inputs are finalized. Reopen the revision before changing device facts.</p>}<label>Actual brand<input name="brand" defaultValue={device.actual_brand || device.donor_brand} readOnly={readOnly} /></label><label>Actual model<input name="model" defaultValue={device.actual_model || device.donor_model} readOnly={readOnly} /></label><label>Inspection<select name="inspection" defaultValue={device.inspection_status} disabled={readOnly}><option>pending</option><option>inspecting</option><option>inspected</option><option>blocked</option></select></label><label>Processing<select name="processing" defaultValue={device.processing_status} disabled={readOnly}><option>pending</option><option>reuse</option><option>resale</option><option>parts</option><option>recycle</option><option>returned</option><option>complete</option></select></label><label>Data wipe<select name="wipe" defaultValue={device.data_wipe_status} disabled={readOnly}><option>not_started</option><option>pending</option><option>completed</option><option>not_required</option><option>blocked</option></select></label><label>Assessed value ($)<input name="value" type="number" min="0" step="0.01" defaultValue={device.assessed_value_cents == null ? "" : device.assessed_value_cents / 100} readOnly={readOnly} /></label>{!readOnly && <button>Save device inspection</button>}</form>;
}
