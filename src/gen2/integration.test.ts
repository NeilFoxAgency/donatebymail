import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import worker, { processOutbox } from "../worker";

const integration = process.env.RUN_LOCAL_INTEGRATION === "1";
const dbUrl = process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const supabaseUrl = process.env.API_URL || "http://127.0.0.1:54321";
const serviceKey = process.env.SERVICE_ROLE_KEY || "";
const publishableKey = process.env.PUBLISHABLE_KEY || process.env.ANON_KEY || "";
const staffId = "b1000000-0000-4000-8000-000000000001";
const charityId = "b1000000-0000-4000-8000-000000000002";
const campaignId = "b1000000-0000-4000-8000-000000000003";
const revisionId = "b1000000-0000-4000-8000-000000000004";
const policyId = "b1000000-0000-4000-8000-000000000005";
const policyVersionId = "b1000000-0000-4000-8000-000000000006";
const pledgeId = "b1000000-0000-4000-8000-000000000007";

function sql(statement: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], { encoding: "utf8" }).trim();
}

let brevo: Server;
let brevoCalls: Array<Record<string, unknown>> = [];
let brevoUrl = "";

describe.skipIf(!integration)("actual Worker + local Supabase integration", () => {
  beforeAll(async () => {
    sql(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      values ('${staffId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-staff@example.test','',now(),now(),now());
      insert into app_private.profiles(user_id) values ('${staffId}');
      insert into app_private.staff_memberships(user_id,role,status,activated_at) values ('${staffId}','admin','active',now());
      insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at)
        values ('${charityId}','${pledgeId}','Integration Charity','verified','${staffId}',now());
      insert into app_private.proceeds_policies(id,policy_key,name,purpose,lifecycle)
        values ('${policyId}','integration_policy','Integration policy','test','active');
      insert into app_private.proceeds_policy_versions(id,policy_id,version,lifecycle,share_basis_points,calculation_method,effective_from,approved_by,approved_at)
        values ('${policyVersionId}','${policyId}',1,'active',5000,'net_proceeds_share','2026-01-01','${staffId}',now());
      insert into app_private.proceeds_policy_assignments(policy_version_id,scope,precedence,effective_from)
        values ('${policyVersionId}','general',1,'2026-01-01');
      insert into app_private.organizations(id,name,slug,status,created_by)
        values ('b1000000-0000-4000-8000-000000000008','Integration Partner','integration-partner','active','${staffId}');
      insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at)
        values ('b1000000-0000-4000-8000-000000000008','${charityId}','verified','${staffId}',now());
      insert into app_private.campaigns(id,organization_id,slug,name,selected_charity_pledge_id,selected_charity_name,charity_id,status,created_by)
        values ('${campaignId}','b1000000-0000-4000-8000-000000000008','integration-campaign','Integration campaign','${pledgeId}','Integration Charity','${charityId}','draft','${staffId}');
      insert into app_private.campaign_revisions(id,campaign_id,version,status,headline,summary,story,cta_label,content_hash,content_blocks,requested_by,published_by,published_at)
        values ('${revisionId}','${campaignId}',1,'published','Support Integration Charity','Mail an old phone.','Integration story.','Donate a Phone',repeat('1',64),'[]','${staffId}','${staffId}',now());
      update app_private.campaigns set active_revision_id='${revisionId}',status='published' where id='${campaignId}';`);

    brevo = createServer((request, response) => {
      console.log(`mock-brevo ${request.method} ${request.url}`);
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => { try { brevoCalls.push(JSON.parse(body)); } catch { /* diagnostic provider accepts only JSON in normal use */ } response.writeHead(201, { "content-type": "application/json" }); response.end(JSON.stringify({ messageId: "integration" })); });
    });
    await new Promise<void>((resolve) => brevo.listen(0, "127.0.0.1", resolve));
    const address = brevo.address();
    if (!address || typeof address === "string") throw new Error("mock Brevo did not bind");
    brevoUrl = `http://127.0.0.1:${address.port}/v3/smtp/email`;
    env.BREVO_API_URL = brevoUrl;
  });
  afterAll(() => brevo?.close());

  const env = {
    DEPLOYMENT_ENVIRONMENT: "beta" as const, SUPABASE_URL: supabaseUrl,
    SUPABASE_SECRET_KEY: serviceKey, SUPABASE_PUBLISHABLE_KEY: publishableKey,
    DONATION_TRACKING_SECRET: "integration-tracking-secret-32-characters-minimum",
    ADMIN_NOTIFICATION_TO: "tre+beta@donatebymail.org", BREVO_SENDER_EMAIL: "contact@donatebymail.org",
    BREVO_SENDER_NAME: "Donate by Mail", REPLY_TO_EMAIL: "contact@donatebymail.org",
    BFF_SESSION_SECRET: "integration-bff-secret-32-characters-minimum", BREVO_API_URL: "",
  } as any;

  it("persists campaign attribution and rejects a tampered beneficiary", async () => {
    const payload = { id: "DBM-INTEGRATION", createdAt: new Date().toISOString(), clientSubmissionKey: crypto.randomUUID(), shippingMethod: "label", campaignSlug: "integration-campaign",
      donor: { firstName: "Integration", middleName: "", lastName: "Donor", email: "integration-donor@example.test", address1: "1 Main", address2: "", city: "Kissimmee", state: "FL", zip: "34741", country: "US", marketingEmailConsent: false },
      charity: { pledgeId, name: "Integration Charity" }, devices: [{ id: "device-1", brand: "Apple", model: "Phone", age: "2-3 years", condition: "Good", storage: "128 GB", powersOn: true, unlocked: true }] };
    const response = await worker.fetch(new Request("http://integration.test/api/donations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), env);
    if (response.status !== 201) throw new Error(`campaign submission ${response.status}: ${await response.text()}`);
    const publicId = (await response.json() as { donationId: string }).donationId;
    expect(sql(`select campaign_id::text||':'||selected_charity_pledge_id::text||':'||coalesce(policy_version_snapshot_id::text,'') from app_private.donations where public_id='${publicId}'`)).toBe(`${campaignId}:${pledgeId}:${policyVersionId}`);
    const tampered = { ...payload, clientSubmissionKey: crypto.randomUUID(), charity: { pledgeId: "b1000000-0000-4000-8000-000000000099", name: "Wrong" } };
    await expect(worker.fetch(new Request("http://integration.test/api/donations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tampered) }), env)).rejects.toThrow();
  });

  it("runs status outbox through the actual Worker dispatcher and mocked Brevo", async () => {
    const donationId = sql("select id from app_private.donations order by created_at desc limit 1");
    const out = await fetch(`${supabaseUrl}/rest/v1/rpc/staff_change_donation_status`, { method: "POST", headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-profile": "api", "accept-profile": "api", "content-type": "application/json" }, body: JSON.stringify({ actor_user_id: staffId, candidate_donation_id: donationId, new_status: "in_transit", public_message: "Integration update" }) });
    if (!out.ok) throw new Error(`status rpc ${out.status}: ${await out.text()}`);
    expect(sql(`select handler_key from app_private.outbox_events where event_type='donation.status_changed' order by created_at desc limit 1`)).toBe("donation_notifications");
    await processOutbox(env);
    expect(brevoCalls.some((call) => JSON.stringify(call).includes("Donation status"))).toBe(true);
    expect(sql("select status from app_private.outbox_events where event_type='donation.status_changed' order by created_at desc limit 1")).toBe("completed");
  });
});
