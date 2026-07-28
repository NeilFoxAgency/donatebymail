import {
  buildAdministratorNotification,
  buildDonorConfirmation,
  donorFullName,
  validateDonationSubmission,
  type DonationSubmission,
} from "./submission";
import type { SelectedCharity } from "./pledge";
import {
  createTrackingToken,
  trackingUrl,
  verifyTrackingToken,
} from "./gen2/tracking";

type BrevoRecipient = { email: string; name?: string };

type WorkerEnv = Env & {
  PLEDGE_API_KEY?: string;
  DEPLOYMENT_ENVIRONMENT?: "production" | "beta";
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  DONATION_TRACKING_SECRET?: string;
  AGENT_API_KEY?: string;
};

type PersistedDonation = {
  created: boolean;
  donationId: string;
  publicId: string;
  createdAt: string;
  outboxEventId: string | null;
};

type TrackingMaterial = { donationId: string; trackingNonce: string };
type SupabaseUser = { id: string; email?: string };
type NotificationPayload = {
  donationId: string;
  publicId: string;
  status: string;
  createdAt: string;
  trackingNonce: string;
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

async function authenticatedUser(request: Request, env: WorkerEnv): Promise<SupabaseUser | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization,
      accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as SupabaseUser;
  if (!user?.id) return null;
  return user;
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

async function safeSecretEqual(actual: string | null, expected?: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const [a, b] = await Promise.all([sha256Hex(actual), sha256Hex(expected)]);
  return a === b;
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
      createdAt: payload.createdAt,
      donor: payload.donor,
      shippingMethod: "label",
      devices: payload.devices,
      charity: { pledgeId: payload.charityPledgeId, name: payload.charityName },
    };
    const donorText = `${buildDonorConfirmation(record)}\n\nTrack this donation securely:\n${link}`;
    const administratorText = `${buildAdministratorNotification(record)}\n\nOpen staff workspace:\n${origin}/staff`;
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
    if (record.campaignSlug) {
      const campaign = await supabaseRpc<{ charityPledgeId: string } | null>(env, "get_public_campaign", {
        campaign_slug: record.campaignSlug,
      });
      if (!campaign || campaign.charityPledgeId !== record.charity.pledgeId)
        return json({ ok: false, message: "This campaign requires its listed nonprofit selection." }, 400);
    }
    const persisted = await supabaseRpc<PersistedDonation>(env, "create_donation", {
      payload: record,
      tracking_nonce: crypto.randomUUID(),
    });
    if (record.campaignSlug) {
      await supabaseRpc(env, "attach_campaign_to_donation", {
        candidate_donation_id: persisted.donationId, campaign_slug: record.campaignSlug,
      });
    }
    const token = await createTrackingToken(
      env.DONATION_TRACKING_SECRET!,
      persisted.donationId,
      (await supabaseRpc<TrackingMaterial>(env, "get_donation_tracking_material", {
        candidate_public_id: persisted.publicId,
      })).trackingNonce,
    );
    const link = trackingUrl(new URL(request.url).origin, persisted.publicId, token);
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

async function handleStaffMagicLink(request: Request, env: WorkerEnv): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const generic = json({ ok: true, message: "If this address is authorized, a secure sign-in link is on its way." }, 202);
  try {
    const body = (await readJson(request, 4_000)) as Record<string, unknown>;
    const email = stringValue(body.email)?.toLowerCase();
    if (!email || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return generic;
    const active = await supabaseRpc<boolean>(env, "is_active_staff_email", { candidate_email: email });
    if (!active) return generic;
    const authUrl = new URL(`${env.SUPABASE_URL}/auth/v1/otp`);
    authUrl.searchParams.set("redirect_to", `${new URL(request.url).origin}/staff`);
    await fetch(authUrl, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, create_user: false }),
    });
    return generic;
  } catch {
    return generic;
  }
}

async function handleStaffApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const staff = await requireStaff(request, env);
  if (staff instanceof Response) return staff;
  if (request.method !== "GET" && !sameOrigin(request))
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
  if (request.method === "POST" && url.pathname === "/api/staff/finance/disbursements/prepare") {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_prepare_disbursement", {
      actor_user_id: staff.id, candidate_allocation_id: body.allocationId,
      amount_value_cents: body.amountCents, beneficiary_ref: body.beneficiaryReference,
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

async function sendMagicLink(request: Request, env: WorkerEnv, destination: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const generic = json({ ok: true, message: "If the address can sign in, a secure link is on its way." }, 202);
  try {
    const body = (await readJson(request, 4_000)) as Record<string, unknown>;
    const email = stringValue(body.email)?.toLowerCase();
    if (!email || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return generic;
    const authUrl = new URL(`${env.SUPABASE_URL}/auth/v1/otp`);
    authUrl.searchParams.set("redirect_to", `${new URL(request.url).origin}${destination}`);
    await fetch(authUrl, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, create_user: true }),
    });
    return generic;
  } catch { return generic; }
}

async function requireAuthenticated(request: Request, env: WorkerEnv): Promise<SupabaseUser | Response> {
  const user = await authenticatedUser(request, env);
  return user ?? json({ ok: false, message: "Secure sign-in is required." }, 401);
}

async function handleAccountApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const user = await requireAuthenticated(request, env);
  if (user instanceof Response) return user;
  if (!user.email) return json({ ok: false, message: "A verified email is required." }, 403);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && url.pathname === "/api/account/session")
    return json({ ok: true, user: { id: user.id, email: user.email } });
  if (request.method === "GET" && url.pathname === "/api/account/donations") {
    const account = await supabaseRpc(env, "donor_account_overview", {
      actor_user_id: user.id, verified_email: user.email,
    });
    return json({ ok: true, account });
  }
  const mailed = url.pathname.match(/^\/api\/account\/donations\/([0-9a-f-]{36})\/mailed$/i);
  if (request.method === "POST" && mailed) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const result = await supabaseRpc(env, "donor_mark_donation_mailed", {
      actor_user_id: user.id, verified_email: user.email,
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
  if (request.method !== "GET" && !sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && url.pathname === "/api/partner/session")
    return json({ ok: true, user: { id: user.id } });
  if (request.method === "GET" && url.pathname === "/api/partner/overview")
    return json({ ok: true, partner: await supabaseRpc(env, "partner_overview", { actor_user_id: user.id }) });
  const campaign = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && campaign)
    return json({ ok: true, campaign: await supabaseRpc(env, "partner_campaign_detail", {
      actor_user_id: user.id, candidate_campaign_id: campaign[1],
    }) });
  if (request.method === "POST" && url.pathname === "/api/partner/campaigns") {
    const body = (await readJson(request, 30_000)) as Record<string, unknown>;
    const canonical = JSON.stringify({ headline: body.headline, summary: body.summary, story: body.story, ctaLabel: body.ctaLabel });
    const result = await supabaseRpc(env, "partner_create_campaign", {
      actor_user_id: user.id, candidate_organization_id: body.organizationId,
      campaign_slug: body.slug, campaign_name: body.name,
      charity_pledge_id: body.charityPledgeId, charity_name: body.charityName,
      headline_value: body.headline, summary_value: body.summary, story_value: body.story,
      cta_value: body.ctaLabel || "Donate a Phone", content_hash_value: await sha256Hex(canonical),
    });
    return json({ ok: true, result }, 201);
  }
  if (request.method === "POST" && campaign) {
    const body = (await readJson(request, 30_000)) as Record<string, unknown>;
    const canonical = JSON.stringify({ headline: body.headline, summary: body.summary, story: body.story, ctaLabel: body.ctaLabel, heroImageUrl: body.heroImageUrl });
    const result = await supabaseRpc(env, "partner_create_campaign_revision", {
      actor_user_id: user.id, candidate_campaign_id: campaign[1], headline_value: body.headline,
      summary_value: body.summary, story_value: body.story, cta_value: body.ctaLabel || "Donate a Phone",
      hero_image_value: body.heroImageUrl || null, content_hash_value: await sha256Hex(canonical),
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
  const idempotencyKey = stringValue(body.idempotencyKey);
  if (!command || !idempotencyKey) return json({ ok: false, message: "Command and idempotency key are required." }, 400);
  const targetId = stringValue(body.targetId) || null;
  const inputHash = await sha256Hex(JSON.stringify({ command, targetId, payload: body.payload || {} }));
  const decision = await supabaseRpc(env, "evaluate_agent_command", {
    agent_identity: stringValue(body.agentIdentity) || "workspace-agent-beta",
    command_value: command, target_kind: stringValue(body.targetType) || "unknown",
    target_value: targetId, risk_value: stringValue(body.risk) || "medium",
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
        risk: { type: "string", enum: ["low","medium","high","critical"] },
        facts: { type: "object" }, idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
      } }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }] } });
  if (rpc.method === "tools/call" && rpc.params?.name === "evaluate_semantic_command") {
    const args = rpc.params.arguments || {};
    const command = stringValue(args.command), idempotencyKey = stringValue(args.idempotencyKey);
    if (!command || !idempotencyKey) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
    const targetId = stringValue(args.targetId) || null;
    const inputHash = await sha256Hex(JSON.stringify({ command, targetId, facts: args.facts || {} }));
    const decision = await supabaseRpc(env, "evaluate_agent_command", {
      agent_identity: "workspace-agent-beta", command_value: command,
      target_kind: stringValue(args.targetType) || "unknown", target_value: targetId,
      risk_value: stringValue(args.risk) || "medium", facts: args.facts || {},
      input_hash_value: inputHash, correlation_value: stringValue(args.correlationId) || crypto.randomUUID(),
      idempotency_value: idempotencyKey,
    });
    return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(decision) }], structuredContent: decision } });
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

type OutboxEvent = { id: string; handler_key: string; event_type: string; payload: { donationId?: string } };

async function processOutbox(env: WorkerEnv): Promise<void> {
  if (!betaDataConfigured(env)) return;
  const workerId = `scheduled-${crypto.randomUUID()}`;
  const events = await supabaseRpc<OutboxEvent[]>(env, "claim_outbox_events", {
    worker_id: workerId, batch_size: 20, lease_seconds: 60,
  });
  for (const event of events) {
    try {
      if (event.handler_key !== "donation_notifications" || !event.payload.donationId)
        throw new Error("unsupported_handler");
      await deliverDonationNotification(env, event.id, event.event_type, event.payload.donationId, "https://beta.donatebymail.org");
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

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/donations") {
      return handleDonationSubmission(request, env);
    }
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/donations/status")
      return handleTrackingStatus(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/staff/auth/magic-link")
      return handleStaffMagicLink(request, env);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/account/auth/magic-link")
      return sendMagicLink(request, env, "/account");
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && request.method === "POST" && url.pathname === "/api/partner/auth/magic-link")
      return sendMagicLink(request, env, "/partner");
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
      return campaign ? json({ ok: true, campaign }) : json({ ok: false, message: "Campaign not found." }, 404);
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
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    if (env.DEPLOYMENT_ENVIRONMENT === "beta") await processOutbox(env);
  },
} satisfies ExportedHandler<WorkerEnv>;
