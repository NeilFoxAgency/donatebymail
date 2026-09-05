import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LOCK_TOKEN_ENV = "DBM_LOCAL_SUPABASE_LOCK_TOKEN";
const LOCK_WAIT_MS = Number.parseInt(process.env.DBM_LOCAL_SUPABASE_LOCK_WAIT_MS || "300000", 10);
const STALE_LOCK_MS = Number.parseInt(process.env.DBM_LOCAL_SUPABASE_STALE_LOCK_MS || "1200000", 10);

function lockDirectory() {
  const workspace = resolve(process.cwd());
  const digest = createHash("sha256").update(workspace).digest("hex").slice(0, 16);
  return join(tmpdir(), `donate-by-mail-supabase-${digest}.lock`);
}
function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function staleLockMayBeRemoved(directory) {
  try {
    const [metadata, details] = await Promise.all([
      readFile(join(directory, "owner.json"), "utf8").then(JSON.parse).catch(() => null),
      stat(directory),
    ]);
    const age = Date.now() - details.mtimeMs;
    return age > STALE_LOCK_MS && !processIsAlive(metadata?.pid);
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/**
 * Serialize workflows that mutate or test the repository's shared local
 * Supabase stack. Nested scripts inherit the token and do not deadlock.
 */
export async function withLocalSupabaseLock(operation, label = "local Supabase workflow") {
  if (process.env[LOCK_TOKEN_ENV]) return operation();
  const directory = lockDirectory();
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  let announcedWait = false;

  while (true) {
    try {
      await mkdir(directory);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await staleLockMayBeRemoved(directory)) {
        await rm(directory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`${label} could not acquire the shared local Supabase lock within ${LOCK_WAIT_MS}ms.`);
      }
      if (!announcedWait) {
        console.error(`Waiting for another Donate by Mail local Supabase workflow before starting ${label}...`);
        announcedWait = true;
      }
      await delay(250);
    }
  }

  await writeFile(join(directory, "owner.json"), JSON.stringify({
    token,
    pid: process.pid,
    label,
    workspace: resolve(process.cwd()),
    acquiredAt: new Date().toISOString(),
  }), { mode: 0o600 });
  const previousToken = process.env[LOCK_TOKEN_ENV];
  process.env[LOCK_TOKEN_ENV] = token;
  try {
    return await operation();
  } finally {
    if (previousToken === undefined) delete process.env[LOCK_TOKEN_ENV];
    else process.env[LOCK_TOKEN_ENV] = previousToken;
    try {
      const metadata = JSON.parse(await readFile(join(directory, "owner.json"), "utf8"));
      if (metadata.token === token) await rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}
