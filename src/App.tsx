import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  HelpCircle,
  LockKeyhole,
  Mail,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  getPledgeWidgetConfig,
  mergeCharityDetails,
  parsePledgeMessage,
  pledgeSelectionReducer,
  type PledgeEnvironment,
  type SelectedCharity,
} from "./pledge";
import { resolveSubmissionAttempt, submissionIntentFingerprint, type SubmissionAttempt } from "./gen2/submissionAttempt";
import { parseDonationDraft, serializeDonationDraft } from "./gen2/donationDraft";
import {
  charityLocation,
  describeDevice,
  DONATE_BY_MAIL_ADDRESS,
  donorFullName,
  type Age,
  type Brand,
  type Condition,
  type Device,
  type DonationSubmission,
  type DonorDetails,
  type ShippingMethod,
  type Storage,
} from "./submission";
import { countries, countryName } from "./countries";
import { TrackingPage } from "./gen2/TrackingPage";
import { StaffPage } from "./gen2/StaffPage";
import { DonorAccountPage } from "./gen2/DonorAccountPage";
import { PartnerPage } from "./gen2/PartnerPage";
import { CampaignPage } from "./gen2/CampaignPage";
import { AccountGatewayPage, AccountSettingsPage } from "./gen2/AccountGatewayPage";
import { ArticlesPage } from "./gen2/ArticlesPage";
import { trackEvent } from "./analytics";
type SubmissionResponse = {
  ok: boolean;
  message?: string;
  charity?: SelectedCharity;
  donationId?: string;
  createdAt?: string;
  trackingUrl?: string;
  notificationPending?: boolean;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: string;
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || "";
const brands: Brand[] = ["Apple", "Samsung", "Google", "Motorola", "Other"],
  ages: Age[] = ["0-1 year", "2-3 years", "4-5 years", "6+ years"],
  conditions: Condition[] = ["Excellent", "Good", "Fair", "Damaged"],
  storageOptions: Storage[] = ["64 GB or less", "128 GB", "256 GB", "512 GB+"],
  states = [
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
    "DC",
  ];
const baseValues: Record<Brand, Record<Age, number>> = {
    Apple: {
      "0-1 year": 430,
      "2-3 years": 250,
      "4-5 years": 110,
      "6+ years": 35,
    },
    Samsung: {
      "0-1 year": 320,
      "2-3 years": 180,
      "4-5 years": 75,
      "6+ years": 25,
    },
    Google: {
      "0-1 year": 260,
      "2-3 years": 150,
      "4-5 years": 65,
      "6+ years": 22,
    },
    Motorola: {
      "0-1 year": 145,
      "2-3 years": 80,
      "4-5 years": 35,
      "6+ years": 12,
    },
    Other: { "0-1 year": 105, "2-3 years": 55, "4-5 years": 22, "6+ years": 8 },
  },
  conditionFactor: Record<Condition, number> = {
    Excellent: 1,
    Good: 0.78,
    Fair: 0.48,
    Damaged: 0.18,
  },
  storageFactor: Record<Storage, number> = {
    "64 GB or less": 0.9,
    "128 GB": 1,
    "256 GB": 1.12,
    "512 GB+": 1.25,
  };
const blankDonor: DonorDetails = {
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    address1: "",
    address2: "",
    city: "",
    state: "FL",
    zip: "",
    country: "US",
    marketingEmailConsent: false,
  },
  makeDevice = (id: string): Device => ({
    id,
    brand: "Apple",
    model: "",
    age: "2-3 years",
    condition: "Good",
    storage: "128 GB",
    powersOn: true,
    unlocked: true,
  }),
  estimate = (d: Device) => {
    const m =
      baseValues[d.brand][d.age] *
      conditionFactor[d.condition] *
      storageFactor[d.storage] *
      (d.powersOn ? 1 : 0.38) *
      (d.unlocked ? 1.08 : 0.92);
    return {
      low: Math.max(1, Math.round(m * 0.82)),
      high: Math.max(2, Math.round(m * 1.17)),
    };
  },
  money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(v),
  donationId = () =>
    `DBM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
function getPartnerKey() {
  return (
    import.meta.env.VITE_PLEDGE_PARTNER_KEY?.trim() ||
    document
      .querySelector<HTMLMetaElement>('meta[name="pledge-partner-key"]')
      ?.content.trim() ||
    ""
  );
}
function getPledgeEnvironment(): PledgeEnvironment {
  return import.meta.env.VITE_PLEDGE_ENV === "sandbox"
    ? "sandbox"
    : "production";
}
function resetPledgeScript() {
  document
    .querySelectorAll("script[data-dbm-pledge-script]")
    .forEach((s) => s.remove());
}
function loadPledgeScript(url: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-dbm-pledge-script="${url}"]`,
    );
    if (existing?.dataset.loaded === "true") return resolve();
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("load failed")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = url;
    script.dataset.dbmPledgeScript = url;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error("load failed")), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

function loadTurnstileScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.turnstile) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-dbm-turnstile-script="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("load failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.dataset.dbmTurnstileScript = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("load failed")), { once: true });
    document.head.appendChild(script);
  });
}

function TurnstileWidget({
  onToken,
  onResetReady,
}: {
  onToken: (token: string) => void;
  onResetReady: (reset: () => void) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return;
    let widgetId: string | null = null;
    let disposed = false;
    const reset = () => {
      tokenRef.current("");
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    };
    onResetReady(reset);
    void loadTurnstileScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action: "donation_submit",
          callback: (token) => tokenRef.current(token),
          "expired-callback": () => tokenRef.current(""),
          "error-callback": () => tokenRef.current(""),
        });
      })
      .catch(() => tokenRef.current(""));
    return () => {
      disposed = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onResetReady]);
  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div className="turnstile-field" aria-label="Security verification">
      <p>Security verification</p>
      <div ref={containerRef} data-action="turnstile-spin-v1" />
    </div>
  );
}

async function fetchCharityDetails(charity: SelectedCharity) {
  try {
    const response = await fetch(
      `./api/pledge/organizations/${encodeURIComponent(charity.pledgeId)}`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) return charity;
    const body = (await response.json()) as {
      charity?: Partial<SelectedCharity>;
    };
    return body.charity ? mergeCharityDetails(charity, body.charity) : charity;
  } catch {
    return charity;
  }
}
async function sendDonation(
  record: DonationSubmission,
  turnstileToken = "",
): Promise<SubmissionResponse> {
  const response = await fetch("/api/donations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(
        turnstileToken ? { ...record, turnstileToken } : record,
      ),
    }),
    body = (await response.json().catch(() => ({}))) as SubmissionResponse;
  if (!response.ok)
    throw new Error(
      body.message ||
        "We could not send the donation packet. Please try again.",
    );
  return body;
}
function DocumentLogo() {
  return (
    <img
      className="document-logo"
      src="/resources/donate-by-mail-logo.png"
      alt="Donate by Mail"
    />
  );
}
function SiteLogo() {
  return (
    <a className="site-brand-logo" href="/" aria-label="Donate by Mail home">
      <img src="/resources/donate-by-mail-logo.png" alt="Donate by Mail" />
    </a>
  );
}
function Header() {
  const [open, setOpen] = useState(false),
    [signedIn, setSignedIn] = useState(false),
    links = [
      ["Donate a phone", "/donate-phone.html"],
      ["How it works", "/how-it-works.html"],
      ["Prepare your phone", "/prepare-phone.html"],
      ["For nonprofits", "/for-nonprofits.html"],
      ["Help and FAQs", "/resources.html"],
      ["Articles", "/articles"],
      ["About", "/about.html"],
    ],
    currentPath = window.location.pathname.replace(/\/$/, "") || "/",
    active = (h: string) => h === "/articles" ? currentPath === "/articles" || currentPath === "/articles.html" || currentPath.startsWith("/articles/") : currentPath === h.replace(/\.html$/, "") || currentPath === h;
  useEffect(() => {
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json() as Promise<{ authenticated?: boolean }>)
      .then((body) => setSignedIn(Boolean(body.authenticated)))
      .catch(() => setSignedIn(false));
  }, []);
  return (
    <>
      <div className="charity-bar">
        Donate by Mail is a U.S. 501(c)(3) public charity
      </div>
      <header className="site-header">
        <div className="header-inner">
          <SiteLogo />
          <nav className="desktop-nav" aria-label="Primary navigation">
            {links.map(([l, h], i) => (
              <a
                aria-current={active(h) ? "page" : undefined}
                className={i === 0 ? "nav-primary" : ""}
                href={h}
                key={h}
              >
                {l}
              </a>
            ))}
          </nav>
          <a className="account-nav-link" href="/login">{signedIn ? "My Account" : "Log in"}</a>
          <button
            className="menu-button"
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
        {open && (
          <nav id="mobile-navigation" className="mobile-nav" aria-label="Mobile navigation">
            {links.map(([l, h], i) => (
              <a
                aria-current={active(h) ? "page" : undefined}
                className={i === 0 ? "nav-primary" : ""}
                href={h}
                key={h}
              >
                {l}
              </a>
            ))}
            <a className="account-nav-link" href="/login">{signedIn ? "My Account" : "Log in"}</a>
          </nav>
        )}
      </header>
    </>
  );
}
function SocialLinks() {
  return (
    <nav
      className="footer-social-links"
      aria-label="Donate by Mail social media"
    >
      <a
        href="https://x.com/donatebymail"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Donate by Mail on X"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
      <a
        href="https://www.facebook.com/people/Donate-by-Mail/61551982935106/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Donate by Mail on Facebook"
      >
        <svg viewBox="0 0 320 512" aria-hidden="true">
          <path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06H297V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z" />
        </svg>
      </a>
      <a
        href="https://bsky.app/profile/donatebymail.bsky.social"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Donate by Mail on Bluesky"
      >
        <img
          className="social-icon-bluesky"
          src="/resources/bluesky-white-icon.png"
          alt=""
          width="512"
          height="512"
          aria-hidden="true"
        />
      </a>
    </nav>
  );
}
function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <SiteLogo />
          <p>
            Turning unused phones into funding for meaningful causes through a
            clear mail-in process.
          </p>
          <p>
            <strong>U.S. 501(c)(3) public charity · EIN 92-1515120</strong>
            <br />
            <a href="mailto:tre@donatebymail.org">tre@donatebymail.org</a>
          </p>
          <SocialLinks />
        </div>
        <div>
          <h2>Get started</h2>
          <a href="/donate-phone.html">Donate a phone</a>
          <a href="/prepare-phone.html">Prepare your phone</a>
          <a href="/phone-drives.html">Host a phone drive</a>
          <a href="/get-involved.html">Get involved</a>
          <a href="/receipts.html">Receipts and documents</a>
        </div>
        <div>
          <h2>Learn</h2>
          <a href="/how-it-works.html">How it works</a>
          <a href="/for-nonprofits.html">For nonprofits</a>
          <a href="/resources.html">Help and FAQs</a>
          <a href="/articles">Articles</a>
          <a href="/transparency.html">Transparency</a>
        </div>
        <div>
          <h2>Organization and policies</h2>
          <a href="/about.html">About us</a>
          <a href="/team.html">Our team</a>
          <a href="/contact.html">Contact</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
          <a href="/accessibility.html">Accessibility</a>
        </div>
      </div>
    </footer>
  );
}
function HomePage() {
  return (
    <div className="page">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Header />
      <main id="main-content">
        <section className="home-hero">
          <img
            className="hero-background-image"
            src="/resources/phone-donation-hero.png"
            alt="Older woman placing an old smartphone into a mailing envelope at home"
          />
          <div className="home-hero-inner">
            <div className="home-copy">
              <h1>
                Old Phones.
                <br />
                New Possibilities.
              </h1>
              <p className="lead">
                Turn an old phone into support for a charity you choose.
              </p>
              <div className="hero-actions">
                <a className="button primary" href="/donate-phone.html">
                  Donate a Phone <ArrowRight />
                </a>
                <a className="text-link" href="/how-it-works.html">
                  See How It Works
                </a>
              </div>
            </div>
          </div>
        </section>
        <section className="value-story" aria-labelledby="value-title">
          <div className="editorial-split value-story-inner">
            <figure className="editorial-photo value-photo">
              <img
                src="/resources/home-unused-phone.webp"
                alt="Unused smartphone resting on a table at home"
                width="1200"
                height="1800"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="editorial-copy">
              <p className="kicker">A useful next chapter</p>
              <h2 id="value-title">That old phone can still do some good.</h2>
              <p>
                An old phone sitting at home may no longer be useful to you, but
                it can still have value. Donate by Mail gives that device a
                practical way to support charitable work instead of leaving it
                forgotten.
              </p>
            </div>
          </div>
        </section>

        <section
          className="trust-strip"
          aria-label="Why donors can trust Donate by Mail"
        >
          <div className="trust-strip-inner">
            <div>
              <ShieldCheck aria-hidden="true" />
              <span>U.S. 501(c)(3) public charity</span>
            </div>
            <div>
              <Search aria-hidden="true" />
              <span>Choose through Pledge’s nonprofit database</span>
            </div>
            <div>
              <LockKeyhole aria-hidden="true" />
              <span>We never ask for your passcode</span>
            </div>
            <div>
              <FileCheck2 aria-hidden="true" />
              <span>Documentation after receipt and verification</span>
            </div>
          </div>
        </section>

        <section className="how-section" aria-labelledby="how-title">
          <div className="home-section-inner">
            <div className="section-heading">
              <p className="kicker">How it works</p>
              <h2 id="how-title">Three simple steps.</h2>
              <p>Start with what you know. We’ll guide you through the rest.</p>
            </div>
            <ol className="home-steps">
              <li>
                <span className="step-number">1</span>
                <div>
                  <Smartphone aria-hidden="true" />
                  <h3>Tell us about your phone</h3>
                  <p>Choose the device and give us a few basic details.</p>
                </div>
              </li>
              <li>
                <span className="step-number">2</span>
                <div>
                  <Search aria-hidden="true" />
                  <h3>Choose a charity</h3>
                  <p>
                    Search Pledge’s nonprofit database and select the
                    organization you want your donation to support.
                  </p>
                </div>
              </li>
              <li>
                <span className="step-number">3</span>
                <div>
                  <Mail aria-hidden="true" />
                  <h3>Mail your phone</h3>
                  <p>
                    Prepare your device, send it to Donate by Mail, and we’ll
                    take it from there.
                  </p>
                </div>
              </li>
            </ol>
            <div className="after-receipt-note">
              <PackageCheck aria-hidden="true" />
              <p>
                <strong>After your phone arrives,</strong> we verify what we
                received and determine the appropriate path for the device,
                including reuse, resale, parts recovery, or responsible
                recycling.
              </p>
            </div>
            <a className="text-link section-link" href="/how-it-works.html">
              Read the full process <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </section>

        <section
          className="charity-story"
          aria-labelledby="charity-story-title"
        >
          <div className="editorial-split charity-story-inner">
            <div className="editorial-copy">
              <p className="kicker">Choice matters</p>
              <h2 id="charity-story-title">Your phone. Your cause.</h2>
              <p>
                When you start a donation, you can search Pledge’s nonprofit
                database and choose an organization you care about. We record
                that selection with your donation so recoverable value from the
                device can support the cause you chose.
              </p>
              <p className="fine-print">
                Pledge provides nonprofit search and selection. Donate by Mail
                does not send proceeds through Pledge.
              </p>
            </div>
            <div
              className="charity-search-visual"
              role="img"
              aria-label="Preview of the nonprofit search experience in the Donate by Mail donation flow"
            >
              <div className="visual-window-bar" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="charity-search-content">
                <p className="visual-step">Donation flow · Charity selection</p>
                <h3>Choose the charity you want to support.</h3>
                <div className="search-preview">
                  <Search aria-hidden="true" />
                  <span>Search by nonprofit name or EIN</span>
                </div>
                <div className="search-source">
                  <ShieldCheck aria-hidden="true" />
                  <span>
                    Search results come from Pledge’s nonprofit database.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="data-section" aria-labelledby="data-title">
          <div className="editorial-split data-section-inner">
            <figure className="editorial-photo data-photo">
              <img
                src="/resources/home-phone-preparation.webp"
                alt="Smartphone resting on a shipping carton during a package handoff"
                width="1200"
                height="802"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="editorial-copy">
              <p className="kicker">Before you mail</p>
              <h2 id="data-title">Your data stays yours.</h2>
              <p>
                Before you mail your phone, we’ll walk you through a few simple
                preparation steps. We never ask for your passcode.
              </p>
              <a className="button light" href="/prepare-phone.html">
                Prepare Your Phone
              </a>
            </div>
          </div>
        </section>

        <section
          className="credibility-section"
          aria-labelledby="credibility-title"
        >
          <div className="credibility-inner">
            <figure>
              <img
                src="/resources/donate-doggo.png"
                alt="Donate by Mail Labrador mail carrier mascot holding a cell phone"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div>
              <h2 id="credibility-title">$78,000+</h2>
              <p className="credibility-label">
                Raised for charitable campaigns by our team before Donate by
                Mail.
              </p>
              <p>
                That experience helps us keep donor communication clear and the
                practical work grounded in what charities and supporters need.
              </p>
            </div>
          </div>
        </section>

        <section className="faq-section" aria-labelledby="faq-title">
          <div className="home-section-inner faq-inner">
            <h2 id="faq-title">Questions? We’ve got answers.</h2>
            <div className="home-faq">
              <details>
                <summary>What happens to my phone after I mail it?</summary>
                <p>
                  We record and verify what arrived. Based on condition, safety,
                  account locks, parts value, and market demand, the phone may
                  be reused, resold, used for parts, or responsibly recycled.
                </p>
              </details>
              <details>
                <summary>What should I do with the data on my phone?</summary>
                <p>
                  Back up what you want to keep, sign out of accounts, remove
                  activation locks and cards, and factory reset when possible.
                  We never ask for your passcode.
                </p>
              </details>
              <details>
                <summary>Can I choose the nonprofit?</summary>
                <p>
                  Yes. The donation flow lets you search Pledge’s nonprofit
                  database and select one organization for your donation to
                  support.
                </p>
              </details>
              <details>
                <summary>Do I have to pay for shipping?</summary>
                <p>
                  Yes. You provide sturdy packaging and purchase postage
                  directly from the carrier you choose. We provide a printable
                  address label, not prepaid postage.
                </p>
              </details>
              <details>
                <summary>When do I receive donation documentation?</summary>
                <p>
                  Your packing slip is created before mailing. A charitable
                  acknowledgment is issued only after Donate by Mail physically
                  receives and verifies the donated property.
                </p>
              </details>
            </div>
            <a className="text-link section-link" href="/resources.html">
              View all Help and FAQs <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="donor-close" aria-labelledby="donor-close-title">
          <div className="donor-close-inner">
            <div>
              <p className="kicker">Ready when you are</p>
              <h2 id="donor-close-title">
                Ready to give your old phone a new purpose?
              </h2>
              <p>Start your donation when you’re ready.</p>
            </div>
            <div className="donor-close-actions">
              <a className="button primary" href="/donate-phone.html">
                Donate a Phone <ArrowRight aria-hidden="true" />
              </a>
              <a className="text-link" href="/resources.html">
                Read the FAQs
              </a>
            </div>
          </div>
        </section>

        <section
          className="nonprofit-section"
          aria-labelledby="nonprofit-title"
        >
          <div className="editorial-split nonprofit-inner">
            <div className="editorial-copy">
              <p className="kicker">For organizations</p>
              <h2 id="nonprofit-title">Are you a nonprofit?</h2>
              <p>
                Run a phone-donation campaign with clear supporter instructions,
                donor logistics, reporting, and an applicable share of net
                proceeds.
              </p>
              <a className="button secondary" href="/for-nonprofits.html">
                Explore Nonprofit Partnerships
              </a>
            </div>
            <figure className="editorial-photo nonprofit-photo">
              <img
                src="/resources/home-nonprofit-volunteers.webp"
                alt="Volunteers organizing donated goods together"
                width="1200"
                height="800"
                loading="lazy"
                decoding="async"
              />
            </figure>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
function FieldSelect({
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
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
function Progress({ step }: { step: number }) {
  const labels = ["Phone", "Estimate", "Your details", "Documents"];
  return (
    <div className="progress" aria-label={`Step ${step} of 4`}>
      <p>Step {step} of 4</p>
      <ol>
        {labels.map((l, i) => (
          <li className={i + 1 <= step ? "active" : ""} key={l}>
            <span>{i + 1}</span>
            <small>{l}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
function CharitySelector({
  selected,
  onChange,
  error,
  revision,
  campaignLocked = false,
}: {
  selected: SelectedCharity | null;
  onChange: (charity: SelectedCharity | null) => void;
  error: string;
  revision: number;
  campaignLocked?: boolean;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    ),
    [attempt, setAttempt] = useState(0),
    environment = getPledgeEnvironment(),
    partnerKey = getPartnerKey(),
    config = getPledgeWidgetConfig(partnerKey, environment);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const action = parsePledgeMessage(event, environment);
      if (!action) return;
      onChange(pledgeSelectionReducer(selected, action));
      if (action.type === "selected")
        void fetchCharityDetails(action.charity).then(onChange);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [environment, onChange, selected]);
  useEffect(() => {
    if (!partnerKey) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    void loadPledgeScript(config.scriptUrl)
      .then(() => setStatus("ready"))
      .catch(() => setStatus("error"));
  }, [config.scriptUrl, attempt, partnerKey, revision]);
  const retry = () => {
      resetPledgeScript();
      setAttempt((v) => v + 1);
    },
    change = () => {
      onChange(null);
      retry();
    },
    location = selected ? charityLocation(selected) : "";
  return (
    <section className="charity-selector" aria-labelledby="charity-heading">
      <div className="charity-copy">
        <p className="kicker">Charity selection</p>
        <h2 id="charity-heading">
          {campaignLocked ? "Your campaign nonprofit is already selected." : "Choose the charity that your donation supports."}
        </h2>
        <p>
          {campaignLocked ? "Continue with the selected beneficiary, or choose a different charity to leave this campaign." : "Search for a nonprofit and select the organization you would like your phone donation to support."}
        </p>
        <p className="charity-clarification">
          The final amount available to support the selected charity will depend
          on the phone’s condition, processing costs, and resale value.
        </p>
      </div>
      {selected ? (
        <div className="selected-charity" aria-live="polite">
          {selected.logoUrl && <img src={selected.logoUrl} alt="" />}
          <div>
          <span>{campaignLocked ? "You're supporting this campaign's nonprofit" : "Selected charity"}</span>
            <strong>{selected.name}</strong>
            {selected.ein && <small>EIN: {selected.ein}</small>}
            {location !== "Not provided" && <small>{location}</small>}
          </div>
          <button type="button" onClick={change}>
            {campaignLocked ? "Choose a different charity" : "Change charity"}
          </button>
        </div>
      ) : (
        <>
          {status === "loading" && (
            <p className="widget-status" role="status">
              Loading charity search…
            </p>
          )}
          {status === "error" ? (
            <div className="widget-error" role="alert">
              <p>We couldn’t load the charity search. Please try again.</p>
              <button type="button" onClick={retry}>
                <RefreshCw />
                Retry
              </button>
            </div>
          ) : (
            partnerKey && (
              <div
                key={`${revision}-${attempt}`}
                className="plg-search pledge-widget"
                data-partner-key={partnerKey}
                aria-label="Search Pledge nonprofit organizations"
              />
            )
          )}
        </>
      )}
      {error && (
        <p id="charity-error" className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function DonationPage() {
  const [step, setStep] = useState(1),
    [devices, setDevices] = useState<Device[]>([makeDevice("phone-1")]),
    [donor, setDonor] = useState<DonorDetails>(blankDonor),
    shippingMethod: ShippingMethod = "label",
    [selectedCharity, setSelectedCharity] = useState<SelectedCharity | null>(
      null,
    ),
    [campaignSlug, setCampaignSlug] = useState<string | null>(() => new URLSearchParams(window.location.search).get("campaign")),
    [campaignLoading, setCampaignLoading] = useState(() => Boolean(new URLSearchParams(window.location.search).get("campaign"))),
    [campaignMessage, setCampaignMessage] = useState(""),
    [charityError, setCharityError] = useState(""),
    [revision, setRevision] = useState(0),
    [record, setRecord] = useState<DonationSubmission | null>(null),
    [trackingLink, setTrackingLink] = useState(""),
    [notificationPending, setNotificationPending] = useState(false),
    [draftSaved, setDraftSaved] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [submitError, setSubmitError] = useState(""),
    [turnstileToken, setTurnstileToken] = useState(""),
    charityRef = useRef<HTMLDivElement>(null),
    submissionAttempt = useRef<SubmissionAttempt | null>(null),
    turnstileResetRef = useRef<(() => void) | null>(null),
    registerTurnstileReset = useCallback((reset: () => void) => {
      turnstileResetRef.current = reset;
    }, []);
  useEffect(() => {
    const cleanup = () => document.body.removeAttribute("data-print-target");
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);
  useEffect(() => {
    if (!campaignSlug) { setCampaignLoading(false); return; }
    let active = true;
    setCampaignLoading(true); setCampaignMessage("");
    fetch(`/api/campaigns/${encodeURIComponent(campaignSlug)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json() as { campaign?: { charity?: SelectedCharity; charityPledgeId: string; charityName: string }; message?: string };
        if (!response.ok || !body.campaign) throw new Error(body.message || "This campaign is not available.");
        const beneficiary = body.campaign.charity || { pledgeId: body.campaign.charityPledgeId, name: body.campaign.charityName };
        if (!beneficiary.pledgeId || !beneficiary.name) throw new Error("This campaign has no verified nonprofit beneficiary.");
        if (!active) return;
        setSelectedCharity(beneficiary); setCampaignMessage(`You're supporting ${beneficiary.name}.`);
      })
      .catch((error: Error) => {
        if (!active) return;
        setCampaignMessage(error.message); setCampaignSlug(null);
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
      })
      .finally(() => { if (active) setCampaignLoading(false); });
    return () => { active = false; };
  }, [campaignSlug]);
  const totals = useMemo(
      () =>
        devices.reduce(
          (s, d) => {
            const v = estimate(d);
            return { low: s.low + v.low, high: s.high + v.high };
          },
          { low: 0, high: 0 },
        ),
      [devices],
    ),
    updateDevice = <K extends keyof Device>(
      id: string,
      key: K,
      value: Device[K],
    ) => {
      setDevices((c) =>
        c.map((d) => (d.id === id ? { ...d, [key]: value } : d)),
      );
      setRecord(null);
    },
    addDevice = () =>
      setDevices((c) => [...c, makeDevice(`phone-${Date.now()}`)]),
    removeDevice = (id: string) =>
      setDevices((c) => c.filter((d) => d.id !== id)),
    updateDonor = <K extends keyof DonorDetails>(
      key: K,
      value: DonorDetails[K],
    ) => {
      setDonor((c) => ({ ...c, [key]: value }));
      setRecord(null);
    },
    updateCountry = (country: string) => {
      setDonor((current) => ({
        ...current,
        country,
        state: country === "US" ? "FL" : "",
        zip: "",
      }));
      setRecord(null);
    },
    updateCharity = (c: SelectedCharity | null) => {
      setSelectedCharity(c);
      // A campaign handoff notice only describes the verified campaign
      // beneficiary. Clear it as soon as the donor leaves that context so a
      // normal charity search cannot appear to retain campaign attribution.
      setCampaignMessage("");
      if (!c && campaignSlug) {
        setCampaignSlug(null);
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
      }
      setCharityError("");
      setRecord(null);
    },
    saveDraft = () => {
      localStorage.setItem(
        "donate-by-mail-draft",
        serializeDonationDraft({
          devices,
          selectedCharity,
          step,
        }),
      );
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 1800);
    },
    loadDraft = () => {
      const saved = localStorage.getItem("donate-by-mail-draft");
      if (!saved) return;
      try {
        const d = parseDonationDraft<Device, SelectedCharity>(saved);
        if (d.devices?.length) setDevices(d.devices);
        // A campaign handoff owns the beneficiary.  Restoring a normal draft
        // may restore device details and progress, never overwrite that
        // verified campaign selection or attribution.
        if (d.selectedCharity && !campaignSlug) setSelectedCharity(d.selectedCharity);
        if (d.step && (!campaignSlug || selectedCharity)) setStep(Math.min(3, Math.max(1, d.step)));
      } catch {
        localStorage.removeItem("donate-by-mail-draft");
      }
    },
    submit = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitError("");
      if (!selectedCharity) {
        setCharityError(
          "Please select the charity you would like your donation to support.",
        );
        requestAnimationFrame(() => charityRef.current?.focus());
        return;
      }
      if (TURNSTILE_SITE_KEY && !turnstileToken) {
        setSubmitError("Please complete the security verification and try again.");
        return;
      }
      const intent = { donor, shippingMethod, devices, charity: selectedCharity,
        campaignSlug: campaignSlug || undefined };
      const fingerprint = submissionIntentFingerprint(intent);
      submissionAttempt.current = resolveSubmissionAttempt(
        submissionAttempt.current, fingerprint, donor.marketingEmailConsent,
        () => crypto.randomUUID(), donationId, () => new Date().toISOString(),
      );
      const attempt = submissionAttempt.current;
      const next: DonationSubmission = {
        id: attempt.id,
        clientSubmissionKey: attempt.key,
        createdAt: attempt.createdAt,
        donor: {
          ...donor,
          marketingConsentAt: attempt.marketingConsentAt,
        },
        shippingMethod,
        devices: devices.map((d) => ({ ...d })),
        charity: selectedCharity,
        campaignSlug: campaignSlug || undefined,
      };
      setSubmitting(true);
      try {
        const response = await sendDonation(next, turnstileToken),
          final = {
            ...next,
            id: response.donationId || next.id,
            createdAt: response.createdAt || next.createdAt,
            charity: response.charity || next.charity,
          };
        setSelectedCharity(final.charity);
        setRecord(final);
        setTrackingLink(response.trackingUrl || "");
        setNotificationPending(Boolean(response.notificationPending));
        setStep(4);
        trackEvent("donation_packet_created", {
          device_count: next.devices.length,
          shipping_method: next.shippingMethod,
          selected_charity: Boolean(next.charity.pledgeId),
        });
        submissionAttempt.current = null;
        localStorage.removeItem("donate-by-mail-draft");
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "We could not send the donation packet. Please try again.",
        );
      } finally {
        turnstileResetRef.current?.();
        setTurnstileToken("");
        setSubmitting(false);
      }
    },
    printDocument = () => {
      document.body.setAttribute("data-print-target", "packing");
      setTimeout(() => window.print(), 50);
    };
  return (
    <div className="page">
      <Header />
      <main className="donation-main">
        <div className="flow-shell">
          <Progress step={step} />
          {step === 1 && (
            <section className="flow-card">
              <div className="flow-heading">
                <p className="kicker">Describe the phone</p>
                <h1>What phone would you like to donate?</h1>
                <p>
                  Use the best information you have. Exact details can be
                  confirmed after arrival.
                </p>
              </div>
              <div className="device-stack">
                {devices.map((d, i) => (
                  <article className="device-form" key={d.id}>
                    <div className="device-title">
                      <h2>Phone {i + 1}</h2>
                      {devices.length > 1 && (
                        <button
                          className="icon-action"
                          onClick={() => removeDevice(d.id)}
                          aria-label={`Remove phone ${i + 1}`}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </div>
                    <div className="form-grid">
                      <FieldSelect
                        label="Brand"
                        value={d.brand}
                        options={brands}
                        onChange={(v) =>
                          updateDevice(d.id, "brand", v as Brand)
                        }
                      />
                      <label className="field">
                        <span>Model, if known</span>
                        <input
                          value={d.model}
                          onChange={(e) =>
                            updateDevice(d.id, "model", e.target.value)
                          }
                          placeholder="Example: iPhone 13"
                        />
                      </label>
                      <FieldSelect
                        label="Approximate age"
                        value={d.age}
                        options={ages}
                        onChange={(v) => updateDevice(d.id, "age", v as Age)}
                      />
                      <FieldSelect
                        label="Condition"
                        value={d.condition}
                        options={conditions}
                        onChange={(v) =>
                          updateDevice(d.id, "condition", v as Condition)
                        }
                      />
                      <FieldSelect
                        label="Storage"
                        value={d.storage}
                        options={storageOptions}
                        onChange={(v) =>
                          updateDevice(d.id, "storage", v as Storage)
                        }
                      />
                      <div className="check-group">
                        <label>
                          <input
                            type="checkbox"
                            checked={d.powersOn}
                            onChange={(e) =>
                              updateDevice(d.id, "powersOn", e.target.checked)
                            }
                          />
                          The phone powers on
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={d.unlocked}
                            onChange={(e) =>
                              updateDevice(d.id, "unlocked", e.target.checked)
                            }
                          />
                          The phone is carrier-unlocked
                        </label>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <button className="add-button" onClick={addDevice}>
                <Plus />
                Add another phone
              </button>
              <p className="inline-help">
                <HelpCircle />
                Not sure which model you have?{" "}
                <a href="/prepare-phone.html#find-model">
                  See how to find it.
                </a>
              </p>
              <div className="flow-actions">
                <span />
                <button className="button primary" onClick={() => setStep(2)}>
                  See my estimate <ArrowRight />
                </button>
              </div>
            </section>
          )}
          {step === 2 && (
            <section className="flow-card estimate-step">
              <div className="flow-heading">
                <p className="kicker">Planning estimate</p>
                <h1>Your estimated device value</h1>
                <p>
                  This range helps explain potential resale proceeds. It is not
                  a tax appraisal or guaranteed sale amount.
                </p>
              </div>
              <div className="estimate-total">
                <span>Estimated combined value</span>
                <strong>
                  {money(totals.low)} - {money(totals.high)}
                </strong>
                <small>
                  Before inspection, resale expenses, and market changes.
                </small>
              </div>
              <div className="summary-list">
                {devices.map((d, i) => {
                  const v = estimate(d);
                  return (
                    <div key={d.id}>
                      <span>
                        <Smartphone />
                        {d.brand} {d.model || `phone ${i + 1}`}
                      </span>
                      <strong>
                        {money(v.low)} - {money(v.high)}
                      </strong>
                    </div>
                  );
                })}
              </div>
              <div className="plain-notice">
                <ShieldCheck />
                <p>
                  <strong>
                    The charitable acknowledgment will not list this estimate.
                  </strong>{" "}
                  Donors are responsible for determining and substantiating any
                  fair market value claimed for tax purposes.
                </p>
              </div>
              <div className="flow-actions">
                <button className="button text" onClick={() => setStep(1)}>
                  <ArrowLeft />
                  Back
                </button>
                <button className="button primary" onClick={() => setStep(3)}>
                  Continue to charity and mailing details <ArrowRight />
                </button>
              </div>
            </section>
          )}
          {step === 3 && (
            <section className="flow-card">
              <div className="flow-heading">
                <p className="kicker">Charity and donor details</p>
                <h1>{campaignSlug && selectedCharity ? `Support ${selectedCharity.name} and create your mailing documents.` : "Choose a charity and create your mailing documents."}</h1>
                <p>{campaignSlug && selectedCharity ? "Your campaign nonprofit is already selected and stays attached to this donation packet." : "Your selected charity stays attached to this donation packet."}</p>
              </div>
              <form onSubmit={submit}>
                {campaignLoading && <p className="widget-status" role="status">Loading the campaign nonprofit…</p>}
                {campaignMessage && <p className={campaignSlug ? "plain-notice" : "widget-error"} role={campaignSlug ? "status" : "alert"}>{campaignMessage}</p>}
                <div
                  ref={charityRef}
                  tabIndex={-1}
                  aria-describedby={charityError ? "charity-error" : undefined}
                >
                  <CharitySelector
                    selected={selectedCharity}
                    onChange={updateCharity}
                    error={charityError}
                    revision={revision}
                    campaignLocked={Boolean(campaignSlug)}
                  />
                </div>
                <div className="form-grid donor-grid">
                  <label className="field">
                    <span>First name</span>
                    <input
                      required
                      autoComplete="given-name"
                      value={donor.firstName}
                      onChange={(e) => updateDonor("firstName", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Middle name <em>optional</em>
                    </span>
                    <input
                      autoComplete="additional-name"
                      value={donor.middleName}
                      onChange={(e) =>
                        updateDonor("middleName", e.target.value)
                      }
                    />
                  </label>
                  <label className="field full">
                    <span>Last name</span>
                    <input
                      required
                      autoComplete="family-name"
                      value={donor.lastName}
                      onChange={(e) => updateDonor("lastName", e.target.value)}
                    />
                  </label>
                  <label className="field full">
                    <span>Country</span>
                    <select
                      required
                      autoComplete="country"
                      value={donor.country}
                      onChange={(e) => updateCountry(e.target.value)}
                    >
                      {countries.map((country) => (
                        <option value={country.code} key={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field full">
                    <span>Email address</span>
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      value={donor.email}
                      onChange={(e) => updateDonor("email", e.target.value)}
                    />
                  </label>
                  <label className="field full">
                    <span>Street address</span>
                    <input
                      required
                      autoComplete="address-line1"
                      value={donor.address1}
                      onChange={(e) => updateDonor("address1", e.target.value)}
                    />
                  </label>
                  <label className="field full">
                    <span>
                      Apartment, suite, or unit <em>optional</em>
                    </span>
                    <input
                      autoComplete="address-line2"
                      value={donor.address2}
                      onChange={(e) => updateDonor("address2", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>City</span>
                    <input
                      required
                      autoComplete="address-level2"
                      value={donor.city}
                      onChange={(e) => updateDonor("city", e.target.value)}
                    />
                  </label>
                  {donor.country === "US" ? (
                    <FieldSelect
                      label="State"
                      value={donor.state}
                      options={states}
                      onChange={(v) => updateDonor("state", v)}
                    />
                  ) : (
                    <label className="field">
                      <span>
                        State, province, or region <em>optional</em>
                      </span>
                      <input
                        autoComplete="address-level1"
                        value={donor.state}
                        onChange={(e) => updateDonor("state", e.target.value)}
                      />
                    </label>
                  )}
                  <label className="field">
                    <span>
                      {donor.country === "US" ? "ZIP code" : "Postal code"}
                      {donor.country !== "US" && <em> optional</em>}
                    </span>
                    <input
                      required={donor.country === "US"}
                      inputMode={donor.country === "US" ? "numeric" : "text"}
                      pattern={
                        donor.country === "US"
                          ? "[0-9]{5}(-[0-9]{4})?"
                          : undefined
                      }
                      autoComplete="postal-code"
                      value={donor.zip}
                      onChange={(e) => updateDonor("zip", e.target.value)}
                    />
                  </label>
                </div>
                <div className="plain-notice">
                  <Mail />
                  <p>
                    <strong>Use your own packaging and pay for postage.</strong>
                    <br />
                    Your printable documents will include this destination:
                    <br />
                    {DONATE_BY_MAIL_ADDRESS.map((line) => (
                      <span key={line}>
                        {line}
                        <br />
                      </span>
                    ))}
                  </p>
                </div>
                <label className="required-check">
                  <input required type="checkbox" />
                  <span>
                    I have backed up anything I want to keep, signed out of
                    accounts, removed activation locks and SIM cards when
                    possible, and I will not include passwords or passcodes.{" "}
                    <a href="/prepare-phone.html">Review preparation steps</a>.
                  </span>
                </label>
                <label className="required-check">
                  <input
                    type="checkbox"
                    checked={donor.marketingEmailConsent}
                    onChange={(e) =>
                      updateDonor("marketingEmailConsent", e.target.checked)
                    }
                  />
                  <span>
                    <strong>Optional email updates.</strong> I would like to
                    receive occasional news and updates from Donate by Mail. I
                    can unsubscribe at any time. Essential emails about this
                    donation, including its confirmation and status, are sent
                    regardless of this optional choice.
                  </span>
                </label>
                <div className="draft-actions">
                  <button type="button" onClick={saveDraft}>
                    {draftSaved ? "Draft saved" : "Save device and charity progress"}
                  </button>
                  <button type="button" onClick={loadDraft}>
                    Restore saved draft
                  </button>
                </div>
                {TURNSTILE_SITE_KEY && (
                  <TurnstileWidget
                    onToken={setTurnstileToken}
                    onResetReady={registerTurnstileReset}
                  />
                )}
                {submitError && (
                  <p className="submit-error" role="alert">
                    {submitError}
                  </p>
                )}
                <div className="flow-actions">
                  <button
                    type="button"
                    className="button text"
                    onClick={() => setStep(2)}
                  >
                    <ArrowLeft />
                    Back
                  </button>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={submitting}
                  >
                    {submitting
                      ? "Sending donation packet…"
                      : "Create donation packet"}{" "}
                    {!submitting && <ArrowRight />}
                  </button>
                </div>
                <p className="prototype-note">
                  Drafts stay in this browser. When you create the packet, the
                  donor, phone, mailing, and selected-charity details are sent
                  to Donate by Mail. This feature does not send money through
                  Pledge.
                </p>
              </form>
            </section>
          )}
          {step === 4 && record && (
            <section className="flow-card document-step">
              <div className="success-heading">
                <CheckCircle2 />
                <div>
                  <p className="kicker">Donation packet sent</p>
                  <h1>Your documents are ready.</h1>
                  <p>
                    Donation ID: <strong>{record.id}</strong>
                  </p>
                  <p>
                    Selected charity: <strong>{record.charity.name}</strong>
                  </p>
                  {trackingLink && (
                    <p><a href={trackingLink}>Track this donation</a></p>
                  )}
                  {notificationPending && (
                    <p role="status">Your donation is saved. Email delivery is queued for retry.</p>
                  )}
                </div>
              </div>
              <div className="document-steps" aria-label="Next steps">
                <div>
                  <ClipboardCheck />
                  <span>
                    <strong>1. Put the packing slip inside</strong>
                    <small>Use the first page to identify your donation.</small>
                  </span>
                </div>
                <div>
                  <Mail />
                  <span>
                    <strong>2. Attach the shipping label outside</strong>
                    <small>
                      Use the second page on the exterior of the box.
                    </small>
                  </span>
                </div>
              </div>
              <PackingSlip record={record} onPrint={printDocument} />
              <div className="flow-actions">
                <button
                  className="button text"
                  onClick={() => {
                    setStep(3);
                    setRevision((v) => v + 1);
                  }}
                >
                  <ArrowLeft />
                  Edit details
                </button>
                <a className="button secondary" href="/receipts.html">
                  Understand these documents
                </a>
              </div>
            </section>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
function PackingSlip({
  record,
  onPrint,
}: {
  record: DonationSubmission;
  onPrint: () => void;
}) {
  const date = new Date(record.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    location = charityLocation(record.charity);
  return (
    <div className="document-wrap">
      <div className="document-toolbar">
        <div>
          <strong>Packing slip and shipping label</strong>
          <span>Print both pages, then follow the placement instructions.</span>
        </div>
        <button className="button secondary" onClick={onPrint}>
          <Printer />
          Print or save PDF
        </button>
      </div>
      <article id="packing-document" className="print-document document-bundle">
        <section className="document-page packing-slip-page">
          <div className="doc-rule" />
          <header>
            <DocumentLogo />
            <div>
              <small>Donation ID</small>
              <strong>{record.id}</strong>
              <span>Created {date}</span>
            </div>
          </header>
          <h1>Packing slip</h1>
          <p className="document-instruction">
            Print this page and place it inside the package.
          </p>
          <section className="doc-two">
            <div>
              <h2>Donor</h2>
              <p>
                <strong>{donorFullName(record.donor)}</strong>
                <br />
                {record.donor.email}
              </p>
            </div>
            <div>
              <h2>Selected charity</h2>
              <p>
                <strong>{record.charity.name}</strong>
                <br />
                Pledge ID: {record.charity.pledgeId}
                <br />
                {record.charity.ein && (
                  <>
                    EIN: {record.charity.ein}
                    <br />
                  </>
                )}
                {location !== "Not provided" && location}
              </p>
            </div>
          </section>
          <section>
            <h2>Devices enclosed</h2>
            {record.devices.map((d, i) => (
              <p className="device-line" key={d.id}>
                {describeDevice(d, i)}
              </p>
            ))}
          </section>
          <section className="doc-checks">
            <div>
              <h2>Before sealing the box</h2>
              <p>
                □ Remove SIM and memory cards
                <br />□ Turn off activation locks
                <br />□ Factory reset when possible
                <br />□ Do not include passcodes
              </p>
            </div>
            <div>
              <h2>For Donate by Mail staff</h2>
              <p>
                □ Package received
                <br />□ Device count confirmed
                <br />□ Selected charity confirmed
                <br />□ Donation record updated
              </p>
            </div>
          </section>
          <p className="doc-note">
            This packing slip is not a charitable contribution acknowledgment.
            Donate by Mail does not assign a fair market value to the donated
            property. The donor is responsible for determining and
            substantiating any charitable deduction.
          </p>
        </section>
        <section className="document-page shipping-label-page">
          <div className="doc-rule" />
          <header>
            <DocumentLogo />
            <div>
              <small>Donation ID</small>
              <strong>{record.id}</strong>
              <span>Shipping label</span>
            </div>
          </header>
          <h1>Shipping label</h1>
          <p className="document-instruction">
            Cut out the label below and attach it securely to the outside of the
            package. You are responsible for purchasing postage.
          </p>
          <section className="shipping-label-card">
            <div className="return-address">
              <small>FROM</small>
              <p>
                <strong>{donorFullName(record.donor)}</strong>
                <br />
                {record.donor.address1}
                <br />
                {record.donor.address2 && (
                  <>
                    {record.donor.address2}
                    <br />
                  </>
                )}
                {record.donor.city}
                {record.donor.state ? `, ${record.donor.state}` : ""}{" "}
                {record.donor.zip}
                <br />
                {countryName(record.donor.country)}
              </p>
            </div>
            <div className="destination-address">
              <small>SHIP TO</small>
              <p>
                {DONATE_BY_MAIL_ADDRESS.map((line, index) => (
                  <span key={line}>
                    {index === 0 ? <strong>{line}</strong> : line}
                    <br />
                  </span>
                ))}
              </p>
            </div>
            <p className="label-reference">Donation ID: {record.id}</p>
          </section>
        </section>
      </article>
    </div>
  );
}
function App() {
  const path = window.location.pathname.toLowerCase();
  if (path === "/track" || path === "/track/")
    return <div className="page"><Header /><TrackingPage /><Footer /></div>;
  if (path === "/staff" || path === "/staff/")
    return <div className="page"><Header /><StaffPage /><Footer /></div>;
  if (path === "/account" || path === "/account/")
    return <div className="page"><Header /><DonorAccountPage /><Footer /></div>;
  if (path === "/login" || path === "/login/")
    return <div className="page"><Header /><AccountGatewayPage /><Footer /></div>;
  if (path === "/settings" || path === "/settings/")
    return <div className="page"><Header /><AccountSettingsPage /><Footer /></div>;
  if (path === "/partner" || path === "/partner/")
    return <div className="page"><Header /><PartnerPage /><Footer /></div>;
  if (path === "/articles" || path === "/articles/" || path === "/articles.html")
    return <div className="page"><Header /><ArticlesPage /><Footer /></div>;
  const articleMatch = path.match(/^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (articleMatch)
    return <div className="page"><Header /><ArticlesPage slug={articleMatch[1]} /><Footer /></div>;
  const campaignMatch = path.match(/^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (campaignMatch)
    return <div className="page"><Header /><CampaignPage slug={campaignMatch[1]} /><Footer /></div>;
  return path.endsWith("/donate-phone") ||
    path.endsWith("/donate-phone.html") ||
    path.endsWith("donate-phone.html") ? (
    <DonationPage />
  ) : (
    <HomePage />
  );
}
export default App;
