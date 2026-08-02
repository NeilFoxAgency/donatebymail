import { execFileSync, spawnSync } from "node:child_process";

execFileSync("npx", ["supabase", "db", "reset", "--local"], { stdio: "inherit" });
const status = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" });
const env = { ...process.env, RUN_LOCAL_INTEGRATION: "1" };
for (const line of status.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
  if (match) env[match[1]] = match[2];
}
const result = spawnSync("npx", ["vitest", "run", "src/gen2/integration.test.ts", "--reporter=verbose"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
