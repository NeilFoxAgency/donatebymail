import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-supabase-command.mjs <supabase arguments>");
  process.exit(2);
}

const timeoutMs = Number.parseInt(process.env.SUPABASE_COMMAND_TIMEOUT_MS || "180000", 10);
const child = spawn("npx", ["supabase", ...args], { stdio: "inherit" });
let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
}, timeoutMs);

child.once("error", (error) => {
  clearTimeout(timer);
  console.error(`Unable to start Supabase CLI: ${error.message}`);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  clearTimeout(timer);
  if (!timedOut) process.exit(code ?? (signal ? 1 : 0));

  console.error(`Supabase command timed out after ${timeoutMs}ms: supabase ${args.join(" ")}`);
  const docker = spawnSync("docker", ["info", "--format", "{{json .ServerVersion}}"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (docker.error) console.error(`Docker diagnostic failed: ${docker.error.message}`);
  else if (docker.status !== 0) console.error(`Docker is unavailable: ${(docker.stderr || docker.stdout).trim()}`);
  else console.error(`Docker server responded with version ${docker.stdout.trim()}.`);
  process.exit(124);
});
