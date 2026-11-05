import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const roles = ["exporter", "overlay", "browser"] as const;
type RelayRole = typeof roles[number];
export type RelaySecurity = {
  cert: Buffer;
  key: Buffer;
  tokens: Record<RelayRole, string>;
};

export async function loadRelaySecurity(directory = join(
  process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? process.env.APPDATA ?? join(homedir(), ".local", "state"),
  "Codex Command Center", "relay-security",
)): Promise<RelaySecurity> {
  try {
    const [cert, key, ...secrets] = await Promise.all([
      readFile(join(directory, "relay-cert.pem")),
      readFile(join(directory, "relay-key.pem")),
      ...roles.map((role) => readFile(join(directory, `${role}.token`), "utf8")),
    ]);
    const [exporter, overlay, browser] = secrets.map((secret) => secret.trim());
    if (![exporter, overlay, browser].every((secret) => /^[a-f0-9]{64}$/.test(secret))
      || new Set([exporter, overlay, browser]).size !== roles.length) throw new Error("invalid local relay tokens");
    return { cert, key, tokens: { exporter, overlay, browser } };
  } catch {
    throw new Error("Local relay security is missing or invalid. Run scripts/initialize-relay-security.ps1 before starting the relay.");
  }
}

export function allowsRelayRequest(authorization: string | undefined, token: string) {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
