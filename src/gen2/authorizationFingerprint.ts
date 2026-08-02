import type { RiskLevel, SemanticCommand } from "./commandRegistry";

export type AuthorizationFingerprintInput = {
  agentIdentity: string;
  command: SemanticCommand;
  targetType: string;
  targetId: string | null;
  risk: RiskLevel;
  facts: unknown;
  payload: unknown;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The REST and MCP agent surfaces must hash precisely the same authorization
 * envelope. Keep this function free of transport-specific fields and include
 * every value that can affect policy evaluation or command execution.
 */
export function canonicalAuthorizationInput(input: AuthorizationFingerprintInput): string {
  return canonicalJson({
    agentIdentity: input.agentIdentity.trim(),
    command: input.command,
    targetType: input.targetType.trim() || "unknown",
    targetId: input.targetId || null,
    risk: input.risk,
    facts: input.facts ?? {},
    payload: input.payload ?? {},
  });
}
