import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const persistence = await mkdtemp(join(tmpdir(), "codex-command-center-d1-"));
const wranglerCli = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");

try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, "d1", "migrations", "apply", "codex-command-center-telemetry", "--local", "--persist-to", persistence], { stdio: "inherit", env: { ...process.env, CI: "1" } });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(persistence, { recursive: true, force: true });
}
