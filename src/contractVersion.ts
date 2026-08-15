/**
 * The database contract versions required before a Worker may advertise
 * readiness. Keep these values tied to the migration filenames through the
 * contract:check release check.
 */
export const APPLICATION_CONTRACT_VERSION = "20260808144611" as const;
export const BETA_AGENT_CONTRACT_VERSION = "20260808150002" as const;
