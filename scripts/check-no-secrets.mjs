import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const candidateFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
  encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const patterns = [
  ["Supabase secret key", /sb_secret_[A-Za-z0-9._-]{16,}/],
  ["Brevo API key", /xkeysib-[A-Za-z0-9_-]{20,}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "assigned server secret",
    /(?:SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY|BREVO_API_KEY|PLEDGE_API_KEY)\s*[:=]\s*["'][^"'${\s][^"']{8,}["']/,
  ],
];

const findings = [];
for (const file of candidateFiles) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length) {
  console.error("Potential committed secrets detected (values intentionally omitted):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(
  `No known secret patterns found in ${candidateFiles.length} tracked or untracked candidate files.`,
);
