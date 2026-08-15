export function checkProductionEndpoints(originValue?: string): Promise<{
  origin: string;
  health: Record<string, unknown>;
  ready: Record<string, unknown>;
  mcp: Record<string, unknown> | null;
  agent: Record<string, unknown> | null;
}>;
export function checkProductionHosts(originValue?: string): Promise<Array<{
  origin: string;
  health: Record<string, unknown>;
  ready: Record<string, unknown>;
  mcp: Record<string, unknown> | null;
  agent: Record<string, unknown> | null;
}>>;
