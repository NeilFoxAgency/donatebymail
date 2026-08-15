import { spawn, spawnSync } from "node:child_process";
import { withLocalSupabaseLock } from "./local-supabase-lock.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-supabase-command.mjs <supabase arguments>");
  process.exit(2);
}

const timeoutMs = Number.parseInt(process.env.SUPABASE_COMMAND_TIMEOUT_MS || "180000", 10);

async function runCommand() {
  const result = await new Promise((resolve) => {
    const child = spawn("npx", ["supabase", ...args], { stdio: "inherit" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, timedOut: false, error });
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), timedOut });
    });
  });
  if (result.error) {
    console.error(`Unable to start Supabase CLI: ${result.error.message}`);
    return 1;
  }
  if (!result.timedOut) return result.code;
  console.error(`Supabase command timed out after ${timeoutMs}ms: supabase ${args.join(" ")}`);
  const docker = spawnSync("docker", ["info", "--format", "{{json .ServerVersion}}"], {
    encoding: "utf8", timeout: 10_000,
  });
  if (docker.error) console.error(`Docker diagnostic failed: ${docker.error.message}`);
  else if (docker.status !== 0) console.error(`Docker is unavailable: ${(docker.stderr || docker.stdout).trim()}`);
  else console.error(`Docker server responded with version ${docker.stdout.trim()}.`);
  return 124;
}

const code = await withLocalSupabaseLock(runCommand, `supabase ${args.join(" ")}`);
process.exitCode = code;
