export type PledgeEnvironment = 'production' | 'sandbox';

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
  | { type: 'selected'; charity: SelectedCharity }
  | { type: 'removed' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPledgeUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function getPledgeWidgetConfig(partnerKey: string, environment: PledgeEnvironment = 'production') {
  const host = environment === 'sandbox' ? 'https://staging.pledge.to' : 'https://www.pledge.to';
  return {
    partnerKey: partnerKey.trim(),
    scriptUrl: `${host}/embed/widget.js`,
    allowedOrigin: host,
    multipleOrganizations: false,
  };
}

export function parsePledgeMessage(
  event: Pick<MessageEvent, 'origin' | 'data'>,
  environment: PledgeEnvironment = 'production',
): PledgeSelectionAction | null {
  const { allowedOrigin } = getPledgeWidgetConfig('', environment);
  if (event.origin !== allowedOrigin) return null;

  let message: unknown = event.data;
  if (typeof message === 'string') {
    try {
      message = JSON.parse(message);
    } catch {
      return null;
    }
  }

  const envelope = object(message);
  if (!envelope || typeof envelope.action !== 'string') return null;
  if (envelope.action === 'removeEvent') return { type: 'removed' };
  if (envelope.action !== 'updateEvent') return null;

  const data = object(envelope.data);
  if (!data) return null;
  if (data.beneficiary_type && data.beneficiary_type !== 'Organization') return null;

  const pledgeId = text(data.beneficiary_uuid) ?? text(data.organization_id) ?? text(data.id);
  if (!isPledgeUuid(pledgeId)) return null;

  const nestedOrganization = object(data.organization);
  const nestedBeneficiary = object(data.beneficiary);
  const charity: SelectedCharity = {
    pledgeId,
    name:
      text(data.organization_name) ??
      text(data.beneficiary_name) ??
      text(data.name) ??
      text(nestedOrganization?.name) ??
      text(nestedBeneficiary?.name) ??
      'Selected Pledge nonprofit',
    ein:
      text(data.ein) ??
      text(data.ngo_id) ??
      text(nestedOrganization?.ein) ??
      text(nestedOrganization?.ngo_id) ??
      text(nestedBeneficiary?.ein) ??
      text(nestedBeneficiary?.ngo_id),
    city: text(data.city) ?? text(nestedOrganization?.city) ?? text(nestedBeneficiary?.city),
    state:
      text(data.state) ??
      text(data.region) ??
      text(nestedOrganization?.state) ??
      text(nestedOrganization?.region) ??
      text(nestedBeneficiary?.state) ??
      text(nestedBeneficiary?.region),
    country:
      text(data.country) ??
      text(data.country_code) ??
      text(nestedOrganization?.country) ??
      text(nestedOrganization?.country_code) ??
      text(nestedBeneficiary?.country) ??
      text(nestedBeneficiary?.country_code),
    logoUrl: text(data.logo_url) ?? text(nestedOrganization?.logo_url) ?? text(nestedBeneficiary?.logo_url),
    websiteUrl:
      text(data.website_url) ??
      text(data.website) ??
      text(nestedOrganization?.website_url) ??
      text(nestedOrganization?.website) ??
      text(nestedBeneficiary?.website_url) ??
      text(nestedBeneficiary?.website),
  };

  return { type: 'selected', charity };
}

export function pledgeSelectionReducer(
  current: SelectedCharity | null,
  action: PledgeSelectionAction,
): SelectedCharity | null {
  return action.type === 'removed' ? null : action.charity;
}

export function mergeCharityDetails(
  current: SelectedCharity,
  details: Partial<SelectedCharity>,
): SelectedCharity {
  if (details.pledgeId && details.pledgeId !== current.pledgeId) return current;
  return {
    ...current,
    ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== '')),
    pledgeId: current.pledgeId,
  };
}
