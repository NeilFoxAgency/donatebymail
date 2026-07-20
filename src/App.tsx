import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Copy,
  FileCheck2,
  FileText,
  HeartHandshake,
  Info,
  Leaf,
  LockKeyhole,
  Mail,
  MapPin,
  Menu,
  PackageCheck,
  Plus,
  Printer,
  Recycle,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';

type Brand = 'Apple' | 'Samsung' | 'Google' | 'Motorola' | 'Other';
type Age = '0-1 year' | '2-3 years' | '4-5 years' | '6+ years';
type Condition = 'Excellent' | 'Good' | 'Fair' | 'Damaged';
type Storage = '64 GB or less' | '128 GB' | '256 GB' | '512 GB+';
type ShippingMethod = 'label' | 'kit';
type DocumentType = 'packing-slip' | 'receipt';

type Device = {
  id: string;
  brand: Brand;
  model: string;
  age: Age;
  condition: Condition;
  storage: Storage;
  powersOn: boolean;
  unlocked: boolean;
};

type DonorDetails = {
  name: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
};

type DonationRecord = {
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

const baseValues: Record<Brand, Record<Age, number>> = {
  Apple: { '0-1 year': 430, '2-3 years': 250, '4-5 years': 110, '6+ years': 35 },
  Samsung: { '0-1 year': 320, '2-3 years': 180, '4-5 years': 75, '6+ years': 25 },
  Google: { '0-1 year': 260, '2-3 years': 150, '4-5 years': 65, '6+ years': 22 },
  Motorola: { '0-1 year': 145, '2-3 years': 80, '4-5 years': 35, '6+ years': 12 },
  Other: { '0-1 year': 105, '2-3 years': 55, '4-5 years': 22, '6+ years': 8 },
};

const conditionFactor: Record<Condition, number> = {
  Excellent: 1,
  Good: 0.78,
  Fair: 0.48,
  Damaged: 0.18,
};

const storageFactor: Record<Storage, number> = {
  '64 GB or less': 0.9,
  '128 GB': 1,
  '256 GB': 1.12,
  '512 GB+': 1.25,
};

const blankDonor: DonorDetails = {
  name: '',
  email: '',
  address1: '',
  address2: '',
  city: '',
  state: 'FL',
  zip: '',
};

const makeDevice = (id: string): Device => ({
  id,
  brand: 'Apple',
  model: '',
  age: '2-3 years',
  condition: 'Good',
  storage: '128 GB',
  powersOn: true,
  unlocked: true,
});

const estimate = (device: Device) => {
  const midpoint =
    baseValues[device.brand][device.age] *
    conditionFactor[device.condition] *
    storageFactor[device.storage] *
    (device.powersOn ? 1 : 0.38) *
    (device.unlocked ? 1.08 : 0.92);

  return {
    low: Math.max(1, Math.round(midpoint * 0.82)),
    high: Math.max(2, Math.round(midpoint * 1.17)),
  };
};

const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

const createDonationId = () => {
  const date = new Date();
  const datePart = date.toISOString().slice(0, 10).replaceAll('-', '');
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `DBM-${datePart}-${randomPart}`;
};

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
      <span className="relative block">
        <select
          className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm font-medium outline-none transition focus:border-blue-700 focus:ring-4 focus:ring-blue-100"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-500" />
      </span>
    </label>
  );
}

function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`relative grid place-items-center overflow-hidden rounded-2xl bg-white shadow-lg ${compact ? 'h-10 w-10' : 'h-12 w-12'}`}>
      <span className="absolute inset-x-0 top-0 h-1/2 bg-[#174f8c]" />
      <span className="absolute inset-x-0 bottom-0 h-1/2 bg-[#c9273d]" />
      <Mail className={`relative z-10 text-white ${compact ? 'h-5 w-5' : 'h-6 w-6'}`} />
    </span>
  );
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [devices, setDevices] = useState<Device[]>([makeDevice('phone-1')]);
  const [donor, setDonor] = useState<DonorDetails>(blankDonor);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>('label');
  const [record, setRecord] = useState<DonationRecord | null>(null);
  const [activeDocument, setActiveDocument] = useState<DocumentType>('packing-slip');
  const [copied, setCopied] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    const cleanup = () => document.body.removeAttribute('data-print-target');
    window.addEventListener('afterprint', cleanup);
    return () => window.removeEventListener('afterprint', cleanup);
  }, []);

  const totals = useMemo(
    () =>
      devices.reduce(
        (sum, device) => {
          const value = estimate(device);
          return { low: sum.low + value.low, high: sum.high + value.high };
        },
        { low: 0, high: 0 },
      ),
    [devices],
  );

  const updateDevice = <K extends keyof Device>(id: string, key: K, value: Device[K]) => {
    setDevices((current) =>
      current.map((device) => (device.id === id ? { ...device, [key]: value } : device)),
    );
    setRecord(null);
  };

  const updateDonor = (key: keyof DonorDetails, value: string) => {
    setDonor((current) => ({ ...current, [key]: value }));
    setRecord(null);
  };

  const addDevice = () => {
    setDevices((current) => [...current, makeDevice(`phone-${Date.now()}`)]);
    setRecord(null);
  };

  const removeDevice = (id: string) => {
    setDevices((current) => current.filter((device) => device.id !== id));
    setRecord(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextRecord: DonationRecord = {
      id: createDonationId(),
      createdAt: new Date().toISOString(),
      donor: { ...donor },
      shippingMethod,
      devices: devices.map((device) => ({ ...device })),
    };
    setRecord(nextRecord);
    setActiveDocument('packing-slip');
    setTimeout(() => {
      document.getElementById('document-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 20);
  };

  const saveDraft = () => {
    localStorage.setItem('donate-by-mail-draft', JSON.stringify({ devices, donor, shippingMethod }));
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 1800);
  };

  const loadDraft = () => {
    const saved = localStorage.getItem('donate-by-mail-draft');
    if (!saved) return;
    try {
      const draft = JSON.parse(saved) as {
        devices?: Device[];
        donor?: DonorDetails;
        shippingMethod?: ShippingMethod;
      };
      if (draft.devices?.length) setDevices(draft.devices);
      if (draft.donor) setDonor(draft.donor);
      if (draft.shippingMethod) setShippingMethod(draft.shippingMethod);
      setRecord(null);
    } catch {
      localStorage.removeItem('donate-by-mail-draft');
    }
  };

  const printDocument = (target: DocumentType) => {
    setActiveDocument(target);
    document.body.setAttribute('data-print-target', target);
    setTimeout(() => window.print(), 40);
  };

  const copyDonationId = async () => {
    if (!record) return;
    await navigator.clipboard.writeText(record.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const deviceDescription = (device: Device, index: number) => {
    const model = device.model.trim() ? ` ${device.model.trim()}` : '';
    return `${index + 1}. ${device.brand}${model} smartphone, approximately ${device.age} old, ${device.condition.toLowerCase()} condition, ${device.storage}, ${device.powersOn ? 'powers on' : 'does not power on'}, ${device.unlocked ? 'reported unlocked' : 'carrier lock unknown or active'}`;
  };

  const formattedAddress = record
    ? [
        record.donor.address1,
        record.donor.address2,
        `${record.donor.city}, ${record.donor.state} ${record.donor.zip}`,
      ].filter(Boolean)
    : [];

  const createdDate = record
    ? new Date(record.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <div className="min-h-screen bg-[#f7f9fc] font-sans text-slate-900">
      <div className="h-1.5 bg-gradient-to-r from-[#c9273d] via-white to-[#174f8c]" />
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <a href="#top" className="flex items-center gap-3">
            <LogoMark compact />
            <span>
              <span className="block font-display text-xl font-bold leading-none text-[#102d4f]">Donate by Mail</span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.22em] text-[#c9273d]">Old phones. New possibilities.</span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-700 md:flex">
            <a className="transition hover:text-[#174f8c]" href="#how">How it works</a>
            <a className="transition hover:text-[#174f8c]" href="#estimate">Estimate value</a>
            <a className="transition hover:text-[#174f8c]" href="#security">Data security</a>
            <a className="rounded-full bg-[#c9273d] px-5 py-2.5 text-white shadow-lg shadow-red-900/10 transition hover:-translate-y-0.5" href="#donate">Donate a phone</a>
          </nav>
          <button
            className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white md:hidden"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <nav className="grid gap-1 border-t border-slate-200 bg-white px-5 py-4 md:hidden">
            {[
              ['How it works', '#how'],
              ['Estimate value', '#estimate'],
              ['Data security', '#security'],
              ['Donate a phone', '#donate'],
            ].map(([label, href]) => (
              <a
                className="rounded-xl px-3 py-3 font-semibold hover:bg-blue-50"
                href={href}
                key={href}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <main id="top">
        <section className="relative overflow-hidden bg-[#102d4f] text-white">
          <div className="hero-grid absolute inset-0 opacity-30" />
          <div className="absolute -left-32 bottom-[-12rem] h-96 w-96 rounded-full bg-[#c9273d]/40 blur-3xl" />
          <div className="absolute -right-24 top-[-8rem] h-80 w-80 rounded-full bg-[#2973ba]/45 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 md:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-32">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em]">
                <HeartHandshake className="h-4 w-4 text-red-300" />
                A simpler way to give
              </div>
              <h1 className="max-w-3xl font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
                Put your old phone to work for a <span className="text-red-300">good cause.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-blue-50/90 sm:text-xl">
                Estimate its potential value, prepare a prepaid mail-in donation, and create the documents you need in one clear, secure flow.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href="#estimate" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#c9273d] px-6 py-3.5 font-bold text-white shadow-xl transition hover:-translate-y-0.5">
                  Estimate my phone <ArrowRight className="h-4 w-4" />
                </a>
                <a href="#how" className="inline-flex items-center justify-center rounded-full border border-white/35 bg-white/10 px-6 py-3.5 font-bold">
                  See how it works
                </a>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-blue-50/90">
                {['Prepaid shipping', 'Secure data preparation', 'Printable documents'].map((item) => (
                  <span className="flex items-center gap-2" key={item}>
                    <Check className="h-4 w-4 text-red-300" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-md">
              <div className="absolute -left-8 -top-8 h-28 w-28 rounded-full bg-red-400/30 blur-2xl" />
              <div className="relative rotate-2 rounded-[2.5rem] border border-white/20 bg-white p-4 shadow-2xl">
                <div className="rounded-[2rem] bg-[#eef4fa] p-7 text-slate-900">
                  <div className="flex items-center justify-between">
                    <LogoMark />
                    <span className="rounded-full bg-[#174f8c] px-3 py-1 text-xs font-bold text-white">READY TO GIVE</span>
                  </div>
                  <p className="mt-12 text-sm font-bold uppercase tracking-[0.16em] text-[#174f8c]">One donated phone can become</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <Leaf className="h-5 w-5 text-[#174f8c]" />
                      <p className="mt-6 font-display text-3xl font-bold text-[#102d4f]">Less</p>
                      <p className="text-sm text-slate-500">e-waste</p>
                    </div>
                    <div className="rounded-2xl bg-[#c9273d] p-4 text-white">
                      <HeartHandshake className="h-5 w-5" />
                      <p className="mt-6 font-display text-3xl font-bold">More</p>
                      <p className="text-sm text-red-100">impact</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-2xl bg-[#102d4f] p-4 text-white">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-200">Donation packet</p>
                    <div className="mt-3 flex items-center justify-between text-sm"><span>Packing slip</span><CheckCircle2 className="h-4 w-4 text-red-300" /></div>
                    <div className="mt-2 flex items-center justify-between text-sm"><span>Receipt preview</span><CheckCircle2 className="h-4 w-4 text-red-300" /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="px-5 py-20 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#c9273d]">Four clear steps</p>
              <h2 className="mt-3 font-display text-4xl font-bold text-[#102d4f] sm:text-5xl">From forgotten drawer to meaningful funding.</h2>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {[
                [Smartphone, '1', 'Describe your phones', 'Add one or several devices and tell us their basic condition.'],
                [FileText, '2', 'See an estimate', 'Get a rough resale range before you decide to continue.'],
                [PackageCheck, '3', 'Prepare the shipment', 'Choose a printable prepaid label or request a mail-in kit.'],
                [FileCheck2, '4', 'Create your documents', 'Print a packing slip now and preview the acknowledgment issued after receipt.'],
              ].map(([Icon, number, title, copy]) => {
                const StepIcon = Icon as typeof Smartphone;
                return (
                  <article className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-soft" key={String(number)}>
                    <div className="flex items-center justify-between">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-[#174f8c]">
                        <StepIcon className="h-6 w-6" />
                      </span>
                      <span className="font-display text-5xl font-bold text-[#c9273d]/10">{number}</span>
                    </div>
                    <h3 className="mt-7 font-display text-xl font-bold text-[#102d4f]">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{copy}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="estimate" className="bg-[#102d4f] px-5 py-20 text-white lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.72fr_1.28fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-red-300">Instant estimate</p>
              <h2 className="mt-3 font-display text-4xl font-bold sm:text-5xl">What could your phones be worth?</h2>
              <p className="mt-5 leading-8 text-blue-100/80">
                Add as many phones as you plan to send. The estimate updates instantly as you describe each device.
              </p>
              <div className="mt-8 rounded-2xl border border-red-200/25 bg-red-300/10 p-5 text-sm leading-6 text-red-50">
                <Info className="mb-3 h-5 w-5 text-red-300" />
                <strong>Not a tax appraisal.</strong> The estimate is a planning tool only. Donate by Mail will not place an estimated dollar value on the official acknowledgment.
              </div>
              <div className="mt-6 rounded-[2rem] bg-white p-6 text-[#102d4f] shadow-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#c9273d]">Estimated combined value</p>
                <p className="mt-2 font-display text-4xl font-bold">{money(totals.low)}-{money(totals.high)}</p>
                <p className="mt-2 text-sm text-slate-500">Illustrative range before inspection and resale expenses.</p>
                <a href="#donate" className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#c9273d] px-5 py-3 font-bold text-white">
                  Continue <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>

            <div>
              <div className="space-y-5">
                {devices.map((device, index) => {
                  const value = estimate(device);
                  return (
                    <article className="rounded-[2rem] bg-white p-5 text-slate-900 shadow-2xl sm:p-7" key={device.id}>
                      <div className="mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#c9273d] font-display text-lg font-bold text-white">{index + 1}</span>
                          <h3 className="font-display text-xl font-bold text-[#102d4f]">Phone {index + 1}</h3>
                        </div>
                        {devices.length > 1 && (
                          <button className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => removeDevice(device.id)} aria-label={`Remove phone ${index + 1}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <SelectField label="Brand" value={device.brand} options={brands} onChange={(value) => updateDevice(device.id, 'brand', value as Brand)} />
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">Model, if known</span>
                          <input
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-700 focus:ring-4 focus:ring-blue-100"
                            value={device.model}
                            onChange={(event) => updateDevice(device.id, 'model', event.target.value)}
                            placeholder="Example: iPhone 13"
                          />
                        </label>
                        <SelectField label="Approximate age" value={device.age} options={ages} onChange={(value) => updateDevice(device.id, 'age', value as Age)} />
                        <SelectField label="Condition" value={device.condition} options={conditions} onChange={(value) => updateDevice(device.id, 'condition', value as Condition)} />
                        <SelectField label="Storage" value={device.storage} options={storageOptions} onChange={(value) => updateDevice(device.id, 'storage', value as Storage)} />
                        <div className="grid gap-3">
                          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <span className="text-sm font-semibold">Powers on</span>
                            <input className="h-5 w-5 accent-[#174f8c]" type="checkbox" checked={device.powersOn} onChange={(event) => updateDevice(device.id, 'powersOn', event.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <span className="text-sm font-semibold">Carrier unlocked</span>
                            <input className="h-5 w-5 accent-[#174f8c]" type="checkbox" checked={device.unlocked} onChange={(event) => updateDevice(device.id, 'unlocked', event.target.checked)} />
                          </label>
                        </div>
                      </div>
                      <div className="mt-6 flex flex-col gap-2 rounded-2xl bg-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm font-bold text-[#174f8c]">Estimated device value</span>
                        <span className="font-display text-2xl font-bold text-[#102d4f]">{money(value.low)}-{money(value.high)}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
              <button onClick={addDevice} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-300/70 bg-white/5 px-5 py-4 font-bold hover:bg-white/10">
                <Plus className="h-4 w-4" /> Add another phone
              </button>
            </div>
          </div>
        </section>

        <section id="security" className="px-5 py-20 lg:px-8">
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
            <div className="relative overflow-hidden rounded-[2.5rem] bg-[#174f8c] p-8 text-white sm:p-12">
              <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-[#c9273d]/35 blur-3xl" />
              <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-white text-[#174f8c]">
                <LockKeyhole className="h-8 w-8" />
              </span>
              <h2 className="relative mt-8 font-display text-4xl font-bold">Prepare your data before the phone leaves your hands.</h2>
              <p className="relative mt-5 leading-8 text-blue-50/90">
                The safest donation starts with a backup, account sign-out, activation-lock removal, SIM removal, and factory reset whenever possible.
              </p>
            </div>
            <div className="space-y-4">
              {[
                ['Back up your photos and files', 'Save anything you want to keep before resetting the device.'],
                ['Sign out and remove activation locks', 'Remove the device from Find My iPhone or your Google account.'],
                ['Factory reset and remove SIM cards', 'Never include passwords, PINs, passcodes, or account credentials.'],
                ['Secure processing after arrival', 'Production operations will include documented chain-of-custody and verified wiping procedures.'],
              ].map(([title, copy], index) => (
                <div className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={title}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-50 font-bold text-[#c9273d]">{index + 1}</span>
                  <div>
                    <h3 className="font-bold text-[#102d4f]">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="donate" className="bg-[#eaf0f7] px-5 py-20 lg:px-8">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#c9273d]">Create your donation packet</p>
              <h2 className="mt-3 font-display text-4xl font-bold text-[#102d4f] sm:text-5xl">Tell us where to send your mailing materials.</h2>
              <p className="mt-5 leading-8 text-slate-600">
                Complete the donor record once. We use it to prepare the packing slip and format the acknowledgment preview.
              </p>
              <div className="mt-8 space-y-3">
                {[
                  'Printable packing slip with a unique donation ID',
                  'Choice of prepaid label or mailed kit',
                  'Separate post-receipt acknowledgment preview',
                  'Browser-only draft saving in this prototype',
                ].map((item) => (
                  <p className="flex items-center gap-3 font-semibold text-slate-700" key={item}>
                    <ShieldCheck className="h-5 w-5 text-[#174f8c]" /> {item}
                  </p>
                ))}
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <button type="button" onClick={saveDraft} className="rounded-full border border-[#174f8c] bg-white px-5 py-2.5 text-sm font-bold text-[#174f8c]">
                  {draftSaved ? 'Draft saved' : 'Save draft in this browser'}
                </button>
                <button type="button" onClick={loadDraft} className="rounded-full px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-white">
                  Restore saved draft
                </button>
              </div>
            </div>

            <div className="rounded-[2rem] bg-white p-6 shadow-soft sm:p-9">
              <form onSubmit={submit}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-2 block text-sm font-semibold">Full name</span>
                    <input required autoComplete="name" className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-100" value={donor.name} onChange={(event) => updateDonor('name', event.target.value)} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-2 block text-sm font-semibold">Email</span>
                    <input required type="email" autoComplete="email" className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-100" value={donor.email} onChange={(event) => updateDonor('email', event.target.value)} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-2 block text-sm font-semibold">Street address</span>
                    <input required autoComplete="address-line1" className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-100" value={donor.address1} onChange={(event) => updateDonor('address1', event.target.value)} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-2 block text-sm font-semibold">Apartment, suite, or unit <span className="font-normal text-slate-400">optional</span></span>
                    <input autoComplete="address-line2" className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-100" value={donor.address2} onChange={(event) => updateDonor('address2', event.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold">City</span>
                    <input required autoComplete="address-level2" className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-100" value={donor.city} onChange={(event) => updateDonor('city', event.target.value)} />
                  </label>
                  <SelectField label="State" value={donor.state} options={states} onChange={(value) => updateDonor('state', value)} />
                  <label className="block sm:col-span-2">
                    <span className="mb-2 block text-sm font-semibold">ZIP code</span>
                    <input required inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{5}(-[0-9]{4})?" className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-700 focus:ring-4 focus:ring-blue-100" value={donor.zip} onChange={(event) => updateDonor('zip', event.target.value)} placeholder="12345" />
                  </label>
                </div>

                <fieldset className="mt-7">
                  <legend className="text-sm font-semibold">How would you like to mail?</legend>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={`cursor-pointer rounded-2xl border p-4 transition ${shippingMethod === 'label' ? 'border-[#174f8c] bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                      <input className="sr-only" type="radio" checked={shippingMethod === 'label'} onChange={() => { setShippingMethod('label'); setRecord(null); }} />
                      <Printer className="h-5 w-5 text-[#174f8c]" />
                      <span className="mt-3 block font-bold">Printable prepaid label</span>
                      <span className="mt-1 block text-sm text-slate-500">Fastest. Use your own sturdy box.</span>
                    </label>
                    <label className={`cursor-pointer rounded-2xl border p-4 transition ${shippingMethod === 'kit' ? 'border-[#174f8c] bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                      <input className="sr-only" type="radio" checked={shippingMethod === 'kit'} onChange={() => { setShippingMethod('kit'); setRecord(null); }} />
                      <Mail className="h-5 w-5 text-[#174f8c]" />
                      <span className="mt-3 block font-bold">Mail-in kit</span>
                      <span className="mt-1 block text-sm text-slate-500">Packaging and instructions are mailed to you.</span>
                    </label>
                  </div>
                </fieldset>

                <label className="mt-7 flex items-start gap-3 rounded-2xl bg-slate-100 p-4">
                  <input required className="mt-1 h-5 w-5 shrink-0 accent-[#174f8c]" type="checkbox" />
                  <span className="text-sm leading-6 text-slate-700">
                    I understand that I should back up my data, sign out of accounts, remove activation locks, remove SIM cards, and factory reset each phone when possible. I will not include passwords or passcodes.
                  </span>
                </label>

                <button type="submit" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#c9273d] px-6 py-4 font-bold text-white shadow-lg shadow-red-900/10">
                  Create my donation packet <ArrowRight className="h-4 w-4" />
                </button>
                <p className="mt-3 text-center text-xs text-slate-500">Prototype only. Personal information remains in this browser and is not transmitted.</p>
              </form>
            </div>
          </div>
        </section>

        {record && (
          <section id="document-center" className="scroll-mt-24 bg-white px-5 py-20 lg:px-8">
            <div className="mx-auto max-w-6xl">
              <div className="rounded-[2rem] bg-[#102d4f] p-6 text-white sm:p-8">
                <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
                  <div className="flex gap-4">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-[#174f8c]"><CheckCircle2 className="h-7 w-7" /></span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-300">Donation packet created</p>
                      <h2 className="mt-1 font-display text-3xl font-bold">Your documents are ready.</h2>
                      <p className="mt-2 text-sm text-blue-100">Donation ID: <strong>{record.id}</strong></p>
                    </div>
                  </div>
                  <button onClick={copyDonationId} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-3 font-bold">
                    <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy donation ID'}
                  </button>
                </div>
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-[0.34fr_0.66fr]">
                <aside className="no-print space-y-3">
                  <button onClick={() => setActiveDocument('packing-slip')} className={`w-full rounded-2xl border p-5 text-left transition ${activeDocument === 'packing-slip' ? 'border-[#174f8c] bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-blue-300'}`}>
                    <span className="flex items-center gap-3 font-bold text-[#102d4f]"><ClipboardCheck className="h-5 w-5 text-[#174f8c]" /> Packing slip</span>
                    <span className="mt-2 block text-sm leading-6 text-slate-500">Print this now and place it inside the package.</span>
                  </button>
                  <button onClick={() => setActiveDocument('receipt')} className={`w-full rounded-2xl border p-5 text-left transition ${activeDocument === 'receipt' ? 'border-[#c9273d] bg-red-50 ring-2 ring-red-100' : 'border-slate-200 bg-white hover:border-red-300'}`}>
                    <span className="flex items-center gap-3 font-bold text-[#102d4f]"><FileCheck2 className="h-5 w-5 text-[#c9273d]" /> Acknowledgment preview</span>
                    <span className="mt-2 block text-sm leading-6 text-slate-500">Shows the receipt format issued after physical receipt is verified.</span>
                  </button>
                  <div className="rounded-2xl bg-slate-100 p-5 text-sm leading-6 text-slate-600">
                    <Info className="mb-3 h-5 w-5 text-[#174f8c]" />
                    Use your browser print dialog to print or save either document as a PDF.
                  </div>
                </aside>

                <div className="rounded-[2rem] bg-[#eef2f7] p-3 sm:p-5">
                  {activeDocument === 'packing-slip' ? (
                    <div>
                      <div className="no-print mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div><p className="font-bold text-[#102d4f]">Packing slip</p><p className="text-sm text-slate-500">Include one copy inside your shipment.</p></div>
                        <button onClick={() => printDocument('packing-slip')} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#174f8c] px-5 py-2.5 font-bold text-white"><Printer className="h-4 w-4" /> Print packing slip</button>
                      </div>
                      <article id="packing-slip" className="print-document bg-white p-7 shadow-sm sm:p-10">
                        <div className="document-stripe" />
                        <div className="flex flex-col justify-between gap-8 border-b-2 border-[#102d4f] pb-7 sm:flex-row">
                          <div className="flex items-center gap-4"><LogoMark /><div><h3 className="font-display text-3xl font-bold text-[#102d4f]">Donate by Mail</h3><p className="mt-1 text-sm font-semibold text-slate-500">Donation packing slip</p></div></div>
                          <div className="sm:text-right"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Donation ID</p><p className="mt-1 font-mono text-lg font-bold text-[#102d4f]">{record.id}</p><p className="mt-1 text-sm text-slate-500">Created {createdDate}</p></div>
                        </div>
                        <div className="grid gap-7 py-8 sm:grid-cols-2">
                          <div><p className="document-label"><MapPin className="h-4 w-4" /> Donor</p><p className="mt-3 font-bold text-[#102d4f]">{record.donor.name}</p>{formattedAddress.map((line) => <p className="mt-1 text-sm text-slate-600" key={line}>{line}</p>)}<p className="mt-1 text-sm text-slate-600">{record.donor.email}</p></div>
                          <div><p className="document-label"><Mail className="h-4 w-4" /> Mailing plan</p><p className="mt-3 font-bold text-[#102d4f]">{record.shippingMethod === 'label' ? 'Printable prepaid label' : 'Mail-in kit requested'}</p><p className="mt-2 text-sm leading-6 text-slate-600">Keep this donation ID with the package so the phones can be matched to the donor record after arrival.</p></div>
                        </div>
                        <div className="border-t border-slate-200 pt-7"><p className="document-label"><Smartphone className="h-4 w-4" /> Devices enclosed</p><div className="mt-4 space-y-3">{record.devices.map((device, index) => <div className="rounded-xl border border-slate-200 p-4 text-sm leading-6" key={device.id}>{deviceDescription(device, index)}</div>)}</div></div>
                        <div className="mt-8 grid gap-4 sm:grid-cols-2"><div className="rounded-xl bg-blue-50 p-5"><p className="font-bold text-[#174f8c]">Before sealing the box</p><ul className="mt-3 space-y-2 text-sm text-slate-700"><li>□ Remove SIM and memory cards</li><li>□ Turn off activation locks</li><li>□ Factory reset when possible</li><li>□ Do not include passcodes</li></ul></div><div className="rounded-xl bg-red-50 p-5"><p className="font-bold text-[#c9273d]">For Donate by Mail staff</p><ul className="mt-3 space-y-2 text-sm text-slate-700"><li>□ Confirm package contents</li><li>□ Record arrival date</li><li>□ Begin secure processing</li><li>□ Issue acknowledgment</li></ul></div></div>
                        <p className="mt-7 border-t pt-5 text-xs leading-5 text-slate-500">This packing slip is not a charitable contribution acknowledgment and does not establish a tax deduction.</p>
                      </article>
                    </div>
                  ) : (
                    <div>
                      <div className="no-print mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div><p className="font-bold text-[#102d4f]">Acknowledgment preview</p><p className="text-sm text-slate-500">A production copy is issued only after verified receipt.</p></div>
                        <button onClick={() => printDocument('receipt')} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#c9273d] px-5 py-2.5 font-bold text-white"><Printer className="h-4 w-4" /> Print receipt preview</button>
                      </div>
                      <article id="receipt" className="print-document receipt bg-white p-7 shadow-sm sm:p-10">
                        <div className="document-stripe" />
                        <div className="pending-watermark">PENDING</div>
                        <div className="relative z-10">
                          <div className="flex flex-col justify-between gap-8 border-b-2 border-[#102d4f] pb-7 sm:flex-row">
                            <div className="flex items-center gap-4"><LogoMark /><div><h3 className="font-display text-3xl font-bold text-[#102d4f]">Donate by Mail</h3><p className="mt-1 text-sm font-semibold text-slate-500">501(c)(3) nonprofit - EIN 92-1515120</p></div></div>
                            <div className="sm:text-right"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Acknowledgment ID</p><p className="mt-1 font-mono text-lg font-bold text-[#102d4f]">{record.id}</p></div>
                          </div>
                          <div className="py-8">
                            <span className="inline-flex rounded-full bg-red-100 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#9f1f31]">Pending receipt confirmation - preview only</span>
                            <h4 className="mt-6 font-display text-3xl font-bold text-[#102d4f]">Noncash charitable contribution acknowledgment</h4>
                            <p className="mt-6 leading-7 text-slate-700">Thank you, <strong>{record.donor.name}</strong>. This preview shows the acknowledgment format Donate by Mail will issue after the donated property is physically received and verified.</p>
                            <dl className="mt-8 grid gap-5 rounded-2xl border border-slate-200 p-6 sm:grid-cols-2">
                              <div><dt className="document-label"><Calendar className="h-4 w-4" /> Contribution date</dt><dd className="mt-2 font-semibold text-[#102d4f]">To be completed after verified receipt</dd></div>
                              <div><dt className="document-label"><FileText className="h-4 w-4" /> Donation ID</dt><dd className="mt-2 font-mono font-semibold text-[#102d4f]">{record.id}</dd></div>
                              <div className="sm:col-span-2"><dt className="document-label"><MapPin className="h-4 w-4" /> Donor</dt><dd className="mt-2 font-semibold text-[#102d4f]">{record.donor.name}</dd>{formattedAddress.map((line) => <dd className="mt-1 text-sm text-slate-600" key={line}>{line}</dd>)}</div>
                              <div className="sm:col-span-2"><dt className="document-label"><Smartphone className="h-4 w-4" /> Property received</dt><dd className="mt-3 space-y-2 text-sm leading-6 text-slate-700">{record.devices.map((device, index) => <p key={device.id}>{deviceDescription(device, index)}</p>)}</dd></div>
                            </dl>
                            <div className="mt-8 rounded-2xl bg-blue-50 p-6 text-sm leading-7 text-[#102d4f]"><strong>No goods or services were provided by Donate by Mail in exchange for this contribution.</strong></div>
                            <p className="mt-8 text-sm leading-7 text-slate-600">Donate by Mail has not provided or confirmed a fair market value for the donated property. The donor is responsible for determining and substantiating any charitable deduction.</p>
                          </div>
                          <div className="border-t pt-6 text-xs leading-5 text-slate-500">Preview generated {createdDate}. This document is not valid until Donate by Mail records the physical receipt date and issues the final acknowledgment.</div>
                        </div>
                      </article>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="bg-[#c9273d] px-5 py-16 text-white lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-7 text-center md:flex-row md:text-left">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-red-100">One drawer. One box. One good decision.</p>
              <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Give that old phone somewhere better to be.</h2>
            </div>
            <a href="#estimate" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-7 py-4 font-bold text-[#102d4f]">Start an estimate <Recycle className="h-4 w-4" /></a>
          </div>
        </section>
      </main>

      <footer className="bg-[#102d4f] px-5 py-12 text-blue-50 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="flex items-center gap-3"><LogoMark compact /><span className="font-display text-xl font-bold">Donate by Mail</span></div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-blue-100/70">Turning unused phones into funding for meaningful causes through a simple, secure mail-in experience.</p>
          </div>
          <div className="text-sm text-blue-100/60 md:text-right"><p>© 2026 Donate by Mail</p><p className="mt-2">Prototype website - Privacy, terms, and live shipping integrations to be added before launch</p></div>
        </div>
      </footer>
    </div>
  );
}

export default App;
