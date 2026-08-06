import { spawnSync } from "node:child_process";
import net from "node:net";

const host = "127.0.0.1";
const port = 54322;
const deadline = Date.now() + 30_000;

function pgReady() {
  const result = spawnSync("pg_isready", ["-h", host, "-p", String(port)], { stdio: "ignore" });
  return result.status === 0;
}

function tcpReady() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

while (Date.now() < deadline) {
  if (pgReady() || await tcpReady()) {
    // Supabase may report the port ready while its restart is still settling.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (pgReady() || await tcpReady()) process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`Local Postgres did not become ready on ${host}:${port}.`);
process.exit(1);
