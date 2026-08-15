import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const executable = resolve("node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");
const result = spawnSync(executable, ["gen", "types", "typescript", "--local", "--schema", "api,app_private"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(resolve("src", "types", "database.generated.ts"), `${result.stdout.trimEnd()}\n`);
