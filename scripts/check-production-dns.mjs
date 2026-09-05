import { resolveMx, resolveTxt } from "node:dns/promises";
import { fileURLToPath } from "node:url";

export const PRODUCTION_DOMAIN = "donatebymail.org";

export function flattenTxtRecords(records = []) {
  return records
    .filter((record) => Array.isArray(record))
    .map((record) => record.join(""))
    .filter(Boolean);
}

function startsWithRecord(record, prefix) {
  return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?:\\s|;|$)`, "i").test(String(record || "").trim());
}

function hasMechanism(record, mechanism) {
  const tokens = String(record || "").trim().toLowerCase().split(/\s+/);
  return tokens.some((token) => token === mechanism || (mechanism === "mx" && token.startsWith("mx:")));
}

function hasSafeTerminalAll(record) {
  const tokens = String(record || "").trim().toLowerCase().split(/\s+/);
  if (tokens.some((token) => token === "+all" || token === "?all")) return false;
  return tokens.at(-1) === "~all" || tokens.at(-1) === "-all";
}

function policyValue(record) {
  return String(record || "")
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .find((part) => part.startsWith("p="))
    ?.slice(2);
}

export function validateProductionDns({ txtRecords = [], dmarcRecords = [], mxRecords = [] } = {}) {
  const errors = [];
  const spf = flattenTxtRecords(txtRecords).filter((record) => startsWithRecord(record, "v=spf1"));
  if (spf.length !== 1) {
    errors.push(`Expected exactly one SPF record, found ${spf.length}.`);
  } else {
    for (const mechanism of ["include:_spf.google.com", "include:spf.brevo.com", "mx"]) {
      if (!hasMechanism(spf[0], mechanism)) errors.push(`SPF is missing the ${mechanism} mechanism.`);
    }
    if (!hasSafeTerminalAll(spf[0])) errors.push("SPF must end with a restrictive ~all or -all policy.");
  }

  const dmarc = flattenTxtRecords(dmarcRecords).filter((record) => startsWithRecord(record, "v=dmarc1"));
  if (dmarc.length !== 1) {
    errors.push(`Expected exactly one DMARC record, found ${dmarc.length}.`);
  } else if (!["none", "quarantine", "reject"].includes(policyValue(dmarc[0]))) {
    errors.push("DMARC must declare an explicit p=none, p=quarantine, or p=reject policy.");
  }

  if (!Array.isArray(mxRecords) || mxRecords.length === 0) errors.push("At least one MX record is required.");
  return errors;
}

async function resolveTxtOrEmpty(name) {
  try {
    return await resolveTxt(name);
  } catch (error) {
    if (error?.code === "ENODATA" || error?.code === "ENOTFOUND") return [];
    throw error;
  }
}

async function resolveMxOrEmpty(name) {
  try {
    return await resolveMx(name);
  } catch (error) {
    if (error?.code === "ENODATA" || error?.code === "ENOTFOUND") return [];
    throw error;
  }
}

export async function readProductionDns(domain = PRODUCTION_DOMAIN) {
  const [txtRecords, dmarcRecords, mxRecords] = await Promise.all([
    resolveTxtOrEmpty(domain),
    resolveTxtOrEmpty(`_dmarc.${domain}`),
    resolveMxOrEmpty(domain),
  ]);
  return { txtRecords, dmarcRecords, mxRecords };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const records = await readProductionDns();
    const errors = validateProductionDns(records);
    if (errors.length) {
      for (const error of errors) console.error(`Production DNS check failed: ${error}`);
      process.exit(1);
    }
    console.log(`Production DNS checks passed for ${PRODUCTION_DOMAIN}.`);
  } catch (error) {
    console.error(`Production DNS lookup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}
