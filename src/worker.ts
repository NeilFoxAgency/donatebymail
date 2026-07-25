import { buildAdministratorNotification, validateDonationSubmission, type DonationSubmission } from './submission';
import type { SelectedCharity } from './pledge';

type AssetsBinding = { fetch(request: Request): Promise<Response> };
type EmailBinding = {
  send(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
};

type Env = {
  ASSETS: AssetsBinding;
  ADMIN_EMAIL?: EmailBinding;
  ADMIN_NOTIFICATION_FROM?: string;
  ADMIN_NOTIFICATION_TO?: string;
  PLEDGE_API_KEY?: string;
};

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeOrganization(value: Record<string, unknown>, pledgeId: string): SelectedCharity {
  return {
    pledgeId,
    name: stringValue(value.name) ?? stringValue(value.organization_name) ?? 'Selected Pledge nonprofit',
    ein: stringValue(value.ngo_id) ?? stringValue(value.ein),
    city: stringValue(value.city),
    state: stringValue(value.region) ?? stringValue(value.state),
    country: stringValue(value.country) ?? stringValue(value.country_code),
    logoUrl: stringValue(value.logo_url) ?? stringValue(value.logo),
    websiteUrl: stringValue(value.website_url) ?? stringValue(value.website),
  };
}

async function lookupOrganization(pledgeId: string, env: Env): Promise<SelectedCharity | null> {
  if (!env.PLEDGE_API_KEY) return null;
  const response = await fetch(`https://api.pledge.to/v1/organizations/${encodeURIComponent(pledgeId)}`, {
    headers: {
      authorization: `Bearer ${env.PLEDGE_API_KEY}`,
      accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const body = await response.json() as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return normalizeOrganization(body as Record<string, unknown>, pledgeId);
}

async function handleOrganizationLookup(request: Request, env: Env, pledgeId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, message: 'Request not allowed.' }, 403);
  if (!/^[0-9a-f-]{36}$/i.test(pledgeId)) return json({ ok: false, message: 'Invalid organization ID.' }, 400);
  if (!env.PLEDGE_API_KEY) {
    return json({ ok: false, code: 'lookup_not_configured', message: 'Organization details lookup is not configured.' }, 503);
  }
  try {
    const charity = await lookupOrganization(pledgeId, env);
    return charity
      ? json({ ok: true, charity })
      : json({ ok: false, message: 'Organization details were not found.' }, 404);
  } catch {
    return json({ ok: false, message: 'Organization details could not be loaded.' }, 502);
  }
}

async function handleDonationSubmission(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, message: 'Request not allowed.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ ok: false, message: 'Expected a JSON request.' }, 415);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 100_000) return json({ ok: false, message: 'Submission is too large.' }, 413);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'The submission could not be read.' }, 400);
  }
  if (!validateDonationSubmission(payload)) {
    return json({ ok: false, message: 'Please review the donation information and try again.' }, 400);
  }
  if (!env.ADMIN_EMAIL) {
    return json({ ok: false, message: 'Administrator notifications are not configured yet.' }, 503);
  }

  let record: DonationSubmission = payload;
  try {
    const verifiedCharity = await lookupOrganization(record.charity.pledgeId, env);
    if (verifiedCharity) record = { ...record, charity: verifiedCharity };
  } catch {
    // The selected Pledge UUID remains authoritative even when optional metadata lookup is unavailable.
  }

  const to = env.ADMIN_NOTIFICATION_TO || 'satoshi@donatebymail.org';
  const from = env.ADMIN_NOTIFICATION_FROM || 'notifications@donatebymail.org';
  try {
    await env.ADMIN_EMAIL.send({
      from,
      to,
      subject: `Phone donation ${record.id} for ${record.charity.name}`,
      text: buildAdministratorNotification(record),
    });
  } catch {
    return json({ ok: false, message: 'We could not notify Donate by Mail. Please try again.' }, 502);
  }

  return json({ ok: true, donationId: record.id, charity: record.charity }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/donations') {
      return handleDonationSubmission(request, env);
    }
    const organizationMatch = url.pathname.match(/^\/api\/pledge\/organizations\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && organizationMatch) {
      return handleOrganizationLookup(request, env, organizationMatch[1]);
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, message: 'Not found.' }, 404);
    return env.ASSETS.fetch(request);
  },
};
