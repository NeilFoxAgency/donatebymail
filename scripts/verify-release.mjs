import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { withLocalSupabaseLock } from "./local-supabase-lock.mjs";

const commandTimeout = Number.parseInt(process.env.RELEASE_COMMAND_TIMEOUT_MS || "300000", 10);

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    stdio: "inherit",
    timeout: commandTimeout,
    ...options,
  });
}

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyGeneratedTypesStable() {
  const path = "src/types/database.generated.ts";
  const before = fileDigest(path);
  run("npm", ["run", "db:types"]);
  const after = fileDigest(path);
  if (before !== after) {
    throw new Error(`${path} changed during generation. Regenerate and review the database type diff before release verification.`);
  }
  console.log(`Generated database types are idempotent (${after}).`);
}

run("npm", ["run", "security:secrets"]);
run("npm", ["run", "audit:all"]);
run("npm", ["run", "contract:check"]);
run("npm", ["run", "typecheck"]);

await withLocalSupabaseLock(async () => {
  run("npm", ["run", "db:reset"]);
  run("npm", ["run", "db:lint"]);
  run("npm", ["run", "db:advisors"]);
  run("npm", ["run", "test:db"]);
  verifyGeneratedTypesStable();
  run("npm", ["run", "test:integration"]);
}, "complete release database verification");

run("npm", ["run", "build"]);
run("npm", ["run", "seo:check"]);
run("npm", ["run", "test:e2e"], { timeout: commandTimeout * 2 });
run("npx", ["wrangler", "types", "--check"]);
run("npx", ["wrangler", "deploy", "--env", "beta", "--dry-run", "--strict"]);
run("npx", ["wrangler", "deploy", "--env=", "--dry-run", "--strict"]);
