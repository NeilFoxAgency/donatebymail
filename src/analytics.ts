declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const configuredMeasurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
// Only accept the GA4 measurement-ID shape. This keeps deployment configuration
// from becoming an arbitrary script URL or selector value.
const measurementId = configuredMeasurementId && /^G-[A-Z0-9]{4,}$/i.test(configuredMeasurementId)
  ? configuredMeasurementId
  : undefined;
const consentKey = 'dbm-analytics-consent';

export const analyticsEnabled = Boolean(measurementId);

export function getAnalyticsConsent(): 'granted' | 'denied' | null {
  if (!analyticsEnabled) return 'denied';
  const value = window.localStorage.getItem(consentKey);
  return value === 'granted' || value === 'denied' ? value : null;
}

export function setAnalyticsConsent(value: 'granted' | 'denied') {
  window.localStorage.setItem(consentKey, value);
  if (value === 'granted') initializeAnalytics();
}

export function initializeAnalytics() {
  if (!measurementId || getAnalyticsConsent() !== 'granted') return;
  if (document.querySelector(`script[data-ga4='${measurementId}']`)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = (...args: unknown[]) => window.dataLayer?.push(args);
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    anonymize_ip: true,
    send_page_view: false,
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  script.dataset.ga4 = measurementId;
  document.head.appendChild(script);
}

export function trackPage(path: string, title: string) {
  if (!measurementId || getAnalyticsConsent() !== 'granted') return;
  window.gtag?.('event', 'page_view', {
    page_path: path,
    page_title: title,
  });
}

export function trackEvent(name: string, parameters: Record<string, string | number | boolean> = {}) {
  if (!measurementId || getAnalyticsConsent() !== 'granted') return;
  // gtag queues the event in the same dataLayer used during initialization.
  // Do not also push a second object: that causes duplicate GA4 conversions.
  window.gtag?.('event', name, parameters);
}
