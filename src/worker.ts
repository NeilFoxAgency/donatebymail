import {
  buildAdministratorNotification,
  buildBetaAdministratorNotification,
  buildDonorConfirmation,
  donorFullName,
  validateDonationSubmission,
  type DonationSubmission,
} from "./submission";
import type { SelectedCharity } from "./pledge";
import {
  claimUrl,
  createClaimToken,
  createTrackingToken,
  trackingUrl,
  verifyTrackingToken,
  verifyClaimToken,
} from "./gen2/tracking";
import { createClient } from "@supabase/supabase-js";
import { clearSessionCookie, constantTimeEqual, cookieValue, openSession, sealSession, sessionCookie, type BffSession } from "./gen2/bffSession";
import { isRiskLevel, isSemanticCommand, RISK_LEVELS } from "./gen2/commandRegistry";
import { canonicalAuthorizationInput } from "./gen2/authorizationFingerprint";

type BrevoRecipient = { email: string; name?: string };

type WorkerEnv = Env & {
  PLEDGE_API_KEY?: string;
  DEPLOYMENT_ENVIRONMENT?: "production" | "beta";
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  DONATION_TRACKING_SECRET?: string;
  AGENT_API_KEY?: string;
  BFF_SESSION_SECRET?: string;
};

type PersistedDonation = {
  created: boolean;
  donationId: string;
  publicId: string;
  createdAt: string;
  outboxEventId: string | null;
};

type TrackingMaterial = { donationId: string; trackingNonce: string; claimNonce?: string };
type SupabaseUser = { id: string; email?: string };
type NotificationPayload = {
  donationId: string;
  publicId: string;
  status: string;
  createdAt: string;
  trackingNonce: string;
  claimNonce: string;
  charityName: string;
  charityPledgeId: string;
  donor: DonationSubmission["donor"];
  devices: DonationSubmission["devices"];
};

type BrevoMessage = {
  to: BrevoRecipient[];
  subject: string;
  textContent: string;
  htmlContent: string;
  tag: string;
  idempotencyKey: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const requestSessions = new WeakMap<Request, BffSession>();
const refreshedCookies = new WeakMap<Request, string>();
const PENDING_CLAIM_COOKIE = "__Host-dbm_pending_claim";

function pendingClaimCookie(value: string, maxAge = 1200): string {
  return `${PENDING_CLAIM_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

class PkceStorage {
  values: Record<string, string>;
  constructor(values: Record<string, string> = {}) { this.values = { ...values }; }
  getItem(key: string) { return Promise.resolve(this.values[key] ?? null); }
  setItem(key: string, value: string) { this.values[key] = value; return Promise.resolve(); }
  removeItem(key: string) { delete this.values[key]; return Promise.resolve(); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function betaDataConfigured(env: WorkerEnv): boolean {
  return Boolean(
    env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY &&
      env.SUPABASE_SECRET_KEY && env.DONATION_TRACKING_SECRET,
  );
}

async function supabaseRpc<T>(
  env: WorkerEnv,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new Error("Beta database is not configured.");
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SECRET_KEY,
    "content-type": "application/json",
    accept: "application/json",
    "content-profile": "api",
    "accept-profile": "api",
  };
  // Legacy service-role JWTs require Authorization; modern sb_secret keys must
  // be sent only as apikey so the Supabase gateway assigns the service role.
  if (env.SUPABASE_SECRET_KEY.startsWith("eyJ"))
    headers.authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const diagnostic = (await response.text()).slice(0, 300).replace(/[\r\n]+/g, " ");
    console.error(JSON.stringify({
      event: "supabase_rpc_failed", functionName, status: response.status,
      host: new URL(env.SUPABASE_URL).hostname, diagnostic,
    }));
    throw new Error("The beta data service rejected the request.");
  }
  return (await response.json()) as T;
}

const CAMPAIGN_ASSET_MAX_BYTES = 5 * 1024 * 1024;
const CAMPAIGN_ASSET_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function storageObjectPath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function supabaseSecretHeaders(env: WorkerEnv, extra: Record<string, string> = {}): Record<string, string> {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("Beta storage is not configured.");
  const headers: Record<string, string> = { apikey: env.SUPABASE_SECRET_KEY, ...extra };
  if (env.SUPABASE_SECRET_KEY.startsWith("eyJ")) headers.authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;
  return headers;
}

async function uploadCampaignAsset(env: WorkerEnv, path: string, file: File): Promise<void> {
  if (!env.SUPABASE_URL) throw new Error("Beta storage is not configured.");
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/campaign-assets/${storageObjectPath(path)}`, {
    method: "POST",
    headers: supabaseSecretHeaders(env, {
      "cache-control": "3600",
      "content-type": file.type,
      "x-upsert": "false",
    }),
    body: file,
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "campaign_asset_upload_failed", status: response.status }));
    throw new Error("The campaign image could not be uploaded.");
  }
}

async function deleteCampaignAssetObject(env: WorkerEnv, path: string): Promise<void> {
  if (!env.SUPABASE_URL) return;
  await fetch(`${env.SUPABASE_URL}/storage/v1/object/campaign-assets/${storageObjectPath(path)}`, {
    method: "DELETE",
    headers: supabaseSecretHeaders(env),
  }).catch(() => undefined);
}

async function getCampaignAssetObject(env: WorkerEnv, path: string): Promise<Response> {
  if (!env.SUPABASE_URL) throw new Error("Beta storage is not configured.");
  return fetch(`${env.SUPABASE_URL}/storage/v1/object/campaign-assets/${storageObjectPath(path)}`, {
    headers: supabaseSecretHeaders(env, { accept: "*/*" }),
  });
}

async function authenticatedUser(request: Request, env: WorkerEnv): Promise<SupabaseUser | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.BFF_SESSION_SECRET)
    return null;
  const sealed = cookieValue(request.headers.get("cookie"));
  if (!sealed) return null;
  let session = await openSession(sealed, env.BFF_SESSION_SECRET);
  if (!session) return null;
  if (session.expiresAt <= Date.now() + 60_000) {
    const refresh = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!refresh.ok) return null;
    const refreshed = await refresh.json() as { access_token: string; refresh_token: string; expires_in: number };
    session = { ...session, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt: Date.now() + refreshed.expires_in * 1000 };
    refreshedCookies.set(request, sessionCookie(await sealSession(session, env.BFF_SESSION_SECRET)));
  }
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${session.accessToken}`,
      accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as SupabaseUser;
  if (!user?.id) return null;
  requestSessions.set(request, session);
  return user;
}

function csrfAllowed(request: Request): boolean {
  const session = requestSessions.get(request);
  return Boolean(session && sameOrigin(request) && constantTimeEqual(request.headers.get("x-csrf-token"), session.csrf));
}

async function supabaseUser(request: Request, env: WorkerEnv): Promise<SupabaseUser | null> {
  const user = await authenticatedUser(request, env);
  if (!user) return null;
  const active = await supabaseRpc<boolean>(env, "is_active_staff_user", {
    candidate_user_id: user.id,
  });
  return active ? user : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function safeSecretEqual(actual: string | null, expected?: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const [a, b] = await Promise.all([sha256Hex(actual), sha256Hex(expected)]);
  return a === b;
}

async function anonymousRateAllowed(request: Request, env: WorkerEnv, action: string, maximum: number, windowSeconds: number): Promise<boolean> {
  if (!env.DONATION_TRACKING_SECRET) return false;
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  const bucket = await sha256Hex(`rate:${env.DONATION_TRACKING_SECRET}:${action}:${address}`);
  return supabaseRpc<boolean>(env, "consume_anonymous_rate_limit", {
    bucket_hash_value: bucket, action_value: action, maximum_requests: maximum, window_seconds: windowSeconds,
  });
}

async function readJson(request: Request, maximumBytes = 100_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Expected a JSON request.");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maximumBytes) throw new Error("Request is too large.");
  return request.json();
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

function textEmailHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17324d;max-width:680px;margin:auto"><div style="border-top:6px solid #123b66;padding:24px"><div style="font-size:22px;font-weight:700;margin-bottom:20px">Donate by Mail</div><div>${escapeHtml(text).replace(/\n/g, "<br>")}</div></div></div>`;
}

async function sendBrevoEmail(
  env: WorkerEnv,
  message: BrevoMessage,
): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL,
        name: env.BREVO_SENDER_NAME,
      },
      to: message.to,
      replyTo: {
        email: env.REPLY_TO_EMAIL,
        name: env.BREVO_SENDER_NAME,
      },
      subject: message.subject,
      textContent: message.textContent,
      htmlContent: message.htmlContent,
      tags: [message.tag],
      headers: { "Idempotency-Key": message.idempotencyKey },
    }),
  });

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: "brevo_send_failed",
        status: response.status,
        tag: message.tag,
      }),
    );
    throw new Error("Brevo rejected the transactional email request.");
  }
}

function statusMessage(payload: NotificationPayload, link: string): string {
  const statusCopy: Record<string, string> = {
    submitted: "Your donation packet has been created.",
    in_transit: "Your donation is marked as in transit.",
    received: "Your package has arrived at Donate by Mail and is awaiting inspection.",
    inspecting: "Your donated devices are being inspected.",
    processing: "Your donated devices are being processed.",
    completed: "Processing for your donated devices is complete.",
    exception: "Your donation needs attention from our team.",
    cancelled: "This donation record has been cancelled.",
  };
  return [
    `Hello ${payload.donor.firstName},`,
    "",
    statusCopy[payload.status] ?? "Your donation status has been updated.",
    `Donation ID: ${payload.publicId}`,
    `Selected charity: ${payload.charityName}`,
    "",
    `View the latest status: ${link}`,
    "",
    "Donate by Mail will never ask for your phone passcode.",
  ].join("\n");
}

async function notificationPayload(
  env: WorkerEnv,
  donationId: string,
): Promise<NotificationPayload> {
  return supabaseRpc<NotificationPayload>(env, "get_donation_notification_payload", {
    candidate_donation_id: donationId,
  });
}

async function deliverDonationNotification(
  env: WorkerEnv,
  eventId: string,
  eventType: string,
  donationId: string,
  origin: string,
): Promise<void> {
  if (!env.DONATION_TRACKING_SECRET) throw new Error("Tracking is not configured.");
  const payload = await notificationPayload(env, donationId);
  const token = await createTrackingToken(
    env.DONATION_TRACKING_SECRET,
    payload.donationId,
    payload.trackingNonce,
  );
  const link = trackingUrl(origin, payload.publicId, token);
  if (eventType === "donation.created") {
    const record: DonationSubmission = {
      id: payload.publicId,
      clientSubmissionKey: "00000000-0000-4000-8000-000000000000",
      createdAt: payload.createdAt,
      donor: payload.donor,
      shippingMethod: "label",
      devices: payload.devices,
      charity: { pledgeId: payload.charityPledgeId, name: payload.charityName },
    };
    const claimToken = await createClaimToken(env.DONATION_TRACKING_SECRET, payload.donationId, payload.claimNonce);
    const donorText = `${buildDonorConfirmation(record)}\n\nTrack this donation securely:\n${link}\n\nClaim it in your donor account (one-time link):\n${claimUrl(origin, payload.publicId, claimToken)}`;
    const administratorText = buildBetaAdministratorNotification(record, `${origin}/staff`);
    await Promise.all([
      sendBrevoEmail(env, {
        to: [{ email: payload.donor.email, name: donorFullName(payload.donor) }],
        subject: `Your Donate by Mail packet ${payload.publicId}`,
        textContent: donorText,
        htmlContent: textEmailHtml(donorText),
        tag: "donation-donor-confirmation",
        idempotencyKey: `${eventId}-donor`,
      }),
      sendBrevoEmail(env, {
        to: [{ email: env.ADMIN_NOTIFICATION_TO, name: "Donate by Mail" }],
        subject: `Phone donation ${payload.publicId} for ${payload.charityName}`,
        textContent: administratorText,
        htmlContent: textEmailHtml(administratorText),
        tag: "donation-admin-notification",
        idempotencyKey: `${eventId}-admin`,
      }),
    ]);
  } else {
    const donorText = statusMessage(payload, link);
    await sendBrevoEmail(env, {
      to: [{ email: payload.donor.email, name: donorFullName(payload.donor) }],
      subject: `Donation status: ${payload.publicId}`,
      textContent: donorText,
      htmlContent: textEmailHtml(donorText),
      tag: "donation-status-update",
      idempotencyKey: `${eventId}-status`,
    });
  }
}

async function completeInlineOutbox(env: WorkerEnv, eventId: string): Promise<void> {
  await supabaseRpc<boolean>(env, "complete_inline_outbox_event", {
    event_id: eventId,
    handler_name: "donation_notifications",
  });
}

async function deliverPartnerInvitation(
  env: WorkerEnv,
  eventId: string,
  invitationId: string,
  origin: string,
): Promise<void> {
  const payload = await supabaseRpc<{
    invitationId: string;
    email: string;
    organizationName: string;
    loginPath: string;
  } | null>(env, "get_partner_invitation_email_payload", {
    candidate_invitation_id: invitationId,
  });
  if (!payload) throw new Error("invitation_not_active");
  const text = [
    `You have been invited to manage ${payload.organizationName}'s Donate by Mail phone-drive workspace.`,
    "",
    "Sign in with the invited email address using a one-time secure link:",
    `${origin}${payload.loginPath}?account=partner`,
    "",
    "If you were not expecting this invitation, you can ignore this message.",
  ].join("\n");
  await sendBrevoEmail(env, {
    to: [{ email: payload.email }],
    subject: `Donate by Mail partnership invitation for ${payload.organizationName}`,
    textContent: text,
    htmlContent: textEmailHtml(text),
    tag: "partner-invitation",
    idempotencyKey: `${eventId}-partner-invitation`,
  });
}

async function dispatchOutboxEvent(env: WorkerEnv, event: OutboxEvent, origin: string): Promise<void> {
  if (event.handler_key === "donation_notifications" && event.payload.donationId) {
    await deliverDonationNotification(env, event.id, event.event_type, event.payload.donationId, origin);
    return;
  }
  if (event.handler_key === "partner_invitation_email" && event.payload.invitationId) {
    await deliverPartnerInvitation(env, event.id, event.payload.invitationId, origin);
    return;
  }
  throw new Error("unsupported_handler");
}

function normalizeOrganization(
  value: Record<string, unknown>,
  pledgeId: string,
): SelectedCharity {
  return {
    pledgeId,
    name:
      stringValue(value.name) ??
      stringValue(value.organization_name) ??
      "Selected Pledge nonprofit",
    ein: stringValue(value.ngo_id) ?? stringValue(value.ein),
    city: stringValue(value.city),
    state: stringValue(value.region) ?? stringValue(value.state),
    country: stringValue(value.country) ?? stringValue(value.country_code),
    logoUrl: stringValue(value.logo_url) ?? stringValue(value.logo),
    websiteUrl: stringValue(value.website_url) ?? stringValue(value.website),
  };
}

async function lookupOrganization(
  pledgeId: string,
  env: WorkerEnv,
): Promise<SelectedCharity | null> {
  if (!env.PLEDGE_API_KEY) return null;
  const response = await fetch(
    `https://api.pledge.to/v1/organizations/${encodeURIComponent(pledgeId)}`,
    {
      headers: {
        authorization: `Bearer ${env.PLEDGE_API_KEY}`,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return normalizeOrganization(body as Record<string, unknown>, pledgeId);
}

async function handleOrganizationLookup(
  request: Request,
  env: WorkerEnv,
  pledgeId: string,
): Promise<Response> {
  if (!sameOrigin(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  if (!/^[0-9a-f-]{36}$/i.test(pledgeId))
    return json({ ok: false, message: "Invalid organization ID." }, 400);
  if (!env.PLEDGE_API_KEY) {
    return json(
      {
        ok: false,
        code: "lookup_not_configured",
        message: "Organization details lookup is not configured.",
      },
      503,
    );
  }
  try {
    const charity = await lookupOrganization(pledgeId, env);
    return charity
      ? json({ ok: true, charity })
      : json(
          { ok: false, message: "Organization details were not found." },
          404,
        );
  } catch {
    return json(
      { ok: false, message: "Organization details could not be loaded." },
      502,
    );
  }
}

async function handleDonationSubmission(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (!sameOrigin(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ ok: false, message: "Expected a JSON request." }, 415);
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 100_000)
    return json({ ok: false, message: "Submission is too large." }, 413);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(
      { ok: false, message: "The submission could not be read." },
      400,
    );
  }
  if (!validateDonationSubmission(payload)) {
    return json(
      {
        ok: false,
        message: "Please review the donation information and try again.",
      },
      400,
    );
  }
  const submittedRequestHash = await sha256Hex(stableJson(payload));
  if (env.DEPLOYMENT_ENVIRONMENT === "beta" && !(await anonymousRateAllowed(request, env, "donation_submit", 10, 3600)))
    return json({ ok: false, message: "Too many test submissions. Please try again later." }, 429);
  let record: DonationSubmission = payload;
  try {
    const verifiedCharity = await lookupOrganization(
      record.charity.pledgeId,
      env,
    );
    if (verifiedCharity) record = { ...record, charity: verifiedCharity };
  } catch {
    // The selected Pledge UUID remains authoritative even when optional metadata lookup is unavailable.
  }

  if (env.DEPLOYMENT_ENVIRONMENT === "beta") {
    if (!betaDataConfigured(env))
      return json({ ok: false, message: "Beta donation storage is not configured." }, 503);
    const persisted = await supabaseRpc<PersistedDonation>(env, "create_donation", {
      payload: record,
      tracking_nonce: crypto.randomUUID(), claim_nonce: crypto.randomUUID(),
      request_hash_value: submittedRequestHash, campaign_slug: record.campaignSlug || null,
    });
    if (!persisted.created) return json({
      ok: true, replayed: true, donationId: persisted.publicId,
      createdAt: persisted.createdAt, charity: record.charity,
      notificationPending: false,
    }, 200);
    const material = await supabaseRpc<TrackingMaterial>(env, "get_donation_tracking_material", {
      candidate_public_id: persisted.publicId,
    });
    const token = await createTrackingToken(
      env.DONATION_TRACKING_SECRET!,
      persisted.donationId,
      material.trackingNonce,
    );
    const link = trackingUrl(new URL(request.url).origin, persisted.publicId, token);
    const claimToken = await createClaimToken(env.DONATION_TRACKING_SECRET!, persisted.donationId, material.claimNonce!);
    let notificationPending = !persisted.outboxEventId;
    if (persisted.outboxEventId) {
      try {
        await deliverDonationNotification(
          env,
          persisted.outboxEventId,
          "donation.created",
          persisted.donationId,
          new URL(request.url).origin,
        );
        await completeInlineOutbox(env, persisted.outboxEventId);
        notificationPending = false;
      } catch {
        notificationPending = true;
      }
    }
    return json({
      ok: true,
      donationId: persisted.publicId,
      createdAt: persisted.createdAt,
      charity: record.charity,
      trackingUrl: link,
      claimUrl: claimUrl(new URL(request.url).origin, persisted.publicId, claimToken),
      notificationPending,
    }, 201);
  }

  const donorText = buildDonorConfirmation(record);
  const administratorText = buildAdministratorNotification(record);
  try {
    await Promise.all([
      sendBrevoEmail(env, {
        to: [{ email: record.donor.email, name: donorFullName(record.donor) }],
        subject: `Your Donate by Mail packet ${record.id}`,
        textContent: donorText,
        htmlContent: textEmailHtml(donorText),
        tag: "donation-donor-confirmation",
        idempotencyKey: `${record.id}-donor`,
      }),
      sendBrevoEmail(env, {
        to: [{ email: env.ADMIN_NOTIFICATION_TO, name: "Donate by Mail" }],
        subject: `Phone donation ${record.id} for ${record.charity.name}`,
        textContent: administratorText,
        htmlContent: textEmailHtml(administratorText),
        tag: "donation-admin-notification",
        idempotencyKey: `${record.id}-admin`,
      }),
    ]);
  } catch {
    return json({ ok: false, message: "We could not notify Donate by Mail. Please try again." }, 502);
  }
  return json({ ok: true, donationId: record.id, charity: record.charity }, 201);
}

async function handleTrackingStatus(request: Request, env: WorkerEnv): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  try {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const publicId = stringValue(body.publicId);
    const token = stringValue(body.token);
    if (!publicId || !token || !env.DONATION_TRACKING_SECRET)
      return json({ ok: false, message: "This tracking link is invalid." }, 400);
    const material = await supabaseRpc<TrackingMaterial | null>(env, "get_donation_tracking_material", {
      candidate_public_id: publicId,
    });
    if (!material || !(await verifyTrackingToken(
      env.DONATION_TRACKING_SECRET, material.donationId, material.trackingNonce, token,
    ))) return json({ ok: false, message: "This tracking link is invalid or expired." }, 404);
    const status = await supabaseRpc<Record<string, unknown> | null>(env, "get_donation_status", {
      candidate_public_id: publicId,
    });
    return status ? json({ ok: true, donation: status }) : json({ ok: false, message: "Not found." }, 404);
  } catch {
    return json({ ok: false, message: "The donation status could not be loaded." }, 400);
  }
}

async function requireStaff(request: Request, env: WorkerEnv): Promise<SupabaseUser | Response> {
  try {
    const user = await supabaseUser(request, env);
    return user ?? json({ ok: false, message: "Staff sign-in is required." }, 401);
  } catch {
    return json({ ok: false, message: "Staff sign-in could not be verified." }, 401);
  }
}

async function sendMagicLink(request: Request, env: WorkerEnv, destination: "/staff" | "/account" | "/partner", staffOnly = false): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const generic = json({ ok: true, message: "If the address can sign in, a secure link is on its way." }, 202);
  try {
    if (!(await anonymousRateAllowed(request, env, "auth_magic_link", 5, 900))) return generic;
    const body = (await readJson(request, 4_000)) as Record<string, unknown>;
    const email = stringValue(body.email)?.toLowerCase();
    if (!email || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return generic;
    if (staffOnly && !(await supabaseRpc<boolean>(env, "is_active_staff_email", { candidate_email: email }))) return generic;
    const state = crypto.randomUUID();
    const storage = new PkceStorage();
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: {
      flowType: "pkce", storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    }});
    const callback = new URL("/api/auth/callback", new URL(request.url).origin);
    callback.searchParams.set("state", state);
    const allowInvitedPartnerSignup = destination === "/partner"
      && await supabaseRpc<boolean>(env, "is_invited_partner_email", { candidate_email: email });
    const { error } = await client.auth.signInWithOtp({ email, options: {
      emailRedirectTo: callback.toString(),
      // Donor accounts may be created from the public gateway. Partner and
      // staff access must remain invitation/allowlist controlled. A pending
      // partner invitation is the only exception: it bootstraps the invited
      // identity so the invitation can be accepted on first sign-in.
      shouldCreateUser: (destination === "/account" && !staffOnly) || allowInvitedPartnerSignup,
    }});
    if (error) return generic;
    await supabaseRpc(env, "create_auth_login_attempt", {
      state_hash_value: await sha256Hex(state), destination_value: destination,
      storage_value: storage.values, expires_at_value: new Date(Date.now() + 15 * 60_000).toISOString(),
      pending_claim_value: destination === "/account"
        ? cookieValue(request.headers.get("cookie"), PENDING_CLAIM_COOKIE)
        : null,
    });
    return generic;
  } catch {
    return generic;
  }
}

async function handleAuthCallback(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url), state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!state || !code || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.BFF_SESSION_SECRET)
    return Response.redirect(`${url.origin}/?auth=invalid`, 303);
  const attempt = await supabaseRpc<{ destination: "/staff" | "/account" | "/partner"; storage: Record<string, string>; pendingClaimId?: string | null } | null>(env, "consume_auth_login_attempt", {
    state_hash_value: await sha256Hex(state),
  });
  if (!attempt) return Response.redirect(`${url.origin}/?auth=expired`, 303);
  const storage = new PkceStorage(attempt.storage);
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: {
    flowType: "pkce", storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
  }});
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.session || !data.user) return Response.redirect(`${url.origin}${attempt.destination}?auth=invalid`, 303);
  if (attempt.destination === "/staff" && !(await supabaseRpc<boolean>(env, "is_active_staff_user", { candidate_user_id: data.user.id }))) {
    await client.auth.signOut();
    return Response.redirect(`${url.origin}/staff?auth=denied`, 303);
  }
  if (attempt.destination === "/partner" && data.user.email) {
    await supabaseRpc(env, "activate_partner_invitations", {
      actor_user_id: data.user.id, verified_email: data.user.email,
    });
  }
  let claimCompleted = false;
  if (attempt.destination === "/account" && attempt.pendingClaimId && data.user.email) {
    try {
      await supabaseRpc(env, "complete_pending_donation_claim", {
        actor_user_id: data.user.id, pending_claim_value: attempt.pendingClaimId,
        verified_email: data.user.email,
      });
      claimCompleted = true;
    } catch { /* Fail closed; the account page explains that the claim was not completed. */ }
  }
  const now = Date.now();
  const session: BffSession = {
    accessToken: data.session.access_token, refreshToken: data.session.refresh_token,
    expiresAt: (data.session.expires_at || Math.floor(now / 1000) + 3600) * 1000,
    absoluteExpiresAt: now + 7 * 24 * 60 * 60_000,
    csrf: bytesToToken(32),
  };
  const destination = attempt.destination === "/account"
    ? `/account?claim=${claimCompleted ? "complete" : attempt.pendingClaimId ? "failed" : "none"}`
    : attempt.destination;
  const headers = new Headers({ location: `${url.origin}${destination}`, "cache-control": "no-store" });
  headers.append("set-cookie", sessionCookie(await sealSession(session, env.BFF_SESSION_SECRET)));
  headers.append("set-cookie", pendingClaimCookie("", 0));
  return new Response(null, { status: 303, headers });
}

async function handleClaimHandoff(request: Request, env: WorkerEnv): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const body = (await readJson(request, 8_000)) as Record<string, unknown>;
  const publicId = stringValue(body.publicId), token = stringValue(body.claimToken);
  if (!publicId || !token || !env.DONATION_TRACKING_SECRET)
    return json({ ok: false, message: "The claim reference is invalid." }, 400);
  const material = await supabaseRpc<TrackingMaterial | null>(env, "get_donation_claim_material", {
    candidate_public_id: publicId,
  });
  if (!material?.claimNonce || !(await verifyClaimToken(
    env.DONATION_TRACKING_SECRET, material.donationId, material.claimNonce, token,
  ))) return json({ ok: false, message: "The claim reference is invalid or expired." }, 404);
  const user = await authenticatedUser(request, env);
  if (user?.email) {
    const result = await supabaseRpc(env, "claim_donation", {
      actor_user_id: user.id, candidate_donation_id: material.donationId, verified_email: user.email,
    });
    return json({ ok: true, claimed: true, result });
  }
  const pendingId = await supabaseRpc<string>(env, "create_pending_donation_claim", {
    candidate_donation_id: material.donationId,
  });
  const response = json({ ok: true, claimed: false, pending: true });
  response.headers.append("set-cookie", pendingClaimCookie(pendingId));
  return response;
}

function bytesToToken(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function handleLogout(request: Request, env: WorkerEnv): Promise<Response> {
  const user = await authenticatedUser(request, env);
  if (!user || !csrfAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const session = requestSessions.get(request)!;
  if (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) await fetch(`${env.SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: "POST", headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${session.accessToken}` },
  });
  refreshedCookies.delete(request);
  const response = json({ ok: true });
  response.headers.append("set-cookie", clearSessionCookie());
  return response;
}

async function handleCsrf(request: Request, env: WorkerEnv): Promise<Response> {
  const user = await authenticatedUser(request, env), session = requestSessions.get(request);
  return user && session ? json({ ok: true, csrfToken: session.csrf }) : json({ ok: false, message: "Secure sign-in is required." }, 401);
}

async function handleAuthSessionContext(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "GET" || !sameOrigin(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  try {
    const user = await authenticatedUser(request, env);
    if (!user) return json({ ok: true, authenticated: false });
    const context = await supabaseRpc<Record<string, unknown>>(env, "account_context", {
      actor_user_id: user.id,
    });
    return json({ ok: true, authenticated: true, context });
  } catch {
    return json({ ok: true, authenticated: false });
  }
}

async function handleStaffApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const staff = await requireStaff(request, env);
  if (staff instanceof Response) return staff;
  if (request.method !== "GET" && !csrfAllowed(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && url.pathname === "/api/staff/session")
    return json({ ok: true, user: { id: staff.id } });
  if (request.method === "GET" && url.pathname === "/api/staff/finance") {
    return json({ ok: true, finance: await supabaseRpc(env, "staff_financial_overview", { actor_user_id: staff.id }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/sales") {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_record_sale_and_allocation", {
      actor_user_id: staff.id, candidate_device_id: body.deviceId,
      gross_value_cents: body.grossAmountCents, sale_channel: body.channel,
      external_ref: body.externalReference || null, sold_time: body.soldAt || new Date().toISOString(),
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/costs") {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_record_cost", {
      actor_user_id: staff.id, candidate_donation_id: body.donationId,
      candidate_device_id: body.deviceId || null, cost_category: body.category,
      cost_amount_cents: body.amountCents, evidence_ref: body.evidenceReference || null,
      incurred_time: body.incurredAt || new Date().toISOString(),
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/finalize") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_finalize_donation_financials", {
      actor_user_id: staff.id, candidate_donation_id: body.donationId,
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/reopen") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_reopen_donation_financials", {
      actor_user_id: staff.id, candidate_donation_id: body.donationId, reason_value: body.reason,
    }) });
  }
  const correction = url.pathname.match(/^\/api\/staff\/finance\/(sales|costs)\/([0-9a-f-]{36})\/reverse$/i);
  if (request.method === "POST" && correction) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env,
      correction[1] === "sales" ? "staff_reverse_sale" : "staff_reverse_cost", {
        actor_user_id: staff.id,
        [correction[1] === "sales" ? "candidate_sale_id" : "candidate_cost_id"]: correction[2],
        reason_value: body.reason,
      }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/disbursements/prepare") {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_prepare_disbursement", {
      actor_user_id: staff.id, candidate_allocation_id: body.allocationId,
      amount_value_cents: body.amountCents, payment_memo_value: body.paymentMemo || null,
      evidence_value: body.evidence || {},
    }) });
  }
  const disbursementAction = url.pathname.match(/^\/api\/staff\/finance\/disbursements\/([0-9a-f-]{36})\/(decision|complete)$/i);
  if (request.method === "POST" && disbursementAction) {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    const result = disbursementAction[2] === "decision"
      ? await supabaseRpc(env, "staff_decide_disbursement", {
        actor_user_id: staff.id, candidate_preparation_id: disbursementAction[1],
        decision_value: body.outcome, reason_value: body.reason || null,
      })
      : await supabaseRpc(env, "staff_record_disbursement_completion", {
        actor_user_id: staff.id, candidate_preparation_id: disbursementAction[1],
        external_ref: body.externalReference,
      });
    return json({ ok: true, result });
  }
  if (request.method === "GET" && url.pathname === "/api/staff/campaigns") {
    return json({ ok: true, campaigns: await supabaseRpc(env, "staff_campaign_overview", { actor_user_id: staff.id }) });
  }
  if (request.method === "GET" && url.pathname === "/api/staff/partners") {
    return json({ ok: true, partners: await supabaseRpc(env, "staff_partner_overview", { actor_user_id: staff.id }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/partners/organizations") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_create_partner_organization", {
      actor_user_id: staff.id, name_value: body.name, slug_value: body.slug,
    }) });
  }
  const partnerOrgAction = url.pathname.match(/^\/api\/staff\/partners\/organizations\/([0-9a-f-]{36})\/(charities|invitations|status)$/i);
  if (request.method === "POST" && partnerOrgAction) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    if (partnerOrgAction[2] === "charities") {
      const pledgeId = stringValue(body.pledgeId);
      if (!pledgeId) return json({ ok: false, message: "A Pledge nonprofit ID is required." }, 400);
      const charity = await lookupOrganization(pledgeId, env);
      if (!charity) return json({ ok: false, message: "The nonprofit could not be verified with Pledge." }, 404);
      const verified = await supabaseRpc<{ charityId: string }>(env, "staff_verify_partner_charity", {
        actor_user_id: staff.id, pledge_id_value: charity.pledgeId,
        canonical_name_value: charity.name, ein_value: charity.ein || null,
      });
      return json({ ok: true, result: await supabaseRpc(env, "staff_associate_partner_charity", {
        actor_user_id: staff.id, candidate_organization_id: partnerOrgAction[1],
        candidate_charity_id: verified.charityId,
      }) });
    }
    const result = await supabaseRpc<Record<string, unknown>>(env,
      partnerOrgAction[2] === "invitations" ? "staff_invite_partner_admin" : "staff_set_partner_organization_status", {
        actor_user_id: staff.id, candidate_organization_id: partnerOrgAction[1],
        ...(partnerOrgAction[2] === "invitations" ? { email_value: body.email } : { status_value: body.status }),
      });
    const invitationOutbox = stringValue(result.outboxEventId);
    const invitationId = stringValue(result.invitationId);
    if (partnerOrgAction[2] === "invitations" && invitationOutbox && invitationId) {
      try {
        await deliverPartnerInvitation(env, invitationOutbox, invitationId, url.origin);
        await supabaseRpc(env, "complete_inline_outbox_event", {
          event_id: invitationOutbox, handler_name: "partner_invitation_email",
        });
      } catch {
        // The transactional outbox remains pending/retryable if the provider is unavailable.
      }
    }
    return json({ ok: true, result });
  }
  const partnerMember = url.pathname.match(/^\/api\/staff\/partners\/organizations\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})\/status$/i);
  if (request.method === "POST" && partnerMember) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_set_partner_member_status", {
      actor_user_id: staff.id, candidate_organization_id: partnerMember[1],
      candidate_user_id: partnerMember[2], status_value: body.status,
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/campaigns/publish") {
    const body = (await readJson(request, 10_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_publish_campaign_revision", {
      actor_user_id: staff.id, candidate_campaign_id: body.campaignId,
      candidate_revision_id: body.revisionId,
    }) });
  }
  if (request.method === "GET" && url.pathname === "/api/staff/donations") {
    const donations = await supabaseRpc<unknown[]>(env, "staff_search_donations", {
      actor_user_id: staff.id, search_term: (url.searchParams.get("q") || "").slice(0, 160), result_limit: 25,
    });
    return json({ ok: true, donations });
  }
  const match = url.pathname.match(/^\/api\/staff\/donations\/([0-9a-f-]{36})(?:\/(.*))?$/i);
  if (!match) return json({ ok: false, message: "Not found." }, 404);
  const donationId = match[1], action = match[2] || "";
  if (request.method === "GET" && !action) {
    const donation = await supabaseRpc<Record<string, unknown> | null>(env, "staff_get_donation", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
    });
    return donation ? json({ ok: true, donation }) : json({ ok: false, message: "Not found." }, 404);
  }
  if (request.method === "GET" && action === "financials") {
    const financials = await supabaseRpc<Record<string, unknown> | null>(env, "staff_get_donation_financials", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
    });
    return financials ? json({ ok: true, financials }) : json({ ok: false, message: "Not found." }, 404);
  }
  let body: Record<string, unknown>;
  try { body = (await readJson(request, 30_000)) as Record<string, unknown>; }
  catch { return json({ ok: false, message: "Invalid request." }, 400); }
  let result: Record<string, unknown>;
  if (request.method === "POST" && action === "receipt") {
    result = await supabaseRpc(env, "staff_record_receipt", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      receipt_time: body.receiptTime, package_condition: body.packageCondition,
      device_receipts: body.deviceReceipts,
    });
  } else if (request.method === "POST" && action === "status") {
    result = await supabaseRpc(env, "staff_change_donation_status", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      new_status: body.status, public_message: body.publicMessage || null,
    });
  } else if (request.method === "POST" && action === "notes") {
    result = await supabaseRpc(env, "staff_add_internal_note", {
      actor_user_id: staff.id, candidate_donation_id: donationId, note_body: body.note,
    });
  } else if (request.method === "POST" && action === "unexpected-devices") {
    result = await supabaseRpc(env, "staff_add_unexpected_device", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      actual_brand: body.actualBrand, actual_model: body.actualModel,
    });
  } else {
    const device = action.match(/^devices\/([0-9a-f-]{36})$/i);
    if (request.method !== "POST" || !device) return json({ ok: false, message: "Not found." }, 404);
    result = await supabaseRpc(env, "staff_update_device", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      candidate_device_id: device[1], patch: body,
    });
  }
  const outboxId = stringValue(result.outboxEventId);
  if (outboxId) {
    try {
      await deliverDonationNotification(env, outboxId, action === "receipt" ? "donation.received" : "donation.status_changed", donationId, url.origin);
      await completeInlineOutbox(env, outboxId);
    } catch { /* The persisted outbox safely retries notification delivery. */ }
  }
  return json({ ok: true, result });
}

async function requireAuthenticated(request: Request, env: WorkerEnv): Promise<SupabaseUser | Response> {
  const user = await authenticatedUser(request, env);
  return user ?? json({ ok: false, message: "Secure sign-in is required." }, 401);
}

async function handleAccountApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const user = await requireAuthenticated(request, env);
  if (user instanceof Response) return user;
  if (!user.email) return json({ ok: false, message: "A verified email is required." }, 403);
  if (request.method !== "GET" && !csrfAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && url.pathname === "/api/account/session")
    return json({ ok: true, user: { id: user.id, email: user.email } });
  if (request.method === "GET" && url.pathname === "/api/account/profile")
    return json({ ok: true, profile: await supabaseRpc(env, "account_profile", { actor_user_id: user.id }) });
  if (request.method === "POST" && url.pathname === "/api/account/profile") {
    const body = (await readJson(request, 4_000)) as Record<string, unknown>;
    return json({ ok: true, profile: await supabaseRpc(env, "update_account_profile", {
      actor_user_id: user.id, display_name_value: body.displayName || null,
    }) });
  }
  if (request.method === "GET" && url.pathname === "/api/account/donations") {
    const account = await supabaseRpc(env, "donor_account_overview", {
      actor_user_id: user.id,
    });
    return json({ ok: true, account });
  }
  if (request.method === "POST" && url.pathname === "/api/account/claims") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const publicId = stringValue(body.publicId), token = stringValue(body.claimToken);
    if (!publicId || !token || !env.DONATION_TRACKING_SECRET) return json({ ok: false, message: "The claim reference is invalid." }, 400);
    const material = await supabaseRpc<TrackingMaterial | null>(env, "get_donation_claim_material", { candidate_public_id: publicId });
    if (!material?.claimNonce || !(await verifyClaimToken(env.DONATION_TRACKING_SECRET, material.donationId, material.claimNonce, token)))
      return json({ ok: false, message: "The claim reference is invalid or expired." }, 404);
    return json({ ok: true, result: await supabaseRpc(env, "claim_donation", {
      actor_user_id: user.id, candidate_donation_id: material.donationId, verified_email: user.email,
    }) });
  }
  const mailed = url.pathname.match(/^\/api\/account\/donations\/([0-9a-f-]{36})\/mailed$/i);
  if (request.method === "POST" && mailed) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const result = await supabaseRpc(env, "donor_mark_donation_mailed", {
      actor_user_id: user.id,
      candidate_donation_id: mailed[1], carrier_name: body.carrier || null,
      tracking_value: body.trackingNumber || null,
    });
    return json({ ok: true, result });
  }
  return json({ ok: false, message: "Not found." }, 404);
}

async function handlePartnerApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const user = await requireAuthenticated(request, env);
  if (user instanceof Response) return user;
  if (request.method !== "GET" && !csrfAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && url.pathname === "/api/partner/session")
    return json({ ok: true, user: { id: user.id } });
  if (request.method === "GET" && url.pathname === "/api/partner/overview")
    return json({ ok: true, partner: await supabaseRpc(env, "partner_overview", { actor_user_id: user.id }) });
  const campaign = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && campaign)
    return json({ ok: true, campaign: await supabaseRpc(env, "partner_campaign_detail", {
      actor_user_id: user.id, candidate_campaign_id: campaign[1],
    }) });
  const campaignAsset = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/assets$/i);
  if (request.method === "POST" && campaignAsset) {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > CAMPAIGN_ASSET_MAX_BYTES + 16_000) return json({ ok: false, message: "The campaign image is too large. Use an image under 5 MB." }, 413);
    const form = await request.formData();
    const fileValue = form.get("file");
    const altText = stringValue(form.get("altText"));
    const decorative = form.get("decorative") === "true";
    const assetKind = stringValue(form.get("assetKind")) || "hero_image";
    const bytes = fileValue instanceof File ? new Uint8Array(await fileValue.arrayBuffer()) : null;
    const validSignature = bytes && ((fileValue as File).type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      || (fileValue as File).type === "image/png" && bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137,80,78,71,13,10,26,10][index])
      || (fileValue as File).type === "image/webp" && bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP");
    if (!(fileValue instanceof File) || !CAMPAIGN_ASSET_MIME_TYPES.has(fileValue.type) || !["hero_image", "supporting_image"].includes(assetKind) || fileValue.size < 1 || fileValue.size > CAMPAIGN_ASSET_MAX_BYTES || (!decorative && !altText) || !validSignature || !bytes) {
      return json({ ok: false, message: "Upload a JPG, PNG, or WebP image under 5 MB with descriptive alt text." }, 400);
    }
    // Verify membership before writing a storage object. The detail RPC is
    // intentionally used as the same authorization boundary as campaign edits.
    await supabaseRpc(env, "partner_campaign_detail", { actor_user_id: user.id, candidate_campaign_id: campaignAsset[1] });
    const extension = fileValue.type === "image/jpeg" ? "jpg" : fileValue.type === "image/png" ? "png" : "webp";
    const storagePath = `campaigns/${campaignAsset[1]}/${crypto.randomUUID()}.${extension}`;
    const asset = await supabaseRpc<{ id: string }>(env, "partner_create_campaign_asset", {
      actor_user_id: user.id, candidate_campaign_id: campaignAsset[1], asset_kind_value: assetKind,
      storage_path_value: storagePath, mime_type_value: fileValue.type, byte_size_value: fileValue.size,
      alt_text_value: altText || null, decorative_value: decorative,
      content_sha256_value: await sha256BytesHex(bytes),
    });
    try {
      await uploadCampaignAsset(env, storagePath, fileValue);
    } catch (error) {
      await supabaseRpc(env, "partner_delete_campaign_asset", { actor_user_id: user.id, candidate_asset_id: asset.id }).catch(() => undefined);
      await deleteCampaignAssetObject(env, storagePath);
      throw error;
    }
    return json({ ok: true, asset: { id: asset.id, assetKind, altText, previewUrl: `/api/campaign-assets/${asset.id}` } }, 201);
  }
  if (request.method === "POST" && url.pathname === "/api/partner/campaigns") {
    const body = (await readJson(request, 30_000)) as Record<string, unknown>;
    const canonical = JSON.stringify({ headline: body.headline, summary: body.summary, story: body.story, ctaLabel: body.ctaLabel });
    const result = await supabaseRpc(env, "partner_create_campaign", {
      actor_user_id: user.id, candidate_organization_id: body.organizationId,
      campaign_slug: body.slug, campaign_name: body.name,
      candidate_charity_id: body.charityId,
      headline_value: body.headline, summary_value: body.summary, story_value: body.story,
      cta_value: body.ctaLabel || "Donate a Phone", content_hash_value: await sha256Hex(canonical),
    });
    return json({ ok: true, result }, 201);
  }
  if (request.method === "POST" && campaign) {
    const body = (await readJson(request, 30_000)) as Record<string, unknown>;
    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    const canonical = JSON.stringify({ headline: body.headline, summary: body.summary, story: body.story, ctaLabel: body.ctaLabel, heroAssetId: body.heroAssetId || null, supportingAssetId: body.supportingAssetId || null, blocks });
    const result = await supabaseRpc(env, "partner_create_campaign_revision", {
      actor_user_id: user.id, candidate_campaign_id: campaign[1], headline_value: body.headline,
      summary_value: body.summary, story_value: body.story, cta_value: body.ctaLabel || "Donate a Phone",
      hero_asset_value: body.heroAssetId || null, supporting_asset_value: body.supportingAssetId || null,
      content_hash_value: await sha256Hex(canonical), blocks_value: blocks,
    });
    return json({ ok: true, result }, 201);
  }
  return json({ ok: false, message: "Not found." }, 404);
}

async function handleAgentCommand(request: Request, env: WorkerEnv): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  if (!(await safeSecretEqual(bearer, env.AGENT_API_KEY))) return json({ ok: false, message: "Unauthorized." }, 401);
  if (request.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  const body = (await readJson(request, 40_000)) as Record<string, unknown>;
  const command = stringValue(body.command);
  const risk = stringValue(body.risk) || "moderate";
  const idempotencyKey = stringValue(body.idempotencyKey);
  if (!isSemanticCommand(command) || !isRiskLevel(risk) || !idempotencyKey) return json({ ok: false, message: "Canonical command, risk, and idempotency key are required." }, 400);
  const targetId = stringValue(body.targetId) || null;
  const agentIdentity = stringValue(body.agentIdentity) || "workspace-agent-beta";
  const targetType = stringValue(body.targetType) || "unknown";
  const inputHash = await sha256Hex(canonicalAuthorizationInput({
    agentIdentity, command, targetType, targetId, risk,
    facts: body.facts || {}, payload: body.payload || {},
  }));
  const decision = await supabaseRpc(env, "evaluate_agent_command", {
    agent_identity: agentIdentity,
    command_value: command, target_kind: targetType,
    target_value: targetId, risk_value: risk,
    facts: body.facts || {}, input_hash_value: inputHash,
    correlation_value: stringValue(body.correlationId) || crypto.randomUUID(),
    idempotency_value: idempotencyKey,
  });
  return json({ ok: true, decision });
}

async function handleMcp(request: Request, env: WorkerEnv): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  if (!(await safeSecretEqual(bearer, env.AGENT_API_KEY))) return json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }, 401);
  if (!sameOrigin(request)) return json({ jsonrpc: "2.0", error: { code: -32002, message: "Invalid Origin" }, id: null }, 403);
  if (request.method === "GET") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST, GET" } });
  const rpc = (await readJson(request, 50_000)) as Record<string, any>;
  const id = rpc.id ?? null;
  if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (rpc.method === "initialize") return json({ jsonrpc: "2.0", id, result: {
    protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "donate-by-mail-beta", version: "0.2.0" },
    instructions: "Use semantic commands only. Physical, credential, arbitrary SQL, disbursement execution, and production deployment actions are prohibited.",
  } });
  if (rpc.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: [{
    name: "evaluate_semantic_command",
    description: "Evaluate and record a bounded Donate by Mail business command under the active policy. This does not provide arbitrary database access.",
    inputSchema: { type: "object", additionalProperties: false,
      required: ["command", "targetType", "risk", "idempotencyKey"], properties: {
        command: { type: "string", enum: ["send_message","update_campaign_content","publish_campaign_revision","change_donation_status","create_partner_lead","create_internal_note"] },
        targetType: { type: "string" }, targetId: { type: "string", format: "uuid" },
        risk: { type: "string", enum: RISK_LEVELS },
        facts: { type: "object" }, payload: { type: "object" }, idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
      } }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }] } });
  if (rpc.method === "tools/call" && rpc.params?.name === "evaluate_semantic_command") {
    const args = rpc.params.arguments || {};
    const command = stringValue(args.command), idempotencyKey = stringValue(args.idempotencyKey), risk = stringValue(args.risk) || "moderate";
    if (!isSemanticCommand(command) || !isRiskLevel(risk) || !idempotencyKey) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
    const targetId = stringValue(args.targetId) || null;
    const agentIdentity = "workspace-agent-beta";
    const targetType = stringValue(args.targetType) || "unknown";
    const inputHash = await sha256Hex(canonicalAuthorizationInput({
      agentIdentity, command, targetType, targetId, risk,
      facts: args.facts || {}, payload: args.payload || {},
    }));
    const decision = await supabaseRpc(env, "evaluate_agent_command", {
      agent_identity: agentIdentity, command_value: command,
      target_kind: targetType, target_value: targetId,
      risk_value: risk, facts: args.facts || {},
      input_hash_value: inputHash, correlation_value: stringValue(args.correlationId) || crypto.randomUUID(),
      idempotency_value: idempotencyKey,
    });
    return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(decision) }], structuredContent: decision } });
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

type OutboxEvent = { id: string; handler_key: string; event_type: string; payload: { donationId?: string; invitationId?: string } };

async function processOutbox(env: WorkerEnv): Promise<void> {
  if (!betaDataConfigured(env)) return;
  const workerId = `scheduled-${crypto.randomUUID()}`;
  const events = await supabaseRpc<OutboxEvent[]>(env, "claim_outbox_events", {
    worker_id: workerId, batch_size: 20, lease_seconds: 60,
  });
  for (const event of events) {
    try {
      await dispatchOutboxEvent(env, event, "https://beta.donatebymail.org");
      await supabaseRpc(env, "complete_outbox_event", { event_id: event.id, worker_id: workerId });
    } catch (error) {
      await supabaseRpc(env, "fail_outbox_event", {
        event_id: event.id, worker_id: workerId,
        retry_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        error_code: error instanceof Error && error.message === "unsupported_handler" ? "unsupported_handler" : "delivery_failed",
        retryable: true,
      });
    }
  }
}

async function routeRequest(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/donations") {
      return handleDonationSubmission(request, env);
    }
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/donations/status")
      return handleTrackingStatus(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/staff/auth/magic-link")
      return sendMagicLink(request, env, "/staff", true);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/account/auth/magic-link")
      return sendMagicLink(request, env, "/account");
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/account/claim-intents")
      return handleClaimHandoff(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/partner/auth/magic-link")
      return sendMagicLink(request, env, "/partner");
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "GET" && url.pathname === "/api/auth/callback")
      return handleAuthCallback(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "GET" && url.pathname === "/api/auth/csrf")
      return handleCsrf(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "GET" && url.pathname === "/api/auth/session")
      return handleAuthSessionContext(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/auth/logout")
      return handleLogout(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.pathname.startsWith("/api/account/")) {
      try { return await handleAccountApi(request, env, url); }
      catch { return json({ ok: false, message: "The donor account request was rejected." }, 400); }
    }
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.pathname.startsWith("/api/partner/")) {
      try { return await handlePartnerApi(request, env, url); }
      catch { return json({ ok: false, message: "The partner request was rejected." }, 400); }
    }
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.pathname === "/api/agent/v1/commands") {
      try { return await handleAgentCommand(request, env); }
      catch { return json({ ok: false, message: "The semantic command was rejected." }, 400); }
    }
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.pathname === "/mcp") {
      try { return await handleMcp(request, env); }
      catch { return json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, 500); }
    }
    const publicCampaign = url.pathname.match(/^\/api\/campaigns\/([a-z0-9-]+)$/);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "GET" && publicCampaign) {
      const campaign = await supabaseRpc<Record<string, unknown> | null>(env, "get_public_campaign", { campaign_slug: publicCampaign[1] });
      if (!campaign) return json({ ok: false, message: "Campaign not found." }, 404);
      // Enrich the public campaign response server-side. This keeps the
      // Pledge credential and lookup behind the Worker and avoids making a
      // second browser request that may be affected by beta access policy.
      const pledgeId = stringValue(campaign.charityPledgeId);
      const charity = pledgeId ? await lookupOrganization(pledgeId, env).catch(() => null) : null;
      // Never attach a logo or external metadata to a different nonprofit
      // than the verified campaign beneficiary. Staff must refresh the
      // canonical Pledge association before a logo can appear.
      const matchingCharity = charity && pledgeId && charity.pledgeId.toLowerCase() === pledgeId.toLowerCase()
        ? charity
        : null;
      return json({ ok: true, campaign: matchingCharity ? { ...campaign, charity: matchingCharity } : campaign });
    }
    const publicCampaignAsset = url.pathname.match(/^\/api\/campaign-assets\/([0-9a-f-]{36})$/i);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "GET" && publicCampaignAsset) {
      const asset = await supabaseRpc<{ id: string; storagePath: string; mimeType: string; altText: string } | null>(env, "get_public_campaign_asset", { candidate_asset_id: publicCampaignAsset[1] });
      if (!asset) return json({ ok: false, message: "Campaign asset not found." }, 404);
      const stored = await getCampaignAssetObject(env, asset.storagePath);
      if (!stored.ok || !stored.body) return json({ ok: false, message: "Campaign asset unavailable." }, 404);
      const headers = new Headers({
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        "content-type": asset.mimeType,
        "x-content-type-options": "nosniff",
      });
      return new Response(stored.body, { status: 200, headers });
    }
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.pathname.startsWith("/api/staff/")) {
      try {
        return await handleStaffApi(request, env, url);
      } catch {
        return json({ ok: false, message: "The staff operation was rejected. Review the values and try again." }, 400);
      }
    }
    const organizationMatch = url.pathname.match(
      /^\/api\/pledge\/organizations\/([0-9a-f-]{36})$/i,
    );
    if (request.method === "GET" && organizationMatch) {
      return handleOrganizationLookup(request, env, organizationMatch[1]);
    }
    if (url.pathname.startsWith("/api/"))
      return json({ ok: false, message: "Not found." }, 404);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "GET") {
      const vanity = url.pathname.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
      if (vanity) {
        const alias = await supabaseRpc<{ canonicalSlug: string; behavior: "redirect" | "render" } | null>(
          env, "resolve_campaign_alias", { candidate_slug: vanity[1] },
        );
        if (alias?.canonicalSlug) {
          if (alias.behavior === "redirect")
            return Response.redirect(`${url.origin}/c/${alias.canonicalSlug}`, 308);
          return env.ASSETS.fetch(new Request(`${url.origin}/c/${alias.canonicalSlug}`, request));
        }
      }
    }
    const response = await env.ASSETS.fetch(request);
    if (env.DEPLOYMENT_ENVIRONMENT !== "beta") return response;

    const headers = new Headers(response.headers);
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
}

function hardened(response: Response, request: Request, env: WorkerEnv): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://www.pledge.to https://staging.pledge.to; frame-src https://www.pledge.to https://staging.pledge.to; connect-src 'self' https://api.pledge.to; img-src 'self' data: https://images.pexels.com https://5e27aa4c670fcbb06b.v2.appdeploy.ai https://www.pledge.to https://res.cloudinary.com https://pledgeling-res.cloudinary.com; style-src 'self' 'unsafe-inline'; font-src 'self'; upgrade-insecure-requests");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  if (env.DEPLOYMENT_ENVIRONMENT === "beta") headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/") || ["/staff", "/account", "/partner"].includes(path.replace(/\/$/, "")))
    headers.set("cache-control", "no-store");
  const refreshed = refreshedCookies.get(request);
  if (refreshed) headers.append("set-cookie", refreshed);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return hardened(await routeRequest(request, env), request, env);
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    if (env.DEPLOYMENT_ENVIRONMENT === "beta") await processOutbox(env);
  },
} satisfies ExportedHandler<WorkerEnv>;
