import { execFileSync } from "node:child_process";

const confirmation = process.env.DONATE_BY_MAIL_PRODUCTION_DEPLOY;
if (confirmation !== "donatebymail.org") {
  console.error(
    "Production deployment refused. Set DONATE_BY_MAIL_PRODUCTION_DEPLOY=donatebymail.org only during an approved production release.",
  );
  process.exit(1);
}

const branch = execFileSync("git", ["branch", "--show-current"], {
  encoding: "utf8",
}).trim();
if (branch !== "main") {
  console.error(`Production deployment refused from branch ${branch || "(detached)"}.`);
  process.exit(1);
}

let remote = "";
try {
  remote = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
} catch {
  remote = "";
}
if (remote !== "https://github.com/neilfoxagency/donatebymail") {
  console.error(`Production deployment refused from unexpected origin ${remote || "(missing)"}.`);
  process.exit(1);
}

const dirty = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (dirty) {
  console.error("Production deployment refused from a dirty working tree.");
  process.exit(1);
}

execFileSync("node", ["scripts/check-production-config.mjs", "--remote-secrets"], { stdio: "inherit" });
execFileSync("npm", ["run", "check:production-auth"], { stdio: "inherit" });
execFileSync("npm", ["run", "check:production-edge"], { stdio: "inherit" });
execFileSync("npm", ["run", "check:production-dns"], { stdio: "inherit" });

// Exercise the full release suite with Cloudflare's non-production test
// sitekey. The approved real sitekey is restored for the final build below.
execFileSync("npm", ["run", "verify:release"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    VITE_PLEDGE_PARTNER_KEY: process.env.VITE_PLEDGE_PARTNER_KEY || "release-verification-placeholder",
    VITE_PLEDGE_ENV: "production",
  },
});
execFileSync("npm", ["run", "build"], { stdio: "inherit" });
execFileSync("node", ["scripts/check-production-config.mjs", "--bundle"], { stdio: "inherit" });
execFileSync("npx", ["wrangler", "deploy", "--env=", "--strict"], { stdio: "inherit" });
// A successful upload is not proof that the custom production hostname is
// serving this Worker. Fail the release command unless the live hostname
// returns the JSON health/readiness contract and explicit agent/MCP-disabled
// responses after deployment.
execFileSync("npm", ["run", "smoke:production"], { stdio: "inherit" });
