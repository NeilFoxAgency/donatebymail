import worker, { isLocalBetaHarness, readBoundedResponseJson, readJson, supabaseBaseUrl } from "./worker";
import { isRiskLevel, isSemanticCommand, RISK_LEVELS } from "./gen2/commandRegistry";
import { canonicalAuthorizationInput } from "./gen2/authorizationFingerprint";
import { APPLICATION_CONTRACT_VERSION, BETA_AGENT_CONTRACT_VERSION } from "./contractVersion";

type AgentWorkerEnv = Env & {
  DEPLOYMENT_ENVIRONMENT?: "production" | "beta";
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  AGENT_API_KEY?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUDIENCE?: string;
  /** Dedicated beta-only credential used by the Cloudflare MCP Portal upstream. */
  MCP_ARTICLE_BEARER_TOKEN?: string;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    protocolVersion?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

type McpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  securitySchemes?: Array<Record<string, unknown>>;
  _meta?: { securitySchemes?: Array<Record<string, unknown>> };
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

const AGENT_IDENTITY = "donate-by-mail-operations-agent-v1";
// ChatGPT's current custom-app scanner supports the June 2025 MCP
// Streamable HTTP protocol. Keep this explicit rather than advertising a
// newer draft version that clients may treat as unsupported.
const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const MAX_MCP_TOOL_RESPONSE_BYTES = 2 * 1024 * 1024;
const OPERATIONS_MCP_HOSTS = new Set([
  "beta.donatebymail.org",
  "mcp-operations-connector-beta.donatebymail.org",
]);
const ARTICLE_MCP_HOSTS = new Set([
  "mcp-beta.donatebymail.org",
  "mcp-connector-beta.donatebymail.org",
  "mcp-oauth-beta.donatebymail.org",
]);
// Streamable HTTP clients may send an Origin header even though they are not
// browser pages hosted by the connector. Allow the known OpenAI MCP client
// origins and the connector's own origin, while rejecting arbitrary browser
// origins so a DNS-rebinding or cross-site page cannot drive a bearer-bound
// MCP session.
const TRUSTED_MCP_ORIGINS = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://platform.openai.com",
]);
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-dbm-application-contract-version": APPLICATION_CONTRACT_VERSION,
  "x-dbm-agent-contract-version": BETA_AGENT_CONTRACT_VERSION,
  "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
};

const ARTICLE_OAUTH_SECURITY = [{ type: "oauth2", scopes: [] }];

type AccessJwk = {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
};

type AccessJwksCache = {
  domain: string;
  expiresAt: number;
  keys: Map<string, CryptoKey>;
};

type AccessClaims = {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  type?: string;
};

let accessJwksCache: AccessJwksCache | null = null;
const ACCESS_JWKS_TTL_MS = 5 * 60 * 1000;
const ACCESS_CLOCK_SKEW_SECONDS = 60;

async function fetchWithTimeout(
  input: Request | string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("upstream_timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

// These tools can authorize or cause externally visible state changes. MCP
// annotations are advisory, but truthful hints let compatible agent hosts add
// a confirmation step before invoking them in an autonomous workflow.
const CONSEQUENTIAL_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

// Keep article content as a deliberately small, JSON-Schema-described union.
// Besides making validation explicit at the command boundary, the concrete
// `items` schema is important for MCP clients that inspect tool schemas before
// registering write-capable tools (an array without `items` is too ambiguous
// for some client scanners).
const ARTICLE_BLOCK_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "text"],
      properties: {
        type: { type: "string", enum: ["paragraph", "quote"] },
        text: { type: "string", minLength: 1, maxLength: 4000 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "level", "text"],
      properties: {
        type: { type: "string", enum: ["heading"] },
        level: { type: "integer", enum: [2, 3, 4] },
        text: { type: "string", minLength: 1, maxLength: 180 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "ordered", "items"],
      properties: {
        type: { type: "string", enum: ["list"] },
        ordered: { type: "boolean" },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 24,
          items: { type: "string", minLength: 1, maxLength: 400 },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "label", "href"],
      properties: {
        type: { type: "string", enum: ["link"] },
        label: { type: "string", minLength: 1, maxLength: 180 },
        href: { type: "string", minLength: 1, maxLength: 1000, pattern: "^(?:\\/(?!\\/)[^\\s\\\\<>\"']*|https:\\/\\/[^\\s\\\\<>\"']+)$" },
      },
    },
  ],
} as const;

const ARTICLE_LIST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    articles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          title: { type: "string" },
          excerpt: { type: "string" },
          authorName: { type: "string" },
          publishedAt: { type: "string", format: "date-time" },
          seoTitle: { type: "string" },
          seoDescription: { type: "string" },
        },
      },
    },
  },
  required: ["articles"],
} as const;
const ARTICLE_DETAIL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    article: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", format: "uuid" },
            slug: { type: "string" },
            title: { type: "string" },
            excerpt: { type: "string" },
            contentBlocks: { type: "array", items: ARTICLE_BLOCK_SCHEMA },
            authorName: { type: "string" },
            publishedAt: { type: "string", format: "date-time" },
            seoTitle: { type: "string" },
            seoDescription: { type: "string" },
            contentHash: { type: "string" },
            revisionId: { type: "string", format: "uuid" },
            version: { type: "integer" },
          },
        },
      ],
    },
  },
  required: ["article"],
} as const;
const ARTICLE_COMMAND_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "object", additionalProperties: true },
    execution: {
      oneOf: [
        { type: "null" },
        { type: "object", additionalProperties: true },
      ],
    },
  },
  required: ["decision", "execution"],
} as const;

const ARTICLE_MCP_TOOL_NAMES = new Set([
  "list_articles",
  "get_article",
  "create_article_draft",
  "update_article_content",
  "schedule_article_publication",
  "publish_article",
]);

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

const OPERATIONS_SEMANTIC_COMMANDS = [
  "update_campaign_content",
  "publish_campaign_revision",
  "change_donation_status",
  "create_partner_lead",
  "create_internal_note",
] as const;

const SUPPORT_AUTHORIZATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["authorizationId", "outcome", "contentHash", "recipientEmail", "subject", "body", "autoSendAllowed"],
  properties: {
    authorizationId: { type: "string", format: "uuid" },
    decisionId: { type: "string", format: "uuid" },
    agentActionId: { type: "string", format: "uuid" },
    outcome: { type: "string", enum: ["ALLOW_AUTOMATICALLY", "REQUIRE_APPROVAL", "ESCALATE", "DENY"] },
    rationaleCode: { type: "string" },
    risk: { type: "string", enum: RISK_LEVELS },
    identityVerified: { type: "boolean" },
    contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    expiresAt: { type: "string", format: "date-time" },
    autoSendAllowed: { type: "boolean" },
    replayed: { type: "boolean" },
    recipientEmail: { type: "string", format: "email" },
    subject: { type: "string", minLength: 1, maxLength: 500 },
    body: { type: "string", minLength: 1, maxLength: 12000 },
  },
} as const;

const OUTBOUND_RECORD_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["authorizationConsumed", "replayed"],
  properties: {
    threadId: { type: "string", format: "uuid" },
    messageId: { type: "string", format: "uuid" },
    authorizationConsumed: { type: "boolean" },
    replayed: { type: "boolean" },
  },
} as const;

// Keep the remaining operations tools self-describing as well. These schemas
// mirror the bounded JSON objects returned by their SECURITY DEFINER wrappers;
// they are intentionally strict about identifiers and status values while
// leaving policy rationale text extensible for future policy versions.
const AGENT_DECISION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decisionId", "agentActionId", "outcome", "rationaleCode", "replayed"],
  properties: {
    decisionId: { type: "string", format: "uuid" },
    agentActionId: { type: "string", format: "uuid" },
    outcome: { type: "string", enum: ["ALLOW_AUTOMATICALLY", "REQUIRE_APPROVAL", "ESCALATE", "DENY"] },
    rationaleCode: { type: "string", minLength: 1, maxLength: 200 },
    replayed: { type: "boolean" },
  },
} as const;

const INBOUND_RECORD_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["threadId", "messageId", "replayed", "donationLinked", "organizationLinked"],
  properties: {
    threadId: { type: "string", format: "uuid" },
    messageId: { type: "string", format: "uuid" },
    replayed: { type: "boolean" },
    donationLinked: { type: "boolean" },
    organizationLinked: { type: "boolean" },
  },
} as const;

const MESSAGE_FAILURE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recorded", "replayed"],
  properties: {
    recorded: { type: "boolean" },
    replayed: { type: "boolean" },
    status: { type: "string", enum: ["failed"] },
  },
} as const;

const PARTNER_LEAD_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decisionId", "agentActionId", "outcome", "rationaleCode", "replayed", "created"],
  properties: {
    decisionId: { type: "string", format: "uuid" },
    agentActionId: { type: "string", format: "uuid" },
    outcome: { type: "string", enum: ["ALLOW_AUTOMATICALLY", "REQUIRE_APPROVAL", "ESCALATE", "DENY"] },
    rationaleCode: { type: "string", minLength: 1, maxLength: 200 },
    replayed: { type: "boolean" },
    created: { type: "boolean" },
    updated: { type: "boolean" },
    leadId: { oneOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    nextHumanGate: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

const THREAD_STATUS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["threadId", "status", "replayed"],
  properties: {
    threadId: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["open", "waiting_on_contact", "waiting_on_staff", "resolved", "closed"] },
    replayed: { type: "boolean" },
  },
} as const;

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
    description: "Journal an inbound Gmail, Brevo, or manual message idempotently. Donation and partner links are accepted only when the sender identity matches the stored record; agent-journaled inbound data is not trusted provenance for identity-free automatic replies.",
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
    outputSchema: INBOUND_RECORD_OUTPUT_SCHEMA,
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
    outputSchema: SUPPORT_AUTHORIZATION_OUTPUT_SCHEMA,
    annotations: CONSEQUENTIAL_WRITE_ANNOTATIONS,
  },
  {
    name: "record_outbound_message",
    description: "After the approved connector sends the exact authorized email to the returned recipient, record the recipient, provider IDs, and immutable execution result. The database recomputes the subject/body hash and rejects altered content or a different recipient.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["authorizationId", "recipientEmail", "subject", "body", "contentHash", "provider", "externalThreadRef", "externalMessageRef", "senderIdentity"],
      properties: {
        authorizationId: { type: "string", format: "uuid" },
        recipientEmail: { type: "string", format: "email" },
        subject: { type: "string", minLength: 1, maxLength: 500 },
        body: { type: "string", minLength: 1, maxLength: 12000 },
        contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        provider: { type: "string", enum: ["gmail", "brevo", "manual"] },
        externalThreadRef: { type: "string", minLength: 1, maxLength: 300 },
        externalMessageRef: { type: "string", minLength: 1, maxLength: 300 },
        senderIdentity: { type: "string", minLength: 3, maxLength: 300, pattern: "^[A-Za-z0-9._%+-]+@donatebymail\\.org$" },
        sentAt: { type: "string", format: "date-time" },
      },
    },
    outputSchema: OUTBOUND_RECORD_OUTPUT_SCHEMA,
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
    outputSchema: MESSAGE_FAILURE_OUTPUT_SCHEMA,
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
    outputSchema: PARTNER_LEAD_OUTPUT_SCHEMA,
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
    outputSchema: THREAD_STATUS_OUTPUT_SCHEMA,
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "list_articles",
    title: "List published articles",
    description: "List published Donate by Mail articles. Drafts, schedules, and internal workflow fields are never exposed.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: ARTICLE_LIST_OUTPUT_SCHEMA,
    securitySchemes: ARTICLE_OAUTH_SECURITY,
    _meta: { securitySchemes: ARTICLE_OAUTH_SECURITY },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_article",
    title: "Get a published article",
    description: "Read one published article by its safe canonical slug, including typed content blocks and SEO metadata.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["slug"],
      properties: { slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 120 } },
    },
    outputSchema: ARTICLE_DETAIL_OUTPUT_SCHEMA,
    securitySchemes: ARTICLE_OAUTH_SECURITY,
    _meta: { securitySchemes: ARTICLE_OAUTH_SECURITY },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "create_article_draft",
    title: "Create an article draft",
    description: "Create an audited article draft using safe typed blocks. The draft is not public until explicitly scheduled or published.",
    inputSchema: {
      type: "object", additionalProperties: false,
      required: ["slug", "title", "excerpt", "contentBlocks", "idempotencyKey"],
      properties: {
        slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 120 },
        title: { type: "string", minLength: 1, maxLength: 180 },
        excerpt: { type: "string", minLength: 1, maxLength: 500 },
        contentBlocks: { type: "array", minItems: 1, maxItems: 50, items: ARTICLE_BLOCK_SCHEMA },
        seoTitle: { type: "string", minLength: 1, maxLength: 180 },
        seoDescription: { type: "string", minLength: 1, maxLength: 320 },
        authorName: { type: "string", minLength: 1, maxLength: 120 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
      },
    },
    outputSchema: ARTICLE_COMMAND_OUTPUT_SCHEMA,
    securitySchemes: ARTICLE_OAUTH_SECURITY,
    _meta: { securitySchemes: ARTICLE_OAUTH_SECURITY },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "update_article_content",
    title: "Update article content",
    description: "Create a new immutable revision for an existing article. This changes no published page until a revision is scheduled or published.",
    inputSchema: {
      type: "object", additionalProperties: false,
      required: ["articleId", "title", "excerpt", "contentBlocks", "idempotencyKey"],
      properties: {
        articleId: { type: "string", format: "uuid" }, title: { type: "string", minLength: 1, maxLength: 180 },
        excerpt: { type: "string", minLength: 1, maxLength: 500 }, contentBlocks: { type: "array", minItems: 1, maxItems: 50, items: ARTICLE_BLOCK_SCHEMA },
        seoTitle: { type: "string", minLength: 1, maxLength: 180 }, seoDescription: { type: "string", minLength: 1, maxLength: 320 },
        authorName: { type: "string", minLength: 1, maxLength: 120 }, idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
      },
    },
    outputSchema: ARTICLE_COMMAND_OUTPUT_SCHEMA,
    securitySchemes: ARTICLE_OAUTH_SECURITY,
    _meta: { securitySchemes: ARTICLE_OAUTH_SECURITY },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "schedule_article_publication",
    title: "Schedule article publication",
    description: "Schedule one exact article revision for future publication. The scheduler publishes only that revision after the policy-approved time.",
    inputSchema: {
      type: "object", additionalProperties: false,
      required: ["articleId", "revisionId", "scheduledAt", "idempotencyKey"],
      properties: {
        articleId: { type: "string", format: "uuid" }, revisionId: { type: "string", format: "uuid" },
        scheduledAt: { type: "string", format: "date-time" }, idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        correlationId: { type: "string", format: "uuid" },
      },
    },
    outputSchema: ARTICLE_COMMAND_OUTPUT_SCHEMA,
    securitySchemes: ARTICLE_OAUTH_SECURITY,
    _meta: { securitySchemes: ARTICLE_OAUTH_SECURITY },
    annotations: CONSEQUENTIAL_WRITE_ANNOTATIONS,
  },
  {
    name: "publish_article",
    title: "Publish an article revision",
    description: "Publish one exact article revision after the active policy authorizes the command. The current beta policy allows this automatically while preserving validation and audit attribution.",
    inputSchema: {
      type: "object", additionalProperties: false,
      required: ["articleId", "revisionId", "idempotencyKey"],
      properties: {
        articleId: { type: "string", format: "uuid" }, revisionId: { type: "string", format: "uuid" },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 }, correlationId: { type: "string", format: "uuid" },
      },
    },
    outputSchema: ARTICLE_COMMAND_OUTPUT_SCHEMA,
    securitySchemes: ARTICLE_OAUTH_SECURITY,
    _meta: { securitySchemes: ARTICLE_OAUTH_SECURITY },
    annotations: CONSEQUENTIAL_WRITE_ANNOTATIONS,
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
          enum: OPERATIONS_SEMANTIC_COMMANDS,
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
    outputSchema: AGENT_DECISION_OUTPUT_SCHEMA,
    annotations: CONSEQUENTIAL_WRITE_ANNOTATIONS,
  },
];

function exposedMcpTools(articleOnly: boolean): McpTool[] {
  return articleOnly
    ? MCP_TOOLS.filter((tool) => ARTICLE_MCP_TOOL_NAMES.has(tool.name))
    : MCP_TOOLS.filter((tool) => !ARTICLE_MCP_TOOL_NAMES.has(tool.name));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function protocolJson(body: unknown, protocolVersion: string, status = 200): Response {
  const headers = new Headers(JSON_HEADERS);
  headers.set("MCP-Protocol-Version", protocolVersion);
  return new Response(JSON.stringify(body), { status, headers });
}

function requestProtocolVersion(request: Request): string | null {
  const requested = request.headers.get("MCP-Protocol-Version");
  // The header is optional only for the initial request. Once a client sends
  // it, silently downgrading an unknown version can make the client and server
  // interpret the same JSON-RPC exchange under different rules. MCP requires
  // an unsupported protocol header to fail with HTTP 400 instead.
  if (requested && !SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requested)) return null;
  return requested || MCP_PROTOCOL_VERSION;
}

function mcpOriginAllowed(request: Request): boolean {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) return true;
  try {
    const origin = new URL(rawOrigin).origin;
    return origin === new URL(request.url).origin || TRUSTED_MCP_ORIGINS.has(origin);
  } catch {
    return false;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function safeSecretEqual(actual: string | null, expected?: string): Promise<boolean> {
  if (!actual || !expected || actual.length < 16 || expected.length < 16
    || actual.length > 8_192 || expected.length > 8_192) return false;
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

function base64UrlBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeJwtJson<T>(value: string): T | null {
  const bytes = base64UrlBytes(value);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

function accessTeamDomain(value: string | undefined): string | null {
  const domain = value?.trim().toLowerCase() || "";
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(domain)
    ? domain
    : null;
}

async function loadAccessKeys(
  domain: string,
  forceRefresh = false,
): Promise<Map<string, CryptoKey>> {
  if (!forceRefresh && accessJwksCache && accessJwksCache.domain === domain
    && accessJwksCache.expiresAt > Date.now()) {
    return accessJwksCache.keys;
  }
  const response = await fetchWithTimeout(`https://${domain}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("access_jwks_unavailable");
  const body = await readBoundedResponseJson<{ keys?: AccessJwk[] }>(response, 256 * 1024);
  if (!Array.isArray(body.keys)) throw new Error("access_jwks_invalid");
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    if (jwk.kid && jwk.kty === "RSA" && jwk.alg === "RS256" && jwk.n && jwk.e) {
      try {
        const key = await crypto.subtle.importKey(
          "jwk",
          { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, use: jwk.use || "sig", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
        keys.set(jwk.kid, key);
      } catch {
        // Ignore malformed keys and fail closed if the token's key is absent.
      }
    }
  }
  if (!keys.size) throw new Error("access_jwks_empty");
  accessJwksCache = { domain, keys, expiresAt: Date.now() + ACCESS_JWKS_TTL_MS };
  return keys;
}

async function verifyCloudflareAccessJwt(
  request: Request,
  env: AgentWorkerEnv,
): Promise<boolean> {
  const domain = accessTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = env.CF_ACCESS_AUDIENCE?.trim();
  if (!domain || !audience || audience.length > 256) return false;
  const assertion = request.headers.get("cf-access-jwt-assertion");
  const authorization = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const token = assertion?.trim() || authorization;
  if (!token || token.length > 16_384) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const header = decodeJwtJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = decodeJwtJson<AccessClaims>(parts[1]);
  const signature = base64UrlBytes(parts[2]);
  if (!header?.kid || header.alg !== "RS256" || !claims || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (claims.type !== "app" || claims.iss !== `https://${domain}`
    || typeof claims.iat !== "number" || claims.iat > now + ACCESS_CLOCK_SKEW_SECONDS
    || typeof claims.exp !== "number" || claims.exp <= now - ACCESS_CLOCK_SKEW_SECONDS
    || (typeof claims.nbf === "number" && claims.nbf > now + ACCESS_CLOCK_SKEW_SECONDS)) return false;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return false;
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let key: CryptoKey | undefined;
  try {
    key = (await loadAccessKeys(domain)).get(header.kid);
    if (!key) key = (await loadAccessKeys(domain, true)).get(header.kid);
    if (!key) return false;
    return await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      signingInput,
    );
  } catch {
    return false;
  }
}

function requiredString(args: Record<string, unknown>, key: string, maximum = 4_000): string {
  const value = optionalString(args, key, maximum);
  if (!value) throw new Error(`missing_${key}`);
  return value;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredEmail(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function requiredSenderIdentity(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key, 300).toLowerCase();
  if (!/^[a-z0-9._%+-]+@donatebymail\.org$/.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function requiredUuid(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key, 36);
  if (!UUID_PATTERN.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function optionalUuid(args: Record<string, unknown>, key: string): string | null {
  const value = optionalString(args, key, 36);
  if (value && !UUID_PATTERN.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function optionalPublicId(args: Record<string, unknown>, key: string): string | null {
  const value = optionalString(args, key, 21);
  if (value && !/^DBM-[0-9]{8}-[A-F0-9]{8}$/.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function requiredSlug(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key, 120);
  if (value.length < 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function requiredEnum<T extends string>(args: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = requiredString(args, key, 120);
  if (!values.includes(value as T)) throw new Error(`invalid_${key}`);
  return value as T;
}

const ISO_DATE_TIME_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function optionalDateTime(args: Record<string, unknown>, key: string): string | null {
  const value = optionalString(args, key, 80);
  if (value && (Number.isNaN(Date.parse(value)) || !ISO_DATE_TIME_WITH_ZONE.test(value))) throw new Error(`invalid_${key}`);
  return value;
}

function requiredDateTime(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key, 80);
  if (Number.isNaN(Date.parse(value)) || !ISO_DATE_TIME_WITH_ZONE.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function optionalSecureUrl(args: Record<string, unknown>, key: string): string | null {
  const value = optionalString(args, key, 1_000);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe_url");
  } catch {
    throw new Error(`invalid_${key}`);
  }
  return value;
}

function requiredHash(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key, 64);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function requiredFailureCode(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key, 80);
  if (!/^[a-z][a-z0-9_]{2,79}$/.test(value)) throw new Error(`invalid_${key}`);
  return value;
}

function requiredIdempotencyKey(args: Record<string, unknown>, key = "idempotencyKey"): string {
  const value = requiredString(args, key, 200);
  if (value.length < 8) throw new Error(`invalid_${key}`);
  return value;
}

function boundedObject(args: Record<string, unknown>, key: string, maximumBytes = 50_000): Record<string, unknown> {
  const value = args[key];
  if (value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid_${key}`);
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Error(`invalid_${key}`); }
  if (new TextEncoder().encode(encoded).byteLength > maximumBytes) throw new Error(`invalid_${key}`);
  return value as Record<string, unknown>;
}

function optionalString(args: Record<string, unknown>, key: string, maximum = 4_000): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`invalid_${key}`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new Error(`invalid_${key}`);
  return trimmed || null;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new Error(`invalid_${key}`);
  return value;
}

function optionalInteger(args: Record<string, unknown>, key: string, fallback: number, maximum = 50): number {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error(`invalid_${key}`);
  return Number(value);
}

function emailArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length < 1 || value.length > 25)
    throw new Error(`invalid_${key}`);
  const emails = value.map((item) => {
    if (typeof item !== "string") throw new Error(`invalid_${key}`);
    const email = item.trim().toLowerCase();
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error(`invalid_${key}`);
    return email;
  });
  return [...new Set(emails)];
}

function articleBlocks(args: Record<string, unknown>, key: string): unknown[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error(`invalid_${key}`);
  const textBounded = (candidate: unknown, maximum: number) =>
    typeof candidate === "string" && candidate.trim().length > 0 && candidate.length <= maximum;
  const exactKeys = (candidate: Record<string, unknown>, keys: string[]) =>
    Object.keys(candidate).every((candidateKey) => keys.includes(candidateKey));
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`invalid_${key}`);
    const block = candidate as Record<string, unknown>;
    switch (block.type) {
      case "paragraph":
      case "quote":
        if (!exactKeys(block, ["type", "text"]) || !textBounded(block.text, 4_000)) throw new Error(`invalid_${key}`);
        break;
      case "heading":
        if (!exactKeys(block, ["type", "level", "text"]) || !Number.isInteger(block.level)
          || ![2, 3, 4].includes(block.level as number) || !textBounded(block.text, 180)) throw new Error(`invalid_${key}`);
        break;
      case "list":
        if (!exactKeys(block, ["type", "ordered", "items"]) || typeof block.ordered !== "boolean"
          || !Array.isArray(block.items) || block.items.length < 1 || block.items.length > 24
          || !block.items.every((item) => textBounded(item, 400))) throw new Error(`invalid_${key}`);
        break;
      case "link": {
        if (!exactKeys(block, ["type", "label", "href"]) || !textBounded(block.label, 180)
          || !textBounded(block.href, 1_000) || typeof block.href !== "string") throw new Error(`invalid_${key}`);
        const href = block.href.trim();
        // WHATWG URL parsing treats backslashes as slash separators. Reject
        // them before accepting a root-relative path so `/\\evil` cannot
        // normalize into an external `https://evil/` destination.
        if (/[\s\\<>"']/.test(href) || href.startsWith("//")) throw new Error(`invalid_${key}`);
        if (href.startsWith("/")) break;
        try {
          const url = new URL(href);
          if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe_link");
        } catch {
          throw new Error(`invalid_${key}`);
        }
        break;
      }
      default:
        throw new Error(`invalid_${key}`);
    }
  }
  return value;
}

async function runSemanticCommand(
  env: AgentWorkerEnv,
  command: string,
  targetType: string,
  targetId: string | null,
  risk: string,
  facts: Record<string, unknown>,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  correlationId?: string | null,
): Promise<unknown> {
  if (!isSemanticCommand(command) || !isRiskLevel(risk)) throw new Error("invalid_semantic_command");
  const inputHash = await sha256Hex(canonicalAuthorizationInput({
    agentIdentity: AGENT_IDENTITY, command, targetType, targetId, risk, facts, payload,
  }));
  const decision = await supabaseRpc<Record<string, unknown>>(env, "evaluate_agent_command", {
    agent_identity: AGENT_IDENTITY, command_value: command, target_kind: targetType,
    target_value: targetId, risk_value: risk, facts, input_hash_value: inputHash,
    correlation_value: correlationId || crypto.randomUUID(), idempotency_value: idempotencyKey,
  });
  if (decision.outcome !== "ALLOW_AUTOMATICALLY" || decision.replayed || !decision.decisionId) return { decision, execution: null };
  const execution = ["create_article_draft", "update_article_content", "schedule_article_publication", "publish_article"].includes(command)
    ? await supabaseRpc(env, "agent_execute_article_command", {
      decision_id_value: decision.decisionId, agent_identity: AGENT_IDENTITY,
      command_value: command, target_id_value: targetId, payload_value: payload,
    })
    : null;
  return { decision, execution };
}

async function supabaseRpc<T>(
  env: AgentWorkerEnv,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl || !env.SUPABASE_SECRET_KEY)
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
  const response = await fetchWithTimeout(
    `${baseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
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
  return readBoundedResponseJson<T>(response, 8 * 1024 * 1024);
}

function toolResult(id: JsonRpcRequest["id"], value: unknown, protocolVersion: string): Response {
  const serializedValue = JSON.stringify(value);
  if (typeof serializedValue !== "string")
    throw new Error("agent_tool_result_too_large");
  // MCP carries the same value in both the human-readable content block and
  // structuredContent. Bound the complete JSON-RPC envelope, not only one
  // copy of the value, so duplication cannot turn a nominally bounded result
  // into an oversized response.
  const body = {
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: serializedValue }],
      structuredContent: value,
    },
  };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_MCP_TOOL_RESPONSE_BYTES)
    throw new Error("agent_tool_result_too_large");
  return protocolJson(body, protocolVersion);
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
        requester_email: requiredEmail(args, "requesterEmail"),
        public_id_hint: optionalPublicId(args, "publicId"),
        result_limit: optionalInteger(args, "resultLimit", 10),
      });
    case "get_donation_support_snapshot":
      return supabaseRpc(env, "agent_get_donation_support_snapshot", {
        agent_identity: AGENT_IDENTITY,
        candidate_donation_id: requiredUuid(args, "donationId"),
        requester_email: requiredEmail(args, "requesterEmail"),
      });
    case "get_partner_support_snapshot":
      return supabaseRpc(env, "agent_get_partner_support_snapshot", {
        agent_identity: AGENT_IDENTITY,
        requester_email: requiredEmail(args, "requesterEmail"),
      });
    case "get_operations_overview":
      return supabaseRpc(env, "agent_get_operations_overview", {
        agent_identity: AGENT_IDENTITY,
      });
    case "record_inbound_message":
      return supabaseRpc(env, "agent_record_inbound_message", {
        agent_identity: AGENT_IDENTITY,
        provider_value: requiredEnum(args, "provider", ["gmail", "brevo", "manual"]),
        external_thread_value: requiredString(args, "externalThreadRef", 300),
        external_message_value: requiredString(args, "externalMessageRef", 300),
        sender_email: requiredEmail(args, "senderEmail"),
        recipient_emails: emailArray(args, "recipientEmails"),
        subject_value: optionalString(args, "subject", 500) ?? "",
        body_summary_value: requiredString(args, "bodySummary", 2_000),
        body_storage_value: optionalString(args, "bodyStorageRef", 500),
        occurred_at_value: optionalDateTime(args, "occurredAt") ?? new Date().toISOString(),
        candidate_donation_id: optionalUuid(args, "donationId"),
        candidate_organization_id: optionalUuid(args, "organizationId"),
        candidate_campaign_id: optionalUuid(args, "campaignId"),
      });
    case "authorize_support_message":
      return supabaseRpc(env, "agent_authorize_support_message_payload", {
        agent_identity: AGENT_IDENTITY,
        message_category: requiredEnum(args, "category", SUPPORT_CATEGORIES),
        recipient_email: requiredEmail(args, "recipientEmail"),
        subject_value: requiredString(args, "subject", 500),
        body_value: requiredString(args, "body", 12_000),
        body_summary_value: requiredString(args, "bodySummary", 2_000),
        idempotency_value: requiredIdempotencyKey(args),
        correlation_value: optionalUuid(args, "correlationId"),
        candidate_donation_id: optionalUuid(args, "donationId"),
        candidate_organization_id: optionalUuid(args, "organizationId"),
        candidate_campaign_id: optionalUuid(args, "campaignId"),
        requests_financial_action: optionalBoolean(args, "requestsFinancialAction"),
        requests_legal_or_tax_advice: optionalBoolean(args, "requestsLegalOrTaxAdvice"),
        requests_access_change: optionalBoolean(args, "requestsAccessChange"),
        security_or_privacy_incident: optionalBoolean(args, "securityOrPrivacyIncident"),
        complaint_or_threat: optionalBoolean(args, "complaintOrThreat"),
      });
    case "record_outbound_message":
      return supabaseRpc(env, "agent_record_outbound_message_checked", {
        agent_identity: AGENT_IDENTITY,
        authorization_value: requiredUuid(args, "authorizationId"),
        recipient_email_value: requiredEmail(args, "recipientEmail"),
        subject_value: requiredString(args, "subject", 500),
        body_value: requiredString(args, "body", 12_000),
        content_hash_value: requiredHash(args, "contentHash"),
        provider_value: requiredEnum(args, "provider", ["gmail", "brevo", "manual"]),
        external_thread_value: requiredString(args, "externalThreadRef", 300),
        external_message_value: requiredString(args, "externalMessageRef", 300),
        sender_identity_value: requiredSenderIdentity(args, "senderIdentity"),
        sent_at_value: optionalDateTime(args, "sentAt") ?? new Date().toISOString(),
      });
    case "record_message_failure":
      return supabaseRpc(env, "agent_record_message_failure", {
        agent_identity: AGENT_IDENTITY,
        authorization_value: requiredUuid(args, "authorizationId"),
        failure_code: requiredFailureCode(args, "failureCode"),
      });
    case "create_partner_lead":
      return supabaseRpc(env, "agent_create_partner_lead", {
        agent_identity: AGENT_IDENTITY,
        requester_email: requiredEmail(args, "requesterEmail"),
        organization_name_value: requiredString(args, "organizationName", 200),
        request_summary_value: requiredString(args, "requestSummary", 4_000),
        idempotency_value: requiredIdempotencyKey(args),
        correlation_value: optionalUuid(args, "correlationId"),
        website_url_value: optionalSecureUrl(args, "websiteUrl"),
        audience_summary_value: optionalString(args, "audienceSummary", 2_000),
        goal_summary_value: optionalString(args, "goalSummary", 2_000),
        timing_summary_value: optionalString(args, "timingSummary", 2_000),
        external_thread_value: optionalString(args, "externalThreadRef", 300),
      });
    case "set_communication_thread_status":
      return supabaseRpc(env, "agent_set_communication_thread_status", {
        agent_identity: AGENT_IDENTITY,
        candidate_thread_id: requiredUuid(args, "threadId"),
        status_value: requiredEnum(args, "status", ["open", "waiting_on_contact", "waiting_on_staff", "resolved", "closed"]),
      });
    case "list_articles":
      return { articles: await supabaseRpc<unknown[]>(env, "get_published_articles", {}) };
    case "get_article":
      return { article: await supabaseRpc<Record<string, unknown> | null>(env, "get_published_article", { candidate_slug: requiredSlug(args, "slug") }) };
    case "create_article_draft":
      return runSemanticCommand(env, "create_article_draft", "article", null, "low", {}, {
        slug: requiredSlug(args, "slug"), title: requiredString(args, "title", 180), excerpt: requiredString(args, "excerpt", 500),
        contentBlocks: articleBlocks(args, "contentBlocks"), seoTitle: optionalString(args, "seoTitle", 180),
        seoDescription: optionalString(args, "seoDescription", 320), authorName: optionalString(args, "authorName", 120),
      }, requiredIdempotencyKey(args), optionalUuid(args, "correlationId"));
    case "update_article_content":
      return runSemanticCommand(env, "update_article_content", "article", requiredUuid(args, "articleId"), "low", {}, {
        title: requiredString(args, "title", 180), excerpt: requiredString(args, "excerpt", 500),
        contentBlocks: articleBlocks(args, "contentBlocks"), seoTitle: optionalString(args, "seoTitle", 180),
        seoDescription: optionalString(args, "seoDescription", 320), authorName: optionalString(args, "authorName", 120),
      }, requiredIdempotencyKey(args), optionalUuid(args, "correlationId"));
    case "schedule_article_publication":
      return runSemanticCommand(env, "schedule_article_publication", "article", requiredUuid(args, "articleId"), "moderate", {}, {
        revisionId: requiredUuid(args, "revisionId"), scheduledAt: requiredDateTime(args, "scheduledAt"),
      }, requiredIdempotencyKey(args), optionalUuid(args, "correlationId"));
    case "publish_article":
      return runSemanticCommand(env, "publish_article", "article", requiredUuid(args, "articleId"), "moderate", {}, {
        revisionId: requiredUuid(args, "revisionId"),
      }, requiredIdempotencyKey(args), optionalUuid(args, "correlationId"));
    case "evaluate_semantic_command": {
      const command = requiredString(args, "command", 80);
      const risk = requiredString(args, "risk", 40);
      const idempotencyKey = requiredIdempotencyKey(args);
      if (!OPERATIONS_SEMANTIC_COMMANDS.includes(command as typeof OPERATIONS_SEMANTIC_COMMANDS[number])
        || !isSemanticCommand(command) || !isRiskLevel(risk))
        throw new Error("invalid_semantic_command");
      const targetType = requiredString(args, "targetType", 80);
      const targetId = optionalUuid(args, "targetId");
      const facts = boundedObject(args, "facts");
      const payload = boundedObject(args, "payload");
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
        correlation_value: optionalUuid(args, "correlationId") ?? crypto.randomUUID(),
        idempotency_value: idempotencyKey,
      });
    }
    default:
      throw new Error("unknown_tool");
  }
}

function validateToolArgumentShape(name: string, args: Record<string, unknown>): void {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error("unknown_tool");
  if (Object.keys(args).length > 64) throw new Error("too_many_tool_arguments");
  const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
  const properties = schema.properties || {};
  if (Object.keys(args).some((key) => !Object.prototype.hasOwnProperty.call(properties, key)))
    throw new Error("unknown_tool_argument");
  if ((schema.required || []).some((key) => !Object.prototype.hasOwnProperty.call(args, key)))
    throw new Error("missing_tool_argument");
}

async function isTrustedArticleRequest(request: Request, env: AgentWorkerEnv): Promise<boolean> {
  const url = new URL(request.url);
  if (url.hostname === "mcp-beta.donatebymail.org") {
    return verifyCloudflareAccessJwt(request, env);
  }
  if (url.hostname === "mcp-connector-beta.donatebymail.org") {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    return safeSecretEqual(bearer, env.MCP_ARTICLE_BEARER_TOKEN);
  }
  if (url.hostname === "mcp-oauth-beta.donatebymail.org") {
    // Cloudflare Access validates the managed-OAuth token before forwarding,
    // but the origin must still verify the signed assertion (or forwarded
    // bearer JWT) rather than trusting a header's presence.
    return verifyCloudflareAccessJwt(request, env);
  }
  return false;
}

async function handleAgentMcp(request: Request, env: AgentWorkerEnv, articleOnly = false): Promise<Response> {
  if (!mcpOriginAllowed(request))
    return json({ jsonrpc: "2.0", error: { code: -32002, message: "Origin not allowed" }, id: null }, 403);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const authorized = articleOnly
    ? await isTrustedArticleRequest(request, env)
    : await safeSecretEqual(bearer, env.AGENT_API_KEY);
  if (!authorized)
    return json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }, 401);
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  const exposedTools = exposedMcpTools(articleOnly);

  let rpc: JsonRpcRequest;
  try {
    rpc = await readJson(request, 100_000) as JsonRpcRequest;
    if (!rpc || typeof rpc !== "object" || Array.isArray(rpc)) throw new Error("invalid_mcp_request");
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Request is too large.";
    return json({ jsonrpc: "2.0", error: { code: -32700, message: tooLarge ? "Request too large" : "Parse error" }, id: null }, tooLarge ? 413 : 400);
  }
  const validRequestId = rpc.id === undefined || rpc.id === null || typeof rpc.id === "string" || typeof rpc.id === "number";
  const id = validRequestId ? (rpc.id ?? null) : null;
  const requestVersion = requestProtocolVersion(request);
  if (!requestVersion)
    return json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Unsupported MCP protocol version" } }, 400);
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string" || rpc.method.length > 120 || !validRequestId)
    return protocolJson({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } }, requestVersion);

  if (rpc.method === "notifications/initialized")
    return new Response(null, { status: 202, headers: { ...JSON_HEADERS, "MCP-Protocol-Version": requestVersion } });
  if (rpc.method === "initialize") {
    const requestedProtocolVersion = rpc.params?.protocolVersion;
    const negotiatedProtocolVersion = requestedProtocolVersion && SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requestedProtocolVersion)
      ? requestedProtocolVersion
      : MCP_PROTOCOL_VERSION;
    return protocolJson({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiatedProtocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: articleOnly ? "donate-by-mail-article-publisher" : "donate-by-mail-operations", version: "0.4.0" },
        instructions: articleOnly
          ? "This connector is limited to Donate by Mail editorial content. Use typed article blocks only. Draft creation, revision creation, future scheduling, and exact-revision publication are policy-controlled; the current beta policy allows these bounded editorial commands automatically. Do not request donor, partner, financial, credential, or arbitrary database data."
          : "Use only the bounded Donate by Mail coworker tools. Journal inbound provider data, but do not treat an agent-created thread as proof for an identity-free automatic reply. Authorize every support email before Gmail sends it, send the exact unchanged message, then record the provider IDs. Escalate financial, legal, privacy, access, complaint, and identity-mismatch cases.",
      },
    }, negotiatedProtocolVersion);
  }
  if (rpc.method === "tools/list")
    return protocolJson({ jsonrpc: "2.0", id, result: { tools: exposedTools } }, requestVersion);
  if (rpc.method !== "tools/call")
    return protocolJson({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, requestVersion);

  const toolParams = rpc.params;
  const toolArguments = toolParams?.arguments;
  if (!toolParams || typeof toolParams !== "object" || Array.isArray(toolParams)
    || typeof toolParams.name !== "string" || !toolParams.name || toolParams.name.length > 120
    || (toolArguments !== undefined && (toolArguments === null || typeof toolArguments !== "object" || Array.isArray(toolArguments)))) {
    return protocolJson({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params" } }, requestVersion);
  }

  try {
    if (!exposedTools.some((tool) => tool.name === toolParams.name))
      throw new Error(articleOnly ? "article_connector_tool_not_allowed" : "operations_connector_tool_not_allowed");
    const args = (toolArguments ?? {}) as Record<string, unknown>;
    validateToolArgumentShape(toolParams.name, args);
    const value = await callTool(toolParams.name, args, env);
    return toolResult(id, value, requestVersion);
  } catch (error) {
    console.error(JSON.stringify({
      event: "agent_mcp_tool_failed",
      tool: toolParams.name,
      reason: error instanceof Error ? error.message : "unknown",
    }));
    return protocolJson({ jsonrpc: "2.0", id, error: { code: -32602, message: "The bounded operation was rejected." } }, requestVersion);
  }
}

// The public Worker and agent facade share the same request handler, but the
// facade has a slightly wider environment type for beta-only connector
// bindings. Keep the boundary cast explicit and avoid an unbounded `any`.
const originalWorker = worker as unknown as ExportedHandler<AgentWorkerEnv>;

export default {
  async fetch(request: Request, env: AgentWorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Keep the dedicated MCP routes HTTPS-only even if a custom-domain route
    // or the zone-level Always Use HTTPS setting is accidentally weakened.
    // Loopback HTTP remains available only to the local beta harness through
    // the shared Worker fallback.
    const loopbackHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.protocol === "http:" && !loopbackHost && !isLocalBetaHarness(env, url.hostname)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    const portalArticleHost = url.hostname === "mcp-connector-beta.donatebymail.org"
      || url.hostname === "mcp-oauth-beta.donatebymail.org";
    const privateArticleHost = url.hostname === "mcp-beta.donatebymail.org" && url.pathname === "/mcp/articles";
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && portalArticleHost
      && (url.pathname === "/mcp" || url.pathname === "/mcp/articles"))
      return handleAgentMcp(request, env, true);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && privateArticleHost)
      return handleAgentMcp(request, env, true);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && OPERATIONS_MCP_HOSTS.has(url.hostname) && url.pathname === "/mcp")
      return handleAgentMcp(request, env);
    // Dedicated connector hostnames must never fall through to the normal
    // beta SPA or inherit another connector's capability surface.
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && (ARTICLE_MCP_HOSTS.has(url.hostname) || url.hostname === "mcp-operations-connector-beta.donatebymail.org"))
      return json({ ok: false, code: "connector_path_not_found" }, 404);
    if (!originalWorker.fetch) throw new Error("worker_fetch_unavailable");
    return originalWorker.fetch(
      request as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>,
      env,
      ctx,
    );
  },
  async scheduled(controller: ScheduledController, env: AgentWorkerEnv, ctx: ExecutionContext): Promise<void> {
    if (originalWorker.scheduled) await originalWorker.scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<AgentWorkerEnv>;
