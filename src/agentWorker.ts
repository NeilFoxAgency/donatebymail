import worker from "./worker";
import { isRiskLevel, isSemanticCommand, RISK_LEVELS } from "./gen2/commandRegistry";
import { canonicalAuthorizationInput } from "./gen2/authorizationFingerprint";

type AgentWorkerEnv = Env & {
  DEPLOYMENT_ENVIRONMENT?: "production" | "beta";
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  AGENT_API_KEY?: string;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

const AGENT_IDENTITY = "donate-by-mail-operations-agent-v1";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const SUPPORT_CATEGORIES = [
  "general_faq",
  "donation_status",
  "donation_value_status",
  "donation_shipping",
  "donation_preparation",
  "donation_acknowledgment_process",
  "partner_campaign_setup",
  "partner_portal_help",
  "partner_campaign_status",
  "internal_escalation",
] as const;

const MCP_TOOLS: McpTool[] = [
  {
    name: "support_capabilities",
    description: "Return the Donate by Mail coworker autonomy contract, including automatic, approval-required, and human-only operations.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "find_donations",
    description: "Find donation records by exact requester email or exact public donation ID. Private facts are returned only when the sender email matches the stored donor email.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["requesterEmail"],
      properties: {
        requesterEmail: { type: "string", format: "email" },
        publicId: { type: "string", pattern: "^DBM-[0-9]{8}-[A-F0-9]{8}$" },
        resultLimit: { type: "integer", minimum: 1, maximum: 25 },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_donation_support_snapshot",
    description: "Read the donor-safe operational snapshot for one donation after exact sender-email verification, including status, shipment, devices, timeline, assessment, sale, allocation, and disbursement state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["donationId", "requesterEmail"],
      properties: {
        donationId: { type: "string", format: "uuid" },
        requesterEmail: { type: "string", format: "email" },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_partner_support_snapshot",
    description: "Read the verified partner context for an exact requester email, including organizations, invitations, verified charities, campaigns, and setup checklist.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["requesterEmail"],
      properties: { requesterEmail: { type: "string", format: "email" } },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_operations_overview",
    description: "Return an operations summary and Tre's human-action queue without unrestricted record access.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "record_inbound_message",
    description: "Journal an inbound Gmail, Brevo, or manual message idempotently. Donation and partner links are accepted only when the sender identity matches the stored record.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "externalThreadRef", "externalMessageRef", "senderEmail", "recipientEmails", "subject", "bodySummary"],
      properties: {
        provider: { type: "string", enum: ["gmail", "brevo", "manual"] },
        externalThreadRef: { type: "string", minLength: 1, maxLength: 300 },
        externalMessageRef: { type: "string", minLength: 1, maxLength: 300 },
        senderEmail: { type: "string", format: "email" },
        recipientEmails: { type: "array", minItems: 1, maxItems: 25, items: { type: "string", format: "email" } },
        subject: { type: "string", maxLength: 500 },
        bodySummary: { type: "string", minLength: 1, maxLength: 2000 },
        bodyStorageRef: { type: "string", maxLength: 500 },
        occurredAt: { type: "string", format: "date-time" },
        donationId: { type: "string", format: "uuid" },
        organizationId: { type: "string", format: "uuid" },
        campaignId: { type: "string", format: "uuid" },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "authorize_support_message",
    description: "Evaluate and bind an exact outbound support email. Low-risk approved categories may auto-send; private facts require exact sender identity; sensitive cases escalate. The returned subject, body, recipient, and content hash must not be changed before sending.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["category", "recipientEmail", "subject", "body", "bodySummary", "idempotencyKey"],
      properties: {
        category: { type: "string", enum: SUPPORT_CATEGORIES },
        recipientEmail: { type: "string", format: "email" },
        subject: { type: "string", minLength: 1, maxLength: 500 },
        body: { type: "string", minLength: 1, maxLength: 12000 },
        bodySummary: { type: "string", minLength: 1, maxLength: 2000 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
        donationId: { type: "string", format: "uuid" },
        organizationId: { type: "string", format: "uuid" },
        campaignId: { type: "string", format: "uuid" },
        requestsFinancialAction: { type: "boolean" },
        requestsLegalOrTaxAdvice: { type: "boolean" },
        requestsAccessChange: { type: "boolean" },
        securityOrPrivacyIncident: { type: "boolean" },
        complaintOrThreat: { type: "boolean" },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "record_outbound_message",
    description: "After Gmail sends the exact authorized email, record the provider IDs and immutable execution result. The database recomputes the subject/body hash and rejects altered content.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["authorizationId", "subject", "body", "contentHash", "provider", "externalThreadRef", "externalMessageRef", "senderIdentity"],
      properties: {
        authorizationId: { type: "string", format: "uuid" },
        subject: { type: "string", minLength: 1, maxLength: 500 },
        body: { type: "string", minLength: 1, maxLength: 12000 },
        contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        provider: { type: "string", enum: ["gmail", "brevo", "manual"] },
        externalThreadRef: { type: "string", minLength: 1, maxLength: 300 },
        externalMessageRef: { type: "string", minLength: 1, maxLength: 300 },
        senderIdentity: { type: "string", minLength: 3, maxLength: 300 },
        sentAt: { type: "string", format: "date-time" },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "record_message_failure",
    description: "Close an unused support-message authorization as failed when Gmail did not send the message.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["authorizationId", "failureCode"],
      properties: {
        authorizationId: { type: "string", format: "uuid" },
        failureCode: { type: "string", pattern: "^[a-z][a-z0-9_]{2,79}$" },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "create_partner_lead",
    description: "Create or refresh a bounded nonprofit-partner lead without granting access, verifying a charity, publishing a campaign, or changing financial terms.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["requesterEmail", "organizationName", "requestSummary", "idempotencyKey"],
      properties: {
        requesterEmail: { type: "string", format: "email" },
        organizationName: { type: "string", minLength: 1, maxLength: 200 },
        requestSummary: { type: "string", minLength: 1, maxLength: 4000 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
        websiteUrl: { type: "string", format: "uri", maxLength: 1000 },
        audienceSummary: { type: "string", maxLength: 2000 },
        goalSummary: { type: "string", maxLength: 2000 },
        timingSummary: { type: "string", maxLength: 2000 },
        externalThreadRef: { type: "string", maxLength: 300 },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "set_communication_thread_status",
    description: "Synchronize the Supabase communication-thread workflow state after inbox work.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "status"],
      properties: {
        threadId: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["open", "waiting_on_contact", "waiting_on_staff", "resolved", "closed"] },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "evaluate_semantic_command",
    description: "Evaluate a non-email bounded business command under the active policy. This records a decision but does not execute physical, financial, credential, role, or deployment actions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["command", "targetType", "risk", "idempotencyKey"],
      properties: {
        command: {
          type: "string",
          enum: ["update_campaign_content", "publish_campaign_revision", "change_donation_status", "create_partner_lead", "create_internal_note"],
        },
        targetType: { type: "string", minLength: 1, maxLength: 80 },
        targetId: { type: "string", format: "uuid" },
        risk: { type: "string", enum: RISK_LEVELS },
        facts: { type: "object" },
        payload: { type: "object" },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function safeSecretEqual(actual: string | null, expected?: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(actual)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = stringValue(args[key]);
  if (!value) throw new Error(`missing_${key}`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | null {
  return stringValue(args[key]) ?? null;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function optionalInteger(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return Number.isInteger(value) ? Number(value) : fallback;
}

function stringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`invalid_${key}`);
  return value as string[];
}

async function supabaseRpc<T>(
  env: AgentWorkerEnv,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new Error("beta_database_not_configured");
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SECRET_KEY,
    "content-type": "application/json",
    accept: "application/json",
    "content-profile": "api",
    "accept-profile": "api",
  };
  if (env.SUPABASE_SECRET_KEY.startsWith("eyJ"))
    headers.authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
  if (!response.ok) {
    console.error(JSON.stringify({
      event: "agent_mcp_supabase_rpc_failed",
      functionName,
      status: response.status,
    }));
    throw new Error("bounded_operation_rejected");
  }
  return (await response.json()) as T;
}

function toolResult(id: JsonRpcRequest["id"], value: unknown): Response {
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
    },
  });
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: AgentWorkerEnv,
): Promise<unknown> {
  switch (name) {
    case "support_capabilities":
      return supabaseRpc(env, "agent_support_capabilities", {
        agent_identity: AGENT_IDENTITY,
      });
    case "find_donations":
      return supabaseRpc(env, "agent_find_donations", {
        agent_identity: AGENT_IDENTITY,
        requester_email: requiredString(args, "requesterEmail"),
        public_id_hint: optionalString(args, "publicId"),
        result_limit: optionalInteger(args, "resultLimit", 10),
      });
    case "get_donation_support_snapshot":
      return supabaseRpc(env, "agent_get_donation_support_snapshot", {
        agent_identity: AGENT_IDENTITY,
        candidate_donation_id: requiredString(args, "donationId"),
        requester_email: requiredString(args, "requesterEmail"),
      });
    case "get_partner_support_snapshot":
      return supabaseRpc(env, "agent_get_partner_support_snapshot", {
        agent_identity: AGENT_IDENTITY,
        requester_email: requiredString(args, "requesterEmail"),
      });
    case "get_operations_overview":
      return supabaseRpc(env, "agent_get_operations_overview", {
        agent_identity: AGENT_IDENTITY,
      });
    case "record_inbound_message":
      return supabaseRpc(env, "agent_record_inbound_message", {
        agent_identity: AGENT_IDENTITY,
        provider_value: requiredString(args, "provider"),
        external_thread_value: requiredString(args, "externalThreadRef"),
        external_message_value: requiredString(args, "externalMessageRef"),
        sender_email: requiredString(args, "senderEmail"),
        recipient_emails: stringArray(args, "recipientEmails"),
        subject_value: String(args.subject ?? ""),
        body_summary_value: requiredString(args, "bodySummary"),
        body_storage_value: optionalString(args, "bodyStorageRef"),
        occurred_at_value: optionalString(args, "occurredAt") ?? new Date().toISOString(),
        candidate_donation_id: optionalString(args, "donationId"),
        candidate_organization_id: optionalString(args, "organizationId"),
        candidate_campaign_id: optionalString(args, "campaignId"),
      });
    case "authorize_support_message":
      return supabaseRpc(env, "agent_authorize_support_message", {
        agent_identity: AGENT_IDENTITY,
        message_category: requiredString(args, "category"),
        recipient_email: requiredString(args, "recipientEmail"),
        subject_value: requiredString(args, "subject"),
        body_value: requiredString(args, "body"),
        body_summary_value: requiredString(args, "bodySummary"),
        idempotency_value: requiredString(args, "idempotencyKey"),
        correlation_value: optionalString(args, "correlationId"),
        candidate_donation_id: optionalString(args, "donationId"),
        candidate_organization_id: optionalString(args, "organizationId"),
        candidate_campaign_id: optionalString(args, "campaignId"),
        requests_financial_action: optionalBoolean(args, "requestsFinancialAction"),
        requests_legal_or_tax_advice: optionalBoolean(args, "requestsLegalOrTaxAdvice"),
        requests_access_change: optionalBoolean(args, "requestsAccessChange"),
        security_or_privacy_incident: optionalBoolean(args, "securityOrPrivacyIncident"),
        complaint_or_threat: optionalBoolean(args, "complaintOrThreat"),
      });
    case "record_outbound_message":
      return supabaseRpc(env, "agent_record_outbound_message", {
        agent_identity: AGENT_IDENTITY,
        authorization_value: requiredString(args, "authorizationId"),
        subject_value: requiredString(args, "subject"),
        body_value: requiredString(args, "body"),
        content_hash_value: requiredString(args, "contentHash"),
        provider_value: requiredString(args, "provider"),
        external_thread_value: requiredString(args, "externalThreadRef"),
        external_message_value: requiredString(args, "externalMessageRef"),
        sender_identity_value: requiredString(args, "senderIdentity"),
        sent_at_value: optionalString(args, "sentAt") ?? new Date().toISOString(),
      });
    case "record_message_failure":
      return supabaseRpc(env, "agent_record_message_failure", {
        agent_identity: AGENT_IDENTITY,
        authorization_value: requiredString(args, "authorizationId"),
        failure_code: requiredString(args, "failureCode"),
      });
    case "create_partner_lead":
      return supabaseRpc(env, "agent_create_partner_lead", {
        agent_identity: AGENT_IDENTITY,
        requester_email: requiredString(args, "requesterEmail"),
        organization_name_value: requiredString(args, "organizationName"),
        request_summary_value: requiredString(args, "requestSummary"),
        idempotency_value: requiredString(args, "idempotencyKey"),
        correlation_value: optionalString(args, "correlationId"),
        website_url_value: optionalString(args, "websiteUrl"),
        audience_summary_value: optionalString(args, "audienceSummary"),
        goal_summary_value: optionalString(args, "goalSummary"),
        timing_summary_value: optionalString(args, "timingSummary"),
        external_thread_value: optionalString(args, "externalThreadRef"),
      });
    case "set_communication_thread_status":
      return supabaseRpc(env, "agent_set_communication_thread_status", {
        agent_identity: AGENT_IDENTITY,
        candidate_thread_id: requiredString(args, "threadId"),
        status_value: requiredString(args, "status"),
      });
    case "evaluate_semantic_command": {
      const command = requiredString(args, "command");
      const risk = requiredString(args, "risk");
      const idempotencyKey = requiredString(args, "idempotencyKey");
      if (!isSemanticCommand(command) || !isRiskLevel(risk) || command === "send_message")
        throw new Error("invalid_semantic_command");
      const targetType = requiredString(args, "targetType");
      const targetId = optionalString(args, "targetId");
      const facts = (args.facts && typeof args.facts === "object" && !Array.isArray(args.facts)) ? args.facts : {};
      const payload = (args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)) ? args.payload : {};
      const inputHash = await sha256Hex(canonicalAuthorizationInput({
        agentIdentity: AGENT_IDENTITY,
        command,
        targetType,
        targetId,
        risk,
        facts,
        payload,
      }));
      return supabaseRpc(env, "evaluate_agent_command", {
        agent_identity: AGENT_IDENTITY,
        command_value: command,
        target_kind: targetType,
        target_value: targetId,
        risk_value: risk,
        facts,
        input_hash_value: inputHash,
        correlation_value: optionalString(args, "correlationId") ?? crypto.randomUUID(),
        idempotency_value: idempotencyKey,
      });
    }
    default:
      throw new Error("unknown_tool");
  }
}

async function handleAgentMcp(request: Request, env: AgentWorkerEnv): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!(await safeSecretEqual(bearer, env.AGENT_API_KEY)))
    return json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }, 401);
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });

  let rpc: JsonRpcRequest;
  try {
    rpc = await request.json() as JsonRpcRequest;
  } catch {
    return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
  }
  const id = rpc.id ?? null;

  if (rpc.method === "notifications/initialized")
    return new Response(null, { status: 202 });
  if (rpc.method === "initialize")
    return json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "donate-by-mail-operations", version: "0.3.0" },
        instructions: "Use only the bounded Donate by Mail coworker tools. Authorize every support email before Gmail sends it, send the exact unchanged message, then record the provider IDs. Escalate financial, legal, privacy, access, complaint, and identity-mismatch cases.",
      },
    });
  if (rpc.method === "tools/list")
    return json({ jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } });
  if (rpc.method !== "tools/call" || !rpc.params?.name)
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });

  try {
    const value = await callTool(rpc.params.name, rpc.params.arguments ?? {}, env);
    return toolResult(id, value);
  } catch (error) {
    console.error(JSON.stringify({
      event: "agent_mcp_tool_failed",
      tool: rpc.params.name,
      reason: error instanceof Error ? error.message : "unknown",
    }));
    return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "The bounded operation was rejected." } });
  }
}

const originalWorker = worker as ExportedHandler<any>;

export default {
  async fetch(request: Request, env: AgentWorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.pathname === "/mcp")
      return handleAgentMcp(request, env);
    if (!originalWorker.fetch) throw new Error("worker_fetch_unavailable");
    return originalWorker.fetch(request as any, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: AgentWorkerEnv, ctx: ExecutionContext): Promise<void> {
    if (originalWorker.scheduled) await originalWorker.scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<AgentWorkerEnv>;
