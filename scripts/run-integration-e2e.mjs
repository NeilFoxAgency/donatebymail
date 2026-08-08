import { execFileSync, spawnSync } from "node:child_process";

const commandTimeout = Number.parseInt(process.env.SUPABASE_COMMAND_TIMEOUT_MS || "180000", 10);

execFileSync("node", ["scripts/run-supabase-command.mjs", "db", "reset", "--local"], {
  stdio: "inherit",
  timeout: commandTimeout + 15_000,
});
const status = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  encoding: "utf8",
  timeout: 30_000,
});
const env = { ...process.env, RUN_LOCAL_INTEGRATION: "1" };
for (const line of status.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
  if (match) env[match[1]] = match[2];
}
const result = spawnSync("npx", ["vitest", "run", "src/gen2/integration.test.ts", "--reporter=verbose"], {
  stdio: "inherit",
  env,
  timeout: 120_000,
});
if (result.error) console.error(`Integration test process failed: ${result.error.message}`);
process.exit(result.status ?? 1);
