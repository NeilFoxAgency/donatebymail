import { FormEvent, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Copy,
  FileCheck2,
  FileText,
  Info,
  LockKeyhole,
  Mail,
  Plus,
  Printer,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { trackEvent } from './analytics';

export const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'tre@donatebymail.org';

type Brand = 'Apple' | 'Samsung' | 'Google' | 'Motorola' | 'Other';
type Age = '0-1 year' | '2-3 years' | '4-5 years' | '6+ years';
type Condition = 'Excellent' | 'Good' | 'Fair' | 'Damaged';
type Storage = '64 GB or less' | '128 GB' | '256 GB' | '512 GB+';
type ShippingMethod = 'donor-paid';

type Device = {
  id: string;
  brand: Brand;
  model: string;
  age: Age;
  condition: Condition;
  storage: Storage;
  powersOn: boolean;
  activationLockRemoved: boolean;
};

export type DonorDetails = {
  name: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
};

export type DonationRecord = {
  id: string;
  createdAt: string;
  donor: DonorDetails;
  shippingMethod: ShippingMethod;
  devices: Device[];
};

const brands: Brand[] = ['Apple', 'Samsung', 'Google', 'Motorola', 'Other'];
const ages: Age[] = ['0-1 year', '2-3 years', '4-5 years', '6+ years'];
const conditions: Condition[] = ['Excellent', 'Good', 'Fair', 'Damaged'];
const storageOptions: Storage[] = ['64 GB or less', '128 GB', '256 GB', '512 GB+'];
const states = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'];
const MAX_LEGACY_DEVICES = 20;

const baseValues: Record<Brand, Record<Age, number>> = {
  Apple: { '0-1 year': 430, '2-3 years': 250, '4-5 years': 110, '6+ years': 35 },
  Samsung: { '0-1 year': 320, '2-3 years': 180, '4-5 years': 75, '6+ years': 25 },
  Google: { '0-1 year': 260, '2-3 years': 150, '4-5 years': 65, '6+ years': 22 },
  Motorola: { '0-1 year': 145, '2-3 years': 80, '4-5 years': 35, '6+ years': 12 },
  Other: { '0-1 year': 105, '2-3 years': 55, '4-5 years': 22, '6+ years': 8 },
};

const conditionFactor: Record<Condition, number> = { Excellent: 1, Good: 0.78, Fair: 0.48, Damaged: 0.18 };
const storageFactor: Record<Storage, number> = { '64 GB or less': 0.9, '128 GB': 1, '256 GB': 1.12, '512 GB+': 1.25 };
const draftKey = 'dbm-donation-draft-v2';

const blankDonor: DonorDetails = {
  name: '',
  email: '',
  address1: '',
  address2: '',
  city: '',
  state: 'FL',
  zip: '',
};

const newDevice = (id: string): Device => ({
  id,
  brand: 'Apple',
  model: '',
  age: '2-3 years',
  condition: 'Good',
  storage: '128 GB',
  powersOn: true,
  activationLockRemoved: true,
});

const estimate = (device: Device) => {
  const midpoint = baseValues[device.brand][device.age]
    * conditionFactor[device.condition]
    * storageFactor[device.storage]
    * (device.powersOn ? 1 : 0.38)
    * (device.activationLockRemoved ? 1 : 0.4);
  return {
    low: Math.max(1, Math.round(midpoint * 0.82)),
    high: Math.max(2, Math.round(midpoint * 1.17)),
  };
};

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(value);

const donationId = () => {
  const date = new Date().toISOString().slice(0, 10).split('-').join('');
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `DBM-${date}-${random}`;
};

function isLegacyDevice(value: unknown): value is Device {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const device = value as Record<string, unknown>;
  if (!Object.keys(device).every((key) => ['id', 'brand', 'model', 'age', 'condition', 'storage', 'powersOn', 'activationLockRemoved'].includes(key))) return false;
  return typeof device.id === 'string' && device.id.trim().length > 0 && device.id.length <= 120
    && typeof device.model === 'string' && device.model.length <= 160
    && typeof device.brand === 'string' && brands.includes(device.brand as Brand)
    && typeof device.age === 'string' && ages.includes(device.age as Age)
    && typeof device.condition === 'string' && conditions.includes(device.condition as Condition)
    && typeof device.storage === 'string' && storageOptions.includes(device.storage as Storage)
    && typeof device.powersOn === 'boolean' && typeof device.activationLockRemoved === 'boolean';
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-bold text-slate-800">{label}{required && <span className="text-[#c9273d]"> *</span>}</span>{children}</label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <Field label={label}><span className="relative block"><select value={value} onChange={(event) => onChange(event.target.value)} className="input-control appearance-none pr-10">{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-500" /></span></Field>;
}

function Logo() {
  return <span className="brand-mark h-12 w-12"><Mail className="relative z-10 h-6 w-6 text-white" /></span>;
}

function PrintDocument({ record, kind, onClose }: { record: DonationRecord; kind: 'packing' | 'acknowledgment'; onClose: () => void }) {
  const isPacking = kind === 'packing';
  const descriptions = record.devices.map((device, index) => `${index + 1}. ${device.brand} ${device.model || 'smartphone'}; approximately ${device.age} old; ${device.condition.toLowerCase()} condition; ${device.storage}; ${device.powersOn ? 'powers on' : 'does not power on'}; activation lock ${device.activationLockRemoved ? 'reported removed' : 'not reported removed'}.`);

  const print = () => {
    document.body.dataset.printTarget = kind;
    trackEvent(isPacking ? 'packing_slip_printed' : 'acknowledgment_preview_printed');
    window.print();
  };

  return <div className="document-backdrop" role="dialog" aria-modal="true" aria-labelledby="document-title">
    <div className="document-modal no-print"><div><p className="eyebrow">Document center</p><h2 id="document-title" className="font-display text-2xl font-bold text-[#102d4f]">{isPacking ? 'Donation packing slip' : 'Acknowledgment preview'}</h2></div><div className="flex gap-2"><button className="button-primary" onClick={print}><Printer className="h-4 w-4" />Print or save PDF</button><button className="button-secondary" onClick={onClose}>Close</button></div></div>
    <article id={isPacking ? 'packing-document' : 'acknowledgment-document'} className="print-document">
      <div className="document-stripes"><span /><span /><span /></div>
      <header className="flex flex-col justify-between gap-6 border-b-2 border-[#102d4f] pb-7 sm:flex-row sm:items-start"><div className="flex items-center gap-4"><Logo /><div><h2 className="font-display text-3xl font-bold text-[#102d4f]">Donate by Mail</h2><p className="mt-1 font-semibold text-slate-600">{isPacking ? 'Donation packing slip' : 'Noncash charitable contribution acknowledgment'}</p></div></div><div className="text-sm"><p className="font-bold text-[#102d4f]">Donation ID</p><p className="font-mono">{record.id}</p><p className="mt-2 text-slate-600">Created {new Date(record.createdAt).toLocaleDateString()}</p></div></header>
      {!isPacking && <div className="mt-7 rounded-xl border-2 border-[#c9273d] bg-red-50 p-4 text-sm font-bold text-[#8f1d2d]">PREVIEW - PENDING PHYSICAL RECEIPT AND STAFF VERIFICATION</div>}
      <div className="mt-8 grid gap-7 sm:grid-cols-2"><section><h3 className="document-heading">Donor</h3><p className="font-bold">{record.donor.name}</p><p>{record.donor.address1}</p>{record.donor.address2 && <p>{record.donor.address2}</p>}<p>{record.donor.city}, {record.donor.state} {record.donor.zip}</p><p className="mt-2">{record.donor.email}</p></section><section><h3 className="document-heading">Organization</h3><p className="font-bold">Donate by Mail</p><p>U.S. 501(c)(3) public charity</p><p>EIN 92-1515120</p><p className="mt-2">donatebymail.org</p></section></div>
      <section className="mt-8"><h3 className="document-heading">Property described by donor</h3><div className="mt-3 space-y-2 text-sm leading-6">{descriptions.map((description) => <p key={description}>{description}</p>)}</div></section>
      {isPacking ? <><section className="mt-8 rounded-xl bg-slate-100 p-5"><h3 className="font-bold text-[#102d4f]">Before sealing the box</h3><ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><li>□ Back up needed files</li><li>□ Sign out of accounts</li><li>□ Remove activation locks</li><li>□ Factory reset when possible</li><li>□ Remove SIM and memory cards</li><li>□ Do not include passcodes</li></ul></section><section className="mt-8"><h3 className="document-heading">Receiving staff use</h3><div className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><p>Received date: __________________</p><p>Received by: __________________</p><p>Device count: __________________</p><p>Package condition: _____________</p></div></section></> : <><section className="mt-8 rounded-xl bg-blue-50 p-5 text-sm leading-7"><strong>No goods or services were provided by Donate by Mail in exchange for this contribution.</strong></section><p className="mt-7 text-sm leading-7 text-slate-700">Donate by Mail does not determine or confirm fair market value for donated property. The donor is responsible for determining and substantiating any charitable deduction. A finalized acknowledgment is issued only after the organization physically receives and verifies the property.</p><div className="mt-12 grid gap-8 sm:grid-cols-2"><p>Authorized signature: __________________</p><p>Receipt date: __________________</p></div></>}
      <footer className="mt-12 border-t pt-5 text-xs leading-5 text-slate-500">Questions about this donation may be directed to {CONTACT_EMAIL}. Keep this document with your records. The packing slip is not a tax receipt.</footer>
    </article>
  </div>;
}

export function loadLatestRecord(): DonationRecord | null {
  // Completed donor records must come from the server-backed donation flow.
  // This legacy component is retained only for compatibility and never reads
  // donor PII from browser storage.
  return null;
}

export default function DonationTool({ onComplete }: { onComplete: (record: DonationRecord) => void }) {
  const [devices, setDevices] = useState<Device[]>([newDevice('phone-1')]);
  const [donor, setDonor] = useState<DonorDetails>(blankDonor);
  const shippingMethod: ShippingMethod = 'donor-paid';
  const [prepared, setPrepared] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  const totals = useMemo(() => devices.reduce((sum, device) => {
    const current = estimate(device);
    return { low: sum.low + current.low, high: sum.high + current.high };
  }, { low: 0, high: 0 }), [devices]);

  const updateDevice = <K extends keyof Device>(id: string, key: K, value: Device[K]) => setDevices((current) => current.map((device) => device.id === id ? { ...device, [key]: value } : device));
  const updateDonor = (key: keyof DonorDetails, value: string) => setDonor((current) => ({ ...current, [key]: value }));

  const saveDraft = () => {
    // Device details are not donor identity data. Never persist names,
    // addresses, or email addresses in browser storage.
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ devices, shippingMethod }));
    } catch {
      return;
    }
    setDraftSaved(true);
    trackEvent('donation_draft_saved', { device_count: devices.length });
    window.setTimeout(() => setDraftSaved(false), 2500);
  };

  const restoreDraft = () => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { devices?: unknown; shippingMethod?: unknown };
      const deviceIds = new Set<string>();
      if (!Array.isArray(parsed.devices) || parsed.devices.length < 1 || parsed.devices.length > MAX_LEGACY_DEVICES
        || parsed.shippingMethod !== shippingMethod || !parsed.devices.every((device) => isLegacyDevice(device) && !deviceIds.has(device.id) && (deviceIds.add(device.id), true))) throw new Error('invalid legacy draft');
      setDevices(parsed.devices);
      trackEvent('donation_draft_restored');
    } catch {
      try { window.localStorage.removeItem(draftKey); } catch { /* Ignore unavailable storage. */ }
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prepared) return;
    const record: DonationRecord = {
      id: donationId(),
      createdAt: new Date().toISOString(),
      donor,
      shippingMethod,
      devices,
    };
    trackEvent('donation_packet_created', { device_count: record.devices.length, shipping_method: shippingMethod });
    onComplete(record);
  };

  return <div className="space-y-8">
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-7 text-[#102d4f]"><Info className="mb-2 h-5 w-5" /><strong>Estimate, not appraisal.</strong> This range is an informational resale estimate. Donate by Mail does not determine the tax value of donated property.</div>

    <section aria-labelledby="phone-details-heading"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Step 1</p><h2 id="phone-details-heading" className="font-display text-3xl font-bold text-[#102d4f]">Describe your phones</h2></div><div className="flex gap-2"><button type="button" className="button-secondary" onClick={restoreDraft}><ClipboardCheck className="h-4 w-4" />Restore draft</button><button type="button" className="button-secondary" onClick={saveDraft}><Save className="h-4 w-4" />{draftSaved ? 'Saved' : 'Save draft'}</button></div></div>
      <div className="mt-6 space-y-5">{devices.map((device, index) => { const value = estimate(device); return <article className="card p-5 sm:p-7" key={device.id}><div className="mb-6 flex items-center justify-between"><div className="flex items-center gap-3"><span className="number-badge">{index + 1}</span><h3 className="font-display text-xl font-bold text-[#102d4f]">Phone {index + 1}</h3></div>{devices.length > 1 && <button type="button" className="icon-button" onClick={() => setDevices((current) => current.filter((item) => item.id !== device.id))} aria-label={`Remove phone ${index + 1}`}><Trash2 className="h-4 w-4" /></button>}</div><div className="grid gap-5 sm:grid-cols-2"><SelectField label="Brand" value={device.brand} options={brands} onChange={(value) => updateDevice(device.id, 'brand', value as Brand)} /><Field label="Exact model, if known"><input maxLength={160} className="input-control" value={device.model} onChange={(event) => updateDevice(device.id, 'model', event.target.value)} placeholder="Example: iPhone 13" /></Field><SelectField label="Approximate age" value={device.age} options={ages} onChange={(value) => updateDevice(device.id, 'age', value as Age)} /><SelectField label="Condition" value={device.condition} options={conditions} onChange={(value) => updateDevice(device.id, 'condition', value as Condition)} /><SelectField label="Storage" value={device.storage} options={storageOptions} onChange={(value) => updateDevice(device.id, 'storage', value as Storage)} /><div className="grid gap-3"><label className="check-card"><span>Phone powers on</span><input type="checkbox" checked={device.powersOn} onChange={(event) => updateDevice(device.id, 'powersOn', event.target.checked)} /></label><label className="check-card"><span>Activation lock removed</span><input type="checkbox" checked={device.activationLockRemoved} onChange={(event) => updateDevice(device.id, 'activationLockRemoved', event.target.checked)} /></label></div></div><div className="mt-6 flex flex-col gap-2 rounded-2xl bg-[#eaf0f7] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-bold text-[#174f8c]">Estimated potential resale value</span><span className="font-display text-2xl font-bold text-[#102d4f]">{money(value.low)} - {money(value.high)}</span></div></article>; })}</div>
      <button type="button" disabled={devices.length >= MAX_LEGACY_DEVICES} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-300 bg-white px-5 py-4 font-bold text-[#174f8c] transition hover:bg-blue-50" onClick={() => setDevices((current) => current.length >= MAX_LEGACY_DEVICES ? current : [...current, newDevice(crypto.randomUUID())])}><Plus className="h-4 w-4" />{devices.length >= MAX_LEGACY_DEVICES ? 'Maximum of 20 phones' : 'Add another phone'}</button>
      <div className="mt-6 rounded-2xl bg-[#102d4f] p-6 text-white"><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-200">Combined informational estimate</p><p className="mt-2 font-display text-4xl font-bold">{money(totals.low)} - {money(totals.high)}</p><p className="mt-2 text-sm text-blue-100">Final proceeds depend on inspection, market demand, shipping, handling, and resale costs.</p></div>
    </section>

    <form onSubmit={submit} className="card p-6 sm:p-8" aria-labelledby="mailing-heading"><p className="eyebrow">Step 2</p><h2 id="mailing-heading" className="font-display text-3xl font-bold text-[#102d4f]">Create your donor packet</h2><p className="mt-3 max-w-3xl leading-7 text-slate-600">Enter the contact information that should appear on your packing slip and eventual acknowledgment. This preview stores the completed record in your browser only.</p>
      <div className="mt-7 grid gap-5 sm:grid-cols-2"><Field label="Full name" required><input required maxLength={240} autoComplete="name" className="input-control" value={donor.name} onChange={(event) => updateDonor('name', event.target.value)} /></Field><Field label="Email" required><input required maxLength={320} type="email" autoComplete="email" className="input-control" value={donor.email} onChange={(event) => updateDonor('email', event.target.value)} /></Field><Field label="Street address" required><input required maxLength={240} autoComplete="address-line1" className="input-control" value={donor.address1} onChange={(event) => updateDonor('address1', event.target.value)} /></Field><Field label="Apartment, suite, or unit"><input maxLength={240} autoComplete="address-line2" className="input-control" value={donor.address2} onChange={(event) => updateDonor('address2', event.target.value)} /></Field><Field label="City" required><input required maxLength={160} autoComplete="address-level2" className="input-control" value={donor.city} onChange={(event) => updateDonor('city', event.target.value)} /></Field><div className="grid grid-cols-[1fr_1.3fr] gap-4"><SelectField label="State" value={donor.state} options={states} onChange={(value) => updateDonor('state', value)} /><Field label="ZIP code" required><input required maxLength={32} inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" autoComplete="postal-code" className="input-control" value={donor.zip} onChange={(event) => updateDonor('zip', event.target.value)} /></Field></div></div>
      <div className="mt-7 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-7 text-[#102d4f]"><Mail className="mb-2 h-5 w-5" /><strong>Use your own packaging and pay for postage.</strong><br />Your printable mailing label will be addressed to Donate By Mail, 4103 Tropical Isle Blvd, Apt 124, Kissimmee, FL 34741.</div>
      <label className="mt-7 flex items-start gap-3 rounded-2xl bg-slate-100 p-5"><input required type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[#174f8c]" checked={prepared} onChange={(event) => setPrepared(event.target.checked)} /><span className="text-sm leading-7 text-slate-700">I understand that I should back up needed files, sign out of accounts, remove activation locks, factory reset each phone when possible, and never include passwords or passcodes.</span></label>
      <button className="button-primary mt-6 w-full justify-center py-4" type="submit"><FileCheck2 className="h-5 w-5" />Create donation packet <ArrowRight className="h-4 w-4" /></button>
    </form>
  </div>;
}

export function DonationThankYou({ record, onStartOver }: { record: DonationRecord; onStartOver: () => void }) {
  const [document, setDocument] = useState<'packing' | 'acknowledgment' | null>(null);
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    await navigator.clipboard.writeText(record.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return <div className="mx-auto max-w-5xl px-5 py-16 lg:px-8"><div className="rounded-3xl bg-[#102d4f] p-7 text-white sm:p-10"><span className="grid h-16 w-16 place-items-center rounded-full bg-white text-[#174f8c]"><CheckCircle2 className="h-8 w-8" /></span><p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Donation packet created</p><h1 className="mt-2 font-display text-4xl font-bold">Thank you, {record.donor.name}.</h1><p className="mt-4 max-w-3xl text-lg leading-8 text-blue-100">Your browser has created a packing slip and a pending acknowledgment preview. Print the mailing label, purchase postage from your chosen carrier, and include the packing slip in your package.</p><button onClick={copyId} className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-2.5 font-bold"><Copy className="h-4 w-4" />{copied ? 'Copied' : record.id}</button></div>
    <div className="mt-8 grid gap-5 md:grid-cols-2"><button className="action-card" onClick={() => setDocument('packing')}><FileText className="h-7 w-7 text-[#174f8c]" /><strong>Print mailing label and packing slip</strong><span>Attach the addressed label outside and place the packing slip inside.</span></button><button className="action-card" onClick={() => setDocument('acknowledgment')}><ShieldCheck className="h-7 w-7 text-[#174f8c]" /><strong>Preview acknowledgment</strong><span>See the format issued after receipt and verification.</span></button></div>
    <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm leading-7 text-[#7f1d2d]"><LockKeyhole className="mb-2 h-5 w-5" /><strong>Your acknowledgment is not final yet.</strong> The official document must show the actual receipt date and be authorized after Donate by Mail receives the phones. The estimate is intentionally excluded.</div>
    <button className="button-secondary mt-8" onClick={onStartOver}>Start another donation</button>
    {document && <PrintDocument record={record} kind={document} onClose={() => setDocument(null)} />}
  </div>;
}
