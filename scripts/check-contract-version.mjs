import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const source = readFileSync(resolve(root, "src/contractVersion.ts"), "utf8");
const readVersion = (name) => source.match(new RegExp(`${name} = \\"([0-9]{14})\\"`))?.[1] || "";
const application = readVersion("APPLICATION_CONTRACT_VERSION");
const agent = readVersion("BETA_AGENT_CONTRACT_VERSION");
const migrations = readdirSync(resolve(root, "supabase/migrations"));
const latestMigration = (suffix) => migrations
  .filter((file) => file.endsWith(suffix))
  .map((file) => file.match(/^(\d{14})_/)?.[1] || "")
  .sort()
  .at(-1) || "";
const expectedApplication = latestMigration("_application_contract_version_probe.sql");
const expectedAgent = latestMigration("_agent_send_time_identity_guard.sql");
const failures = [];
if (!application || application !== expectedApplication)
  failures.push(`Application contract ${application || "missing"} does not match ${expectedApplication || "the migration head"}.`);
if (!agent || agent !== expectedAgent)
  failures.push(`Agent contract ${agent || "missing"} does not match ${expectedAgent || "the migration head"}.`);
if (failures.length) {
  for (const failure of failures) console.error(`Contract version check failed: ${failure}`);
  process.exit(1);
}
console.log(`Contract versions match migration heads: application ${application}, beta agent ${agent}.`);
