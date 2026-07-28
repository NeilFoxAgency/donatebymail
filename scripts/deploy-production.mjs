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

const dirty = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (dirty) {
  console.error("Production deployment refused from a dirty working tree.");
  process.exit(1);
}

execFileSync("npm", ["run", "verify:app"], { stdio: "inherit" });
execFileSync("npx", ["wrangler", "deploy"], { stdio: "inherit" });
