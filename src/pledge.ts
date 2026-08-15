export type PledgeEnvironment = "production" | "sandbox";
export type SelectedCharity = {
  pledgeId: string;
  name: string;
  ein?: string;
  city?: string;
  state?: string;
  country?: string;
  logoUrl?: string;
  websiteUrl?: string;
};
export type PledgeSelectionAction =
  | { type: "selected"; charity: SelectedCharity }
  | { type: "removed" };

/**
 * Resolve the Pledge environment without relying on a separate browser build
 * for beta and production. The deployment publishes one static asset bundle
 * to both custom-domain environments, so the hostname is the safe default
 * when no explicit build override is present.
 */
export function resolvePledgeEnvironment(
  configured: unknown,
  hostname = "",
): PledgeEnvironment {
  if (configured === "sandbox") return "sandbox";
  if (configured === "production") return "production";
  return hostname.toLowerCase() === "beta.donatebymail.org" ? "sandbox" : "production";
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isPledgeUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value.trim());
const text = (value: unknown) =>
  typeof value === "string" && value.trim() && value.length <= 1000
    ? value.trim()
    : undefined;
const bounded = (value: unknown, maximum: number) => {
  const candidate = text(value);
  return candidate && candidate.length <= maximum ? candidate : undefined;
};
const safeCountry = (value: unknown) => {
  const candidate = bounded(value, 2)?.toUpperCase();
  return candidate && /^[A-Z]{2}$/.test(candidate) ? candidate : undefined;
};
const safeUrl = (value: unknown) => {
  const candidate = text(value);
  if (!candidate || candidate.length > 1000) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export function getPledgeWidgetConfig(
  partnerKey: string,
  environment: PledgeEnvironment = "production",
) {
  const host =
    environment === "sandbox" ? "https://staging.pledge.to" : "https://www.pledge.to";
  return {
    partnerKey: partnerKey.trim(),
    scriptUrl: `${host}/embed/widget.js`,
    allowedOrigin: host,
    multipleOrganizations: false,
  };
}

export function parsePledgeMessage(
  event: Pick<MessageEvent, "origin" | "data">,
  environment: PledgeEnvironment = "production",
): PledgeSelectionAction | null {
  const { allowedOrigin } = getPledgeWidgetConfig("", environment);
  if (event.origin !== allowedOrigin) return null;
  let message: unknown = event.data;
  if (typeof message === "string") {
    try {
      message = JSON.parse(message);
    } catch {
      return null;
    }
  }
  const envelope = object(message);
  if (!envelope || typeof envelope.action !== "string") return null;
  if (envelope.action === "removeEvent") return { type: "removed" };
  if (envelope.action !== "updateEvent") return null;
  const data = object(envelope.data);
  if (!data || (data.beneficiary_type && data.beneficiary_type !== "Organization")) return null;
  const pledgeId = text(data.beneficiary_uuid) ?? text(data.organization_id) ?? text(data.id);
  if (!isPledgeUuid(pledgeId)) return null;
  const org = object(data.organization);
  const beneficiary = object(data.beneficiary);
  const name = bounded(data.organization_name, 240)
    ?? bounded(data.beneficiary_name, 240)
    ?? bounded(data.name, 240)
    ?? bounded(org?.name, 240)
    ?? bounded(beneficiary?.name, 240)
    ?? "Selected Pledge nonprofit";
  return {
    type: "selected",
    charity: {
      pledgeId,
      name,
      ein: bounded(data.ein, 32) ?? bounded(data.ngo_id, 32) ?? bounded(org?.ein, 32) ?? bounded(org?.ngo_id, 32) ?? bounded(beneficiary?.ein, 32) ?? bounded(beneficiary?.ngo_id, 32),
      city: bounded(data.city, 160) ?? bounded(org?.city, 160) ?? bounded(beneficiary?.city, 160),
      state: bounded(data.state, 160) ?? bounded(data.region, 160) ?? bounded(org?.state, 160) ?? bounded(org?.region, 160) ?? bounded(beneficiary?.state, 160) ?? bounded(beneficiary?.region, 160),
      country: safeCountry(data.country) ?? safeCountry(data.country_code) ?? safeCountry(org?.country) ?? safeCountry(org?.country_code) ?? safeCountry(beneficiary?.country) ?? safeCountry(beneficiary?.country_code),
      logoUrl: safeUrl(data.logo_url) ?? safeUrl(org?.logo_url) ?? safeUrl(beneficiary?.logo_url),
      websiteUrl: safeUrl(data.website_url) ?? safeUrl(data.website) ?? safeUrl(org?.website_url) ?? safeUrl(org?.website) ?? safeUrl(beneficiary?.website_url) ?? safeUrl(beneficiary?.website),
    },
  };
}

export const pledgeSelectionReducer = (
  _current: SelectedCharity | null,
  action: PledgeSelectionAction,
): SelectedCharity | null => action.type === "removed" ? null : action.charity;

export function mergeCharityDetails(
  current: SelectedCharity,
  details: Partial<SelectedCharity>,
): SelectedCharity {
  if (details.pledgeId && details.pledgeId !== current.pledgeId) return current;
  const candidate = { ...current, ...details, pledgeId: current.pledgeId };
  return {
    ...candidate,
    name: bounded(candidate.name, 240) ?? current.name,
    ein: bounded(candidate.ein, 32),
    city: bounded(candidate.city, 160),
    state: bounded(candidate.state, 160),
    country: safeCountry(candidate.country),
    logoUrl: safeUrl(candidate.logoUrl),
    websiteUrl: safeUrl(candidate.websiteUrl),
  };
}
