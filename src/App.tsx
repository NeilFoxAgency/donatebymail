import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileCheck2,
  HelpCircle,
  Mail,
  Menu,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import {
  getPledgeWidgetConfig,
  mergeCharityDetails,
  parsePledgeMessage,
  pledgeSelectionReducer,
  type PledgeEnvironment,
  type SelectedCharity,
} from './pledge';
import {
  charityLocation,
  describeDevice,
  type Age,
  type Brand,
  type Condition,
  type Device,
  type DonationSubmission,
  type DonorDetails,
  type ShippingMethod,
  type Storage,
} from './submission';

type DocumentType = 'packing' | 'acknowledgment';

type SubmissionResponse = {
  ok: boolean;
  message?: string;
  charity?: SelectedCharity;
};

const brands: Brand[] = ['Apple', 'Samsung', 'Google', 'Motorola', 'Other'];
const ages: Age[] = ['0-1 year', '2-3 years', '4-5 years', '6+ years'];
const conditions: Condition[] = ['Excellent', 'Good', 'Fair', 'Damaged'];
const storageOptions: Storage[] = ['64 GB or less', '128 GB', '256 GB', '512 GB+'];
const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

const baseValues: Record<Brand, Record<Age, number>> = {
  Apple: {'0-1 year':430,'2-3 years':250,'4-5 years':110,'6+ years':35},
  Samsung: {'0-1 year':320,'2-3 years':180,'4-5 years':75,'6+ years':25},
  Google: {'0-1 year':260,'2-3 years':150,'4-5 years':65,'6+ years':22},
  Motorola: {'0-1 year':145,'2-3 years':80,'4-5 years':35,'6+ years':12},
  Other: {'0-1 year':105,'2-3 years':55,'4-5 years':22,'6+ years':8},
};
const conditionFactor: Record<Condition, number> = {Excellent:1,Good:.78,Fair:.48,Damaged:.18};
const storageFactor: Record<Storage, number> = {'64 GB or less':.9,'128 GB':1,'256 GB':1.12,'512 GB+':1.25};

const blankDonor: DonorDetails = {name:'',email:'',address1:'',address2:'',city:'',state:'FL',zip:''};
const makeDevice = (id: string): Device => ({id,brand:'Apple',model:'',age:'2-3 years',condition:'Good',storage:'128 GB',powersOn:true,unlocked:true});
const estimate = (device: Device) => {
  const midpoint = baseValues[device.brand][device.age] * conditionFactor[device.condition] * storageFactor[device.storage] * (device.powersOn ? 1 : .38) * (device.unlocked ? 1.08 : .92);
  return {low:Math.max(1,Math.round(midpoint*.82)),high:Math.max(2,Math.round(midpoint*1.17))};
};
const money = (value: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const donationId = () => `DBM-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;

function getPartnerKey(): string {
  const envKey = import.meta.env.VITE_PLEDGE_PARTNER_KEY?.trim();
  if (envKey) return envKey;
  return document.querySelector<HTMLMetaElement>('meta[name="pledge-partner-key"]')?.content.trim() || '';
}

function getPledgeEnvironment(): PledgeEnvironment {
  return import.meta.env.VITE_PLEDGE_ENV === 'sandbox' ? 'sandbox' : 'production';
}

function resetPledgeScript(): void {
  document.querySelectorAll('script[data-dbm-pledge-script]').forEach((script) => script.remove());
}

function loadPledgeScript(scriptUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-dbm-pledge-script="${scriptUrl}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Pledge widget failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.src = scriptUrl;
    script.dataset.dbmPledgeScript = scriptUrl;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Pledge widget failed to load')), { once: true });
    document.head.appendChild(script);
  });
}

async function fetchCharityDetails(charity: SelectedCharity): Promise<SelectedCharity> {
  try {
    const response = await fetch(`./api/pledge/organizations/${encodeURIComponent(charity.pledgeId)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return charity;
    const body = await response.json() as { charity?: Partial<SelectedCharity> };
    return body.charity ? mergeCharityDetails(charity, body.charity) : charity;
  } catch {
    return charity;
  }
}

async function sendDonation(record: DonationSubmission): Promise<SubmissionResponse> {
  const response = await fetch('./api/donations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(record),
  });
  const body = await response.json().catch(() => ({})) as SubmissionResponse;
  if (!response.ok) throw new Error(body.message || 'We could not send the donation packet. Please try again.');
  return body;
}

function Logo() {
  return <a className="brand" href="./"><span className="brand-icon"><Mail aria-hidden="true" /></span><span><strong>Donate by Mail</strong><small>Old phones. New possibilities.</small></span></a>;
}

function Header({simple = false}: {simple?: boolean}) {
  const [open,setOpen] = useState(false);
  const links = simple
    ? [['Home','./'],['How it works','./how-it-works.html'],['Prepare your phone','./prepare-phone.html'],['Help','./resources.html']]
    : [['Donate a phone','./donate-phone.html'],['How it works','./how-it-works.html'],['For nonprofits','./for-nonprofits.html'],['About','./about.html'],['Help','./resources.html']];
  return <>
    <div className="charity-bar">Donate by Mail is a U.S. 501(c)(3) public charity</div>
    <header className="site-header"><div className="header-inner"><Logo />
      <nav className="desktop-nav" aria-label="Primary navigation">{links.map(([label,href],index)=><a className={index===0&&!simple?'nav-primary':''} href={href} key={href}>{label}</a>)}</nav>
      <button className="menu-button" onClick={()=>setOpen(v=>!v)} aria-label={open?'Close menu':'Open menu'}>{open?<X/>:<Menu/>}</button>
    </div>{open&&<nav className="mobile-nav" aria-label="Mobile navigation">{links.map(([label,href])=><a href={href} key={href}>{label}</a>)}</nav>}</header>
  </>;
}

function Footer() {
  return <footer className="site-footer"><div className="footer-inner"><div><Logo /><p>Turning unused phones into funding for meaningful causes through a clear mail-in process.</p></div><div><h2>Get started</h2><a href="./donate-phone.html">Donate a phone</a><a href="./prepare-phone.html">Prepare your phone</a><a href="./receipts.html">Receipts and documents</a></div><div><h2>Organization</h2><a href="./about.html">About us</a><a href="./transparency.html">Transparency</a><a href="./contact.html">Contact</a></div><div><h2>Policies</h2><a href="./privacy.html">Privacy</a><a href="./terms.html">Terms</a><a href="./accessibility.html">Accessibility</a></div></div></footer>;
}

function HomePage() {
  return <div className="page"><Header /><main>
    <section className="home-hero"><img className="hero-background-image" src="https://5e27aa4c670fcbb06b.v2.appdeploy.ai/resources/phone-donation-hero.png" alt="Older woman placing an old smartphone into a mailing envelope at home"/><div className="home-hero-inner"><div className="home-copy"><h1>Old Phones.<br/>New Possibilities.</h1><p className="lead">Put your old phone to work for a good cause.</p><div className="hero-actions"><a className="button primary" href="./donate-phone.html">Donate a Phone <ArrowRight/></a><a className="text-link" href="./how-it-works.html">See how it works</a></div></div></div></section>
    <section className="simple-section"><div className="content-narrow"><p className="kicker">How it works</p><div className="steps-feature"><div className="steps-copy"><h2>Three steps. One clear purpose.</h2><div className="steps-list"><article><span>1</span><div><h3>Tell us about the phone</h3><p>Select the brand, condition, and a few basic details. You can add more than one phone.</p></div></article><article><span>2</span><div><h3>Choose a charity and mailing option</h3><p>Search Pledge’s nonprofit database, select one organization, and choose a printable label or mail-in kit.</p></div></article><article><span>3</span><div><h3>Keep your documents</h3><p>Print a packing slip now. A charitable acknowledgment is issued only after the phones are received and verified.</p></div></article></div><a className="button secondary" href="./how-it-works.html">Read the full process</a></div><figure className="steps-photo"><img loading="lazy" src="https://images.pexels.com/photos/6975192/pexels-photo-6975192.jpeg?auto=compress&cs=tinysrgb&w=1200" alt="Senior couple using a smartphone together at home"/><figcaption>A familiar device can still have a useful next chapter.</figcaption></figure></div></div></section>
    <section className="reassurance"><div className="reassurance-inner"><div><ShieldCheck/><h2>Your information and your phone deserve careful handling.</h2><p>We explain what to back up, what to remove, and when documents become valid. We never ask for your passcode.</p></div><a className="button light" href="./prepare-phone.html">Prepare your phone</a></div></section>
    <section className="path-section"><div className="path-grid"><article><p className="kicker">For individual donors</p><h2>Ready to clear out a drawer?</h2><p>Start with the device. The donation flow shows only one stage at a time.</p><a className="button primary" href="./donate-phone.html">Start a donation</a></article><article><p className="kicker">For nonprofit organizations</p><h2>Interested in a phone campaign?</h2><p>Learn how Donate by Mail can provide templates, logistics, reporting, and a share of net proceeds.</p><a className="button secondary" href="./for-nonprofits.html">Explore partnerships</a></article></div></section>
    <section className="mascot-guide"><div className="mascot-guide-inner"><figure><img src="https://5e27aa4c670fcbb06b.v2.appdeploy.ai/resources/donate-doggo.png" alt="Donate by Mail black Labrador mail carrier mascot holding a cell phone"/></figure><div><p className="kicker">Here to help</p><h2>Not sure where to start?</h2><p>We keep the process simple: identify your phone, prepare it safely, choose a nonprofit, and mail it in.</p><div className="mascot-guide-actions"><a className="button secondary" href="./prepare-phone.html">Prepare your phone</a><a className="text-link" href="./resources.html">Help and FAQs</a></div></div></div></section>
  </main><Footer /></div>;
}

function FieldSelect({label,value,options,onChange}: {label:string;value:string;options:string[];onChange:(value:string)=>void}) {
  return <label className="field"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(option=><option key={option}>{option}</option>)}</select></label>;
}

function Progress({step}: {step:number}) {
  const labels = ['Phone','Estimate','Your details','Documents'];
  return <div className="progress" aria-label={`Step ${step} of 4`}><p>Step {step} of 4</p><ol>{labels.map((label,index)=><li className={index+1<=step?'active':''} key={label}><span>{index+1}</span><small>{label}</small></li>)}</ol></div>;
}

function CharitySelector({selected,onChange,error,revision}: {selected:SelectedCharity|null;onChange:(charity:SelectedCharity|null)=>void;error:string;revision:number}) {
  const [status,setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [loadAttempt,setLoadAttempt] = useState(0);
  const environment = getPledgeEnvironment();
  const partnerKey = getPartnerKey();
  const config = getPledgeWidgetConfig(partnerKey, environment);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const action = parsePledgeMessage(event, environment);
      if (!action) return;
      onChange(pledgeSelectionReducer(selected, action));
      if (action.type === 'selected') void fetchCharityDetails(action.charity).then((details) => onChange(details));
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [environment, onChange, selected]);

  useEffect(() => {
    if (!partnerKey) { setStatus('error'); return; }
    setStatus('loading');
    void loadPledgeScript(config.scriptUrl).then(() => setStatus('ready')).catch(() => setStatus('error'));
  }, [config.scriptUrl, loadAttempt, partnerKey, revision]);

  const retryWidget = () => { resetPledgeScript(); setLoadAttempt((value) => value + 1); };
  const changeCharity = () => { onChange(null); retryWidget(); };
  const location = selected ? charityLocation(selected) : '';

  return <section className="charity-selector" aria-labelledby="charity-heading">
    <div className="charity-copy"><p className="kicker">Charity selection</p><h2 id="charity-heading">Choose the charity that your donation supports.</h2><p>Search for a nonprofit and select the organization you would like your phone donation to support.</p><p className="charity-clarification">The final amount available to support the selected charity will depend on the phone’s condition, processing costs, and resale value.</p></div>
    {selected ? <div className="selected-charity" aria-live="polite">{selected.logoUrl&&<img src={selected.logoUrl} alt=""/>}<div><span>Selected charity</span><strong>{selected.name}</strong><small>Pledge ID: {selected.pledgeId}</small>{selected.ein&&<small>EIN: {selected.ein}</small>}{location!=='Not provided'&&<small>{location}</small>}</div><button type="button" onClick={changeCharity}>Change charity</button></div> : <>{status==='loading'&&<p className="widget-status" role="status">Loading charity search…</p>}{status==='error'?<div className="widget-error" role="alert"><p>We couldn’t load the charity search. Please try again.</p><button type="button" onClick={retryWidget}><RefreshCw/>Retry</button></div>:partnerKey&&<div key={`${revision}-${loadAttempt}`} className="plg-search pledge-widget" data-partner-key={partnerKey} aria-label="Search Pledge nonprofit organizations"/>}</>}
    {error&&<p id="charity-error" className="field-error" role="alert">{error}</p>}
  </section>;
}

function DonationPage() {
  const [step,setStep] = useState(1);
  const [devices,setDevices] = useState<Device[]>([makeDevice('phone-1')]);
  const [donor,setDonor] = useState<DonorDetails>(blankDonor);
  const [shippingMethod,setShippingMethod] = useState<ShippingMethod>('label');
  const [selectedCharity,setSelectedCharity] = useState<SelectedCharity|null>(null);
  const [charityError,setCharityError] = useState('');
  const [widgetRevision,setWidgetRevision] = useState(0);
  const [record,setRecord] = useState<DonationSubmission|null>(null);
  const [activeDocument,setActiveDocument] = useState<DocumentType>('packing');
  const [copied,setCopied] = useState(false);
  const [draftSaved,setDraftSaved] = useState(false);
  const [submitting,setSubmitting] = useState(false);
  const [submitError,setSubmitError] = useState('');
  const charitySectionRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{const cleanup=()=>document.body.removeAttribute('data-print-target');window.addEventListener('afterprint',cleanup);return()=>window.removeEventListener('afterprint',cleanup);},[]);
  useEffect(()=>{window.scrollTo({top:0,behavior:'smooth'});},[step]);

  const totals = useMemo(()=>devices.reduce((sum,device)=>{const value=estimate(device);return {low:sum.low+value.low,high:sum.high+value.high};},{low:0,high:0}),[devices]);
  const updateDevice = <K extends keyof Device>(id:string,key:K,value:Device[K]) => {setDevices(current=>current.map(device=>device.id===id?{...device,[key]:value}:device));setRecord(null);};
  const addDevice = () => setDevices(current=>[...current,makeDevice(`phone-${Date.now()}`)]);
  const removeDevice = (id:string) => setDevices(current=>current.filter(device=>device.id!==id));
  const updateDonor = (key:keyof DonorDetails,value:string) => {setDonor(current=>({...current,[key]:value}));setRecord(null);};
  const updateCharity = (charity: SelectedCharity|null) => {setSelectedCharity(charity);setCharityError('');setRecord(null);};
  const saveDraft = () => {localStorage.setItem('donate-by-mail-draft',JSON.stringify({devices,donor,shippingMethod,selectedCharity,step}));setDraftSaved(true);setTimeout(()=>setDraftSaved(false),1800);};
  const loadDraft = () => {const saved=localStorage.getItem('donate-by-mail-draft');if(!saved)return;try{const draft=JSON.parse(saved) as {devices?:Device[];donor?:DonorDetails;shippingMethod?:ShippingMethod;selectedCharity?:SelectedCharity|null;step?:number};if(draft.devices?.length)setDevices(draft.devices);if(draft.donor)setDonor(draft.donor);if(draft.shippingMethod)setShippingMethod(draft.shippingMethod);if(draft.selectedCharity)setSelectedCharity(draft.selectedCharity);if(draft.step)setStep(Math.min(3,Math.max(1,draft.step)));}catch{localStorage.removeItem('donate-by-mail-draft');}};
  const submit = async (event:FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError('');
    if (!selectedCharity) { setCharityError('Please select the charity you would like your donation to support.'); requestAnimationFrame(()=>charitySectionRef.current?.focus()); return; }
    const next: DonationSubmission = {id:donationId(),createdAt:new Date().toISOString(),donor:{...donor},shippingMethod,devices:devices.map(device=>({...device})),charity:selectedCharity};
    setSubmitting(true);
    try {
      const response = await sendDonation(next);
      const finalRecord = response.charity ? {...next,charity:response.charity} : next;
      setSelectedCharity(finalRecord.charity);
      setRecord(finalRecord);
      setActiveDocument('packing');
      setStep(4);
      localStorage.removeItem('donate-by-mail-draft');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We could not send the donation packet. Please try again.');
    } finally { setSubmitting(false); }
  };
  const printDocument = (target:DocumentType) => {setActiveDocument(target);document.body.setAttribute('data-print-target',target);setTimeout(()=>window.print(),50);};
  const copyId = async () => {if(!record)return;await navigator.clipboard.writeText(record.id);setCopied(true);setTimeout(()=>setCopied(false),1400);};

  return <div className="page"><Header simple /><main className="donation-main"><div className="flow-shell"><Progress step={step}/>
    {step===1&&<section className="flow-card"><div className="flow-heading"><p className="kicker">Describe the phone</p><h1>What phone would you like to donate?</h1><p>Use the best information you have. Exact details can be confirmed after arrival.</p></div><div className="device-stack">{devices.map((device,index)=><article className="device-form" key={device.id}><div className="device-title"><h2>Phone {index+1}</h2>{devices.length>1&&<button className="icon-action" onClick={()=>removeDevice(device.id)} aria-label={`Remove phone ${index+1}`}><Trash2/></button>}</div><div className="form-grid"><FieldSelect label="Brand" value={device.brand} options={brands} onChange={value=>updateDevice(device.id,'brand',value as Brand)}/><label className="field"><span>Model, if known</span><input value={device.model} onChange={e=>updateDevice(device.id,'model',e.target.value)} placeholder="Example: iPhone 13"/></label><FieldSelect label="Approximate age" value={device.age} options={ages} onChange={value=>updateDevice(device.id,'age',value as Age)}/><FieldSelect label="Condition" value={device.condition} options={conditions} onChange={value=>updateDevice(device.id,'condition',value as Condition)}/><FieldSelect label="Storage" value={device.storage} options={storageOptions} onChange={value=>updateDevice(device.id,'storage',value as Storage)}/><div className="check-group"><label><input type="checkbox" checked={device.powersOn} onChange={e=>updateDevice(device.id,'powersOn',e.target.checked)}/>The phone powers on</label><label><input type="checkbox" checked={device.unlocked} onChange={e=>updateDevice(device.id,'unlocked',e.target.checked)}/>The phone is carrier-unlocked</label></div></div></article>)}</div><button className="add-button" onClick={addDevice}><Plus/>Add another phone</button><p className="inline-help"><HelpCircle/>Not sure which model you have? <a href="./prepare-phone.html#find-model">See how to find it.</a></p><div className="flow-actions"><span></span><button className="button primary" onClick={()=>setStep(2)}>See my estimate <ArrowRight/></button></div></section>}
    {step===2&&<section className="flow-card estimate-step"><div className="flow-heading"><p className="kicker">Planning estimate</p><h1>Your estimated device value</h1><p>This range helps explain the potential resale proceeds. It is not a tax appraisal or guaranteed sale amount.</p></div><div className="estimate-total"><span>Estimated combined value</span><strong>{money(totals.low)} - {money(totals.high)}</strong><small>Before inspection, resale expenses, and market changes.</small></div><div className="summary-list">{devices.map((device,index)=>{const value=estimate(device);return <div key={device.id}><span><Smartphone/>{device.brand} {device.model||`phone ${index+1}`}</span><strong>{money(value.low)} - {money(value.high)}</strong></div>;})}</div><div className="plain-notice"><ShieldCheck/><p><strong>The charitable acknowledgment will not list this estimate.</strong> Donors are responsible for determining and substantiating any fair market value claimed for tax purposes.</p></div><div className="flow-actions"><button className="button text" onClick={()=>setStep(1)}><ArrowLeft/>Back</button><button className="button primary" onClick={()=>setStep(3)}>Continue to charity and mailing details <ArrowRight/></button></div></section>}
    {step===3&&<section className="flow-card"><div className="flow-heading"><p className="kicker">Charity and donor details</p><h1>Choose a charity and tell us where to send your mailing materials.</h1><p>Your selected charity stays attached to this donation packet.</p></div><form onSubmit={submit}><div ref={charitySectionRef} tabIndex={-1} aria-describedby={charityError?'charity-error':undefined}><CharitySelector selected={selectedCharity} onChange={updateCharity} error={charityError} revision={widgetRevision}/></div><div className="form-grid donor-grid"><label className="field full"><span>Full name</span><input required autoComplete="name" value={donor.name} onChange={e=>updateDonor('name',e.target.value)}/></label><label className="field full"><span>Email address</span><input required type="email" autoComplete="email" value={donor.email} onChange={e=>updateDonor('email',e.target.value)}/></label><label className="field full"><span>Street address</span><input required autoComplete="address-line1" value={donor.address1} onChange={e=>updateDonor('address1',e.target.value)}/></label><label className="field full"><span>Apartment, suite, or unit <em>optional</em></span><input autoComplete="address-line2" value={donor.address2} onChange={e=>updateDonor('address2',e.target.value)}/></label><label className="field"><span>City</span><input required autoComplete="address-level2" value={donor.city} onChange={e=>updateDonor('city',e.target.value)}/></label><FieldSelect label="State" value={donor.state} options={states} onChange={value=>updateDonor('state',value)}/><label className="field full"><span>ZIP code</span><input required inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" autoComplete="postal-code" value={donor.zip} onChange={e=>updateDonor('zip',e.target.value)}/></label></div><fieldset className="mail-choice"><legend>Choose a mailing option</legend><label className={shippingMethod==='label'?'selected':''}><input type="radio" name="shipping" checked={shippingMethod==='label'} onChange={()=>setShippingMethod('label')}/><Printer/><span><strong>Print a prepaid label</strong><small>Fastest. Use your own sturdy box.</small></span></label><label className={shippingMethod==='kit'?'selected':''}><input type="radio" name="shipping" checked={shippingMethod==='kit'} onChange={()=>setShippingMethod('kit')}/><Mail/><span><strong>Send me a mail-in kit</strong><small>Packaging and instructions are mailed to you.</small></span></label></fieldset><label className="required-check"><input required type="checkbox"/><span>I have backed up anything I want to keep, signed out of accounts, removed activation locks and SIM cards when possible, and I will not include passwords or passcodes. <a href="./prepare-phone.html">Review preparation steps</a>.</span></label><div className="draft-actions"><button type="button" onClick={saveDraft}>{draftSaved?'Draft saved':'Save draft in this browser'}</button><button type="button" onClick={loadDraft}>Restore saved draft</button></div>{submitError&&<p className="submit-error" role="alert">{submitError}</p>}<div className="flow-actions"><button type="button" className="button text" onClick={()=>setStep(2)}><ArrowLeft/>Back</button><button type="submit" className="button primary" disabled={submitting}>{submitting?'Sending donation packet…':'Create donation packet'} {!submitting&&<ArrowRight/>}</button></div><p className="prototype-note">Drafts stay in this browser. When you create the packet, the donor, phone, mailing, and selected-charity details are sent to Donate by Mail. This feature does not send money through Pledge.</p></form></section>}
    {step===4&&record&&<section className="flow-card document-step"><div className="success-heading"><CheckCircle2/><div><p className="kicker">Donation packet sent</p><h1>Your documents are ready.</h1><p>Donation ID: <strong>{record.id}</strong></p><p>Selected charity: <strong>{record.charity.name}</strong></p></div><button className="copy-button" onClick={copyId}><Copy/>{copied?'Copied':'Copy ID'}</button></div><div className="document-tabs"><button className={activeDocument==='packing'?'active':''} onClick={()=>setActiveDocument('packing')}><ClipboardCheck/><span><strong>Packing slip</strong><small>Print now and place it in the box.</small></span></button><button className={activeDocument==='acknowledgment'?'active':''} onClick={()=>setActiveDocument('acknowledgment')}><FileCheck2/><span><strong>Acknowledgment preview</strong><small>Issued only after receipt is verified.</small></span></button></div>{activeDocument==='packing'?<PackingSlip record={record} onPrint={()=>printDocument('packing')}/>:<Acknowledgment record={record} onPrint={()=>printDocument('acknowledgment')}/>}<div className="flow-actions"><button className="button text" onClick={()=>{setStep(3);setWidgetRevision(value=>value+1);}}><ArrowLeft/>Edit details</button><a className="button secondary" href="./receipts.html">Understand these documents</a></div></section>}
  </div></main><Footer/></div>;
}

function PackingSlip({record,onPrint}: {record:DonationSubmission;onPrint:()=>void}) {
  const date = new Date(record.createdAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const location = charityLocation(record.charity);
  return <div className="document-wrap"><div className="document-toolbar"><div><strong>Packing slip</strong><span>Include one copy inside the package.</span></div><button className="button secondary" onClick={onPrint}><Printer/>Print or save PDF</button></div><article id="packing-document" className="print-document"><div className="doc-rule"/><header><Logo/><div><small>Donation ID</small><strong>{record.id}</strong><span>Created {date}</span></div></header><section className="doc-two"><div><h2>Donor</h2><p><strong>{record.donor.name}</strong><br/>{record.donor.address1}<br/>{record.donor.address2&&<>{record.donor.address2}<br/></>}{record.donor.city}, {record.donor.state} {record.donor.zip}<br/>{record.donor.email}</p></div><div><h2>Selected charity</h2><p><strong>{record.charity.name}</strong><br/>Pledge ID: {record.charity.pledgeId}<br/>{record.charity.ein&&<>EIN: {record.charity.ein}<br/></>}{location!=='Not provided'&&location}</p></div></section><section><h2>Mailing plan</h2><p><strong>{record.shippingMethod==='label'?'Printable prepaid label':'Mail-in kit requested'}</strong> · Keep this donation ID with the package.</p></section><section><h2>Devices enclosed</h2>{record.devices.map((device,index)=><p className="device-line" key={device.id}>{describeDevice(device,index)}</p>)}</section><section className="doc-checks"><div><h2>Before sealing the box</h2><p>□ Remove SIM and memory cards<br/>□ Turn off activation locks<br/>□ Factory reset when possible<br/>□ Do not include passcodes</p></div><div><h2>For Donate by Mail staff</h2><p>□ Package received<br/>□ Device count confirmed<br/>□ Selected charity confirmed<br/>□ Acknowledgment authorized</p></div></section><p className="doc-note">This packing slip is not a charitable contribution acknowledgment. Selecting a charity here does not send money through Pledge.</p></article></div>;
}

function Acknowledgment({record,onPrint}: {record:DonationSubmission;onPrint:()=>void}) {
  return <div className="document-wrap"><div className="document-toolbar"><div><strong>Acknowledgment preview</strong><span>Pending physical receipt and verification.</span></div><button className="button secondary" onClick={onPrint}><Printer/>Print preview</button></div><article id="acknowledgment-document" className="print-document pending"><div className="watermark">PENDING</div><div className="doc-rule"/><header><Logo/><div><small>Acknowledgment ID</small><strong>{record.id}</strong><span>Pending receipt confirmation</span></div></header><p className="pending-label">Preview only - not valid for tax purposes</p><h1>Noncash charitable contribution acknowledgment</h1><p>Thank you, <strong>{record.donor.name}</strong>. This preview shows the format Donate by Mail will use after the donated property is physically received and verified.</p><section><h2>Property described by donor</h2>{record.devices.map((device,index)=><p className="device-line" key={device.id}>{describeDevice(device,index)}</p>)}</section><p className="no-goods"><strong>No goods or services were provided by Donate by Mail in exchange for this contribution.</strong></p><p>Donate by Mail does not assign a fair market value to the donated property. The donor is responsible for determining and substantiating any charitable deduction.</p></article></div>;
}

function App() {
  const path = window.location.pathname.toLowerCase();
  return path.endsWith('/donate-phone.html') || path.endsWith('donate-phone.html') ? <DonationPage/> : <HomePage/>;
}

export default App;
