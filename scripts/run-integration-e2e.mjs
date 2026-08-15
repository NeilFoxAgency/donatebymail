import { execFileSync, spawnSync } from "node:child_process";
import { withLocalSupabaseLock } from "./local-supabase-lock.mjs";

const commandTimeout = Number.parseInt(process.env.SUPABASE_COMMAND_TIMEOUT_MS || "180000", 10);

const statusCode = await withLocalSupabaseLock(async () => {
  const reset = () => {
    execFileSync("node", ["scripts/run-supabase-command.mjs", "db", "reset", "--local"], {
      stdio: "inherit",
      timeout: commandTimeout + 15_000,
    });
    execFileSync("node", ["scripts/wait-for-local-db.mjs"], {
      stdio: "inherit",
      timeout: 45_000,
    });
  };
  reset();
  try {
    let status = "";
    let lastDiagnostic = "Supabase status did not return output.";
    const statusDeadline = Date.now() + 45_000;
    while (Date.now() < statusDeadline) {
      const attempt = spawnSync("npx", ["supabase", "status", "-o", "env"], {
        encoding: "utf8",
        timeout: 15_000,
      });
      if (attempt.status === 0 && attempt.stdout) { status = attempt.stdout; break; }
      lastDiagnostic = [attempt.stderr, attempt.stdout, attempt.error?.message].filter(Boolean).join("\n").trim() || lastDiagnostic;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!status) throw new Error(`Local Supabase did not become ready within 45 seconds.\n${lastDiagnostic}`);
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
    return result.status ?? 1;
  } finally {
    // Integration fixtures use fixed identifiers by design. Restore a clean,
    // migrated local database so the next agent starts from deterministic state.
    reset();
  }
}, "integration database reset and Worker test");
process.exitCode = statusCode;
