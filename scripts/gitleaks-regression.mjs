import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const gitleaks = process.env.GITLEAKS_BIN || "gitleaks";
const fixtureDirectory = mkdtempSync(join(tmpdir(), "donate-by-mail-gitleaks-"));
const fixturePath = join(fixtureDirectory, "credential.txt");

try {
  // Construct the fixture at runtime so the repository never contains a
  // credential-shaped literal. The assignment has the shape and entropy of a
  // real generic API key, which the inherited Gitleaks rules must reject.
  const key = ["a9F2jK7m", "Q4vX8nR6", "tY3pW5sD", "1cL0zB9h"].join("");
  writeFileSync(fixturePath, `api_key = "${key}"\n`);
  const result = spawnSync(
    gitleaks,
    ["dir", "--config", resolve(".gitleaks.toml"), "--exit-code", "77", "--no-banner", "--redact", fixtureDirectory],
    { encoding: "utf8" },
  );

  if (result.error) {
    if (result.error.code === "ENOENT")
      throw new Error(`Gitleaks binary not found (${gitleaks}). Install the pinned CI version or set GITLEAKS_BIN.`);
    throw result.error;
  }
  if (result.status !== 77) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`Expected Gitleaks to reject the API-key-shaped fixture; exit status was ${result.status}.`);
  }
  console.log("Gitleaks regression passed: credential-shaped fixture was rejected.");
} catch (error) {
  console.error(`Gitleaks regression failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
