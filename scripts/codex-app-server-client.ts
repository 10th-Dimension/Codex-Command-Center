import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

import type {
  CodexAccountActivity,
  CodexAccountSnapshot,
  CodexQuotaCredits,
  CodexQuotaLimit,
  CodexQuotaWindow,
  CodexResetCreditDetail,
} from "../src/lib/overlay/contracts";

export const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 8_000;
export const CODEX_APP_SERVER_DISCOVERY_TIMEOUT_MS = 4_000;
export const CODEX_RATE_LIMIT_POLL_MS = 45_000;
export const CODEX_ACCOUNT_USAGE_POLL_MS = 5 * 60_000;
export const CODEX_NOTIFICATION_DEBOUNCE_MS = 250;
export const CODEX_APP_SERVER_MAX_LINE_BYTES = 1_048_576;
export const CODEX_ACCOUNT_MAX_LIMITS = 16;
export const CODEX_ACCOUNT_MAX_ACTIVITY_BUCKETS = 90;
export const CODEX_ACCOUNT_MAX_RESET_DETAILS = 32;

type JsonObject = Record<string, unknown>;
type ReadOnlyMethod = "account/read" | "account/rateLimits/read" | "account/usage/read";

export interface CodexAppServerTransport {
  request(method: ReadOnlyMethod, params?: JsonObject): Promise<unknown>;
  close(): Promise<void>;
}

export interface CodexAccountProvider {
  getSnapshot(): CodexAccountSnapshot;
  start(): void;
  close(): Promise<void>;
}

export interface CodexAccountServiceOptions {
  discoverExecutable?: () => Promise<string | undefined>;
  connect?: (executable: string, notification: (method: string) => void) => Promise<CodexAppServerTransport>;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  rateLimitPollMs?: number;
  usagePollMs?: number;
  retryMs?: number;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeNonnegativeInteger(value: unknown) {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(number)));
}

function safeString(value: unknown, maximum = 120) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function classifyRateLimitWindow(durationMins: unknown) {
  const duration = safeNonnegativeInteger(durationMins);
  if (duration === 300) return { kind: "5h" as const, label: "5-hour", durationMins: duration };
  if (duration === 10_080) return { kind: "7d" as const, label: "Weekly", durationMins: duration };
  if (!duration) return { kind: "other" as const, label: "Usage limit" };
  if (duration % 43_200 === 0) return { kind: "other" as const, label: `${duration / 43_200}-month limit`, durationMins: duration };
  if (duration % 1_440 === 0) return { kind: "other" as const, label: `${duration / 1_440}-day limit`, durationMins: duration };
  if (duration % 60 === 0) return { kind: "other" as const, label: `${duration / 60}-hour limit`, durationMins: duration };
  return { kind: "other" as const, label: `${duration}-minute limit`, durationMins: duration };
}

function normalizeWindow(value: unknown, slot: CodexQuotaWindow["slot"]): CodexQuotaWindow | undefined {
  if (!isObject(value)) return undefined;
  const usedPercent = finiteNumber(value.usedPercent);
  if (usedPercent === undefined) return undefined;
  const classification = classifyRateLimitWindow(value.windowDurationMins);
  const resetsAt = safeNonnegativeInteger(value.resetsAt);
  return {
    slot,
    ...classification,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function normalizeCredits(value: unknown): CodexQuotaCredits | undefined {
  if (!isObject(value) || typeof value.hasCredits !== "boolean" || typeof value.unlimited !== "boolean") return undefined;
  const balance = safeString(value.balance, 64);
  return { hasCredits: value.hasCredits, unlimited: value.unlimited, ...(balance ? { balance } : {}) };
}

function normalizeLimit(value: unknown, fallbackLimitId?: string): CodexQuotaLimit | undefined {
  if (!isObject(value)) return undefined;
  const windows = [normalizeWindow(value.primary, "primary"), normalizeWindow(value.secondary, "secondary")]
    .filter((window): window is CodexQuotaWindow => Boolean(window));
  const limitId = safeString(value.limitId) ?? safeString(fallbackLimitId);
  const limitName = safeString(value.limitName);
  const normalModelSlug = safeString(value.normalModelSlug);
  const credits = normalizeCredits(value.credits);
  const rateLimitReachedType = safeString(value.rateLimitReachedType);
  return {
    ...(limitId ? { limitId } : {}),
    ...(limitName ? { limitName } : {}),
    ...(normalModelSlug ? { normalModelSlug } : {}),
    windows,
    ...(credits ? { credits } : {}),
    ...(typeof value.individualLimit === "boolean" ? { individualLimit: value.individualLimit } : {}),
    ...(typeof value.spendControlReached === "boolean" ? { spendControlReached: value.spendControlReached } : {}),
    ...(rateLimitReachedType ? { rateLimitReachedType } : {}),
  };
}

function collectLimits(value: JsonObject) {
  const top = normalizeLimit(value.rateLimits);
  const byId = isObject(value.rateLimitsByLimitId) ? value.rateLimitsByLimitId : undefined;
  const mapped = byId
    ? Object.entries(byId).map(([limitId, limit]) => normalizeLimit(limit, limitId)).filter((limit): limit is CodexQuotaLimit => Boolean(limit))
    : [];
  mapped.sort((left, right) => Number(right.limitId === "codex") - Number(left.limitId === "codex"));
  const candidates = byId && isObject(byId.codex)
    ? mapped
    : [top, ...mapped].filter((limit): limit is CodexQuotaLimit => Boolean(limit));
  const seen = new Set<string>();
  return candidates.filter((limit) => {
    const identity = limit.limitId ?? `${limit.limitName ?? ""}:${limit.normalModelSlug ?? ""}:${limit.windows.map((window) => `${window.slot}:${window.durationMins ?? "null"}`).join(",")}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, CODEX_ACCOUNT_MAX_LIMITS);
}

function normalizeResetCredits(value: unknown): CodexAccountSnapshot["resetCredits"] | undefined {
  if (!isObject(value)) return undefined;
  const availableCount = safeNonnegativeInteger(value.availableCount);
  if (availableCount === undefined) return undefined;
  const details = Array.isArray(value.credits) ? value.credits.slice(0, CODEX_ACCOUNT_MAX_RESET_DETAILS).flatMap((item) => {
    if (!isObject(item)) return [];
    const status = safeString(item.status);
    if (!status) return [];
    const detail: CodexResetCreditDetail = { status };
    const grantedAt = safeNonnegativeInteger(item.grantedAt);
    const expiresAt = safeNonnegativeInteger(item.expiresAt);
    const title = safeString(item.title);
    if (grantedAt) detail.grantedAt = grantedAt;
    if (expiresAt) detail.expiresAt = expiresAt;
    if (title) detail.title = title;
    return [detail];
  }) : [];
  const expirations = details.flatMap((detail) => detail.expiresAt ? [detail.expiresAt] : []);
  return {
    availableCount,
    ...(expirations.length ? { expirations } : {}),
    ...(details.length ? { details } : {}),
  };
}

export function normalizeAccountUsage(value: unknown): CodexAccountActivity | undefined {
  if (!isObject(value)) return undefined;
  const summary = isObject(value.summary) ? value.summary : {};
  const activity: CodexAccountActivity = {};
  for (const [source, target] of [
    ["lifetimeTokens", "lifetimeTokens"],
    ["currentStreakDays", "currentStreakDays"],
    ["longestStreakDays", "longestStreakDays"],
    ["peakDailyTokens", "peakDailyTokens"],
    ["longestRunningTurnSec", "longestRunningTurnSec"],
  ] as const) {
    const number = safeNonnegativeInteger(summary[source]);
    if (number !== undefined) activity[target] = number;
  }
  const buckets = Array.isArray(value.dailyUsageBuckets) ? value.dailyUsageBuckets.slice(-CODEX_ACCOUNT_MAX_ACTIVITY_BUCKETS).flatMap((bucket) => {
    if (!isObject(bucket)) return [];
    const startDate = safeString(bucket.startDate, 40);
    const tokens = safeNonnegativeInteger(bucket.tokens);
    return startDate && tokens !== undefined ? [{ startDate, tokens }] : [];
  }) : [];
  if (buckets.length) activity.dailyUsageBuckets = buckets;
  return Object.keys(activity).length ? activity : undefined;
}

function accountDisplay(value: unknown) {
  if (!isObject(value) || !isObject(value.account)) return {};
  const accountType = safeString(value.account.type, 40);
  const planType = safeString(value.account.planType, 40);
  return { ...(accountType ? { accountType } : {}), ...(planType ? { planType } : {}) };
}

function rateLimitPlanType(value: JsonObject) {
  const byId = isObject(value.rateLimitsByLimitId) ? value.rateLimitsByLimitId : undefined;
  const preferred = byId && isObject(byId.codex) ? byId.codex : isObject(value.rateLimits) ? value.rateLimits : undefined;
  return preferred ? safeString(preferred.planType, 40) : undefined;
}

export function normalizeCodexAccount(input: {
  account?: unknown;
  rateLimits: unknown;
  usage?: unknown;
  observedAt: string;
  rateLimitsObservedAt?: string;
  activityObservedAt?: string;
}): CodexAccountSnapshot {
  if (!isObject(input.rateLimits)) throw new Error("invalid_rate_limits");
  const display = accountDisplay(input.account);
  const limits = collectLimits(input.rateLimits);
  const planType = display.planType ?? rateLimitPlanType(input.rateLimits);
  const activity = normalizeAccountUsage(input.usage);
  const resetCredits = normalizeResetCredits(input.rateLimits.rateLimitResetCredits);
  return {
    status: "connected",
    freshness: "live",
    observedAt: input.observedAt,
    rateLimitsObservedAt: input.rateLimitsObservedAt ?? input.observedAt,
    ...(input.activityObservedAt ? { activityObservedAt: input.activityObservedAt } : {}),
    ...display,
    ...(planType ? { planType } : {}),
    ...(typeof input.rateLimits.ordinaryUsageAllowed === "boolean" ? { ordinaryUsageAllowed: input.rateLimits.ordinaryUsageAllowed } : {}),
    limits,
    ...(resetCredits ? { resetCredits } : {}),
    ...(activity ? { activity } : {}),
  };
}

export function unavailableCodexAccount(status: "unavailable" | "error" = "unavailable"): CodexAccountSnapshot {
  return { status, freshness: "unavailable", limits: [] };
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null } | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function validateExecutable(candidate: string, timeoutMs = CODEX_APP_SERVER_DISCOVERY_TIMEOUT_MS) {
  try {
    await access(candidate);
    const child = spawn(candidate, ["--version"], { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    const result = await waitForExit(child, timeoutMs);
    if (!result) {
      child.kill();
      await waitForExit(child, 1_000);
      return false;
    }
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function discoverCodexExecutable(environment: NodeJS.ProcessEnv = process.env) {
  const candidates: string[] = [];
  if (environment.CODEX_CLI_PATH) candidates.push(environment.CODEX_CLI_PATH);
  for (const directory of (environment.PATH ?? "").split(delimiter).filter(Boolean)) candidates.push(join(directory.replace(/^"|"$/g, ""), process.platform === "win32" ? "codex.exe" : "codex"));
  if (process.platform === "win32" && environment.LOCALAPPDATA) {
    const bin = join(environment.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    try {
      const entries = await readdir(bin, { withFileTypes: true });
      const relocated = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const candidate = join(bin, entry.name, "codex.exe");
        try { return { candidate, modified: (await stat(candidate)).mtimeMs }; } catch { return undefined; }
      }));
      candidates.push(...relocated.filter((item): item is { candidate: string; modified: number } => Boolean(item)).sort((left, right) => right.modified - left.modified).map((item) => item.candidate));
    } catch { /* unavailable is an expected state */ }
  }
  const unique = [...new Set(candidates)];
  for (const candidate of unique) if (await validateExecutable(candidate)) return candidate;
  return undefined;
}

export class CodexJsonRpcClient implements CodexAppServerTransport {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly requestTimeoutMs: number) {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.receive(line));
    child.stderr.resume();
    child.once("exit", () => this.handleExit("app_server_exited"));
    child.once("error", () => this.handleExit("app_server_unavailable"));
  }

  static async connect(executable: string, notification: (method: string) => void, requestTimeoutMs = CODEX_APP_SERVER_REQUEST_TIMEOUT_MS) {
    const child = spawn(executable, ["app-server", "--stdio"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return CodexJsonRpcClient.connectChild(child, notification, requestTimeoutMs);
  }

  static async connectChild(child: ChildProcessWithoutNullStreams, notification: (method: string) => void, requestTimeoutMs = CODEX_APP_SERVER_REQUEST_TIMEOUT_MS) {
    const client = new CodexJsonRpcClient(child, requestTimeoutMs);
    client.notification = notification;
    await client.rawRequest("initialize", {
      clientInfo: { name: "codex-command-center", title: "Codex Command Center", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    client.write({ method: "initialized" });
    return client;
  }

  private notification: (method: string) => void = () => undefined;

  private write(message: JsonObject) {
    if (this.closed || !this.child.stdin.writable) throw new Error("app_server_unavailable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string) {
    if (Buffer.byteLength(line, "utf8") > CODEX_APP_SERVER_MAX_LINE_BYTES) return;
    let message: unknown;
    try { message = JSON.parse(line); } catch { return; }
    if (!isObject(message)) return;
    const id = finiteNumber(message.id);
    if (id !== undefined && this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (message.error) {
        const code = isObject(message.error) ? finiteNumber(message.error.code) : undefined;
        pending.reject(new Error(code === undefined ? "app_server_request_failed" : `app_server_request_failed:${code}`));
      }
      else pending.resolve(message.result);
      return;
    }
    const method = safeString(message.method, 160);
    if (method) this.notification(method);
  }

  private rawRequest(method: string, params: JsonObject = {}) {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("app_server_request_timeout"));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  request(method: ReadOnlyMethod, params: JsonObject = {}) {
    return this.rawRequest(method, params);
  }

  private failAll(error: Error) {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleExit(reason: string) {
    this.failAll(new Error(reason));
    this.notification("app-server/exited");
  }

  async close() {
    if (this.closed && this.child.exitCode !== null) return;
    this.closed = true;
    this.child.stdin.end();
    if (this.child.exitCode === null) {
      const exited = waitForExit(this.child, 2_000);
      this.child.kill();
      await exited;
    }
    this.failAll(new Error("app_server_closed"));
  }
}

export class CodexAccountService implements CodexAccountProvider {
  private snapshot = unavailableCodexAccount();
  private transport?: CodexAppServerTransport;
  private starting?: Promise<void>;
  private stopped = false;
  private rateTimer?: ReturnType<typeof setTimeout>;
  private usageTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private notificationTimer?: ReturnType<typeof setTimeout>;
  private accountResponse?: unknown;
  private rateLimitsResponse?: unknown;
  private usageResponse?: unknown;
  private rateLimitsObservedAt?: string;
  private activityObservedAt?: string;

  private readonly discover: () => Promise<string | undefined>;
  private readonly connect: NonNullable<CodexAccountServiceOptions["connect"]>;
  private readonly now: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly rateLimitPollMs: number;
  private readonly usagePollMs: number;
  private readonly retryMs: number;

  constructor(options: CodexAccountServiceOptions = {}) {
    this.discover = options.discoverExecutable ?? (() => discoverCodexExecutable());
    this.connect = options.connect ?? ((executable, notification) => CodexJsonRpcClient.connect(executable, notification));
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.rateLimitPollMs = options.rateLimitPollMs ?? CODEX_RATE_LIMIT_POLL_MS;
    this.usagePollMs = options.usagePollMs ?? CODEX_ACCOUNT_USAGE_POLL_MS;
    this.retryMs = options.retryMs ?? 15_000;
  }

  start() {
    if (this.stopped || this.starting || this.transport) return;
    this.starting = this.connectAndRefresh().finally(() => { this.starting = undefined; });
  }

  private async connectAndRefresh() {
    try {
      const executable = await this.discover();
      if (!executable || this.stopped) {
        this.snapshot = unavailableCodexAccount();
        if (!this.stopped) this.scheduleRetry();
        return;
      }
      const transport = await this.connect(executable, (method) => this.onNotification(method));
      if (this.stopped) { await transport.close(); return; }
      this.transport = transport;
      await this.refreshAccountAndLimits();
      await this.refreshUsage().catch(() => undefined);
      this.schedulePolls();
    } catch {
      await this.dropTransport();
      this.snapshot = this.snapshot.observedAt ? { ...this.snapshot, status: "stale", freshness: "stale" } : unavailableCodexAccount("error");
      this.scheduleRetry();
    }
  }

  private async refreshAccountAndLimits() {
    if (!this.transport) throw new Error("app_server_unavailable");
    this.accountResponse = await this.transport.request("account/read", { refreshToken: false });
    this.rateLimitsResponse = await this.transport.request("account/rateLimits/read", { excludeResetCreditDetails: false });
    this.rateLimitsObservedAt = new Date(this.now()).toISOString();
    this.publish();
  }

  private async refreshLimits() {
    if (!this.transport) throw new Error("app_server_unavailable");
    this.rateLimitsResponse = await this.transport.request("account/rateLimits/read", { excludeResetCreditDetails: false });
    this.rateLimitsObservedAt = new Date(this.now()).toISOString();
    this.publish();
  }

  private async refreshUsage() {
    if (!this.transport) throw new Error("app_server_unavailable");
    this.usageResponse = await this.transport.request("account/usage/read", {});
    this.activityObservedAt = new Date(this.now()).toISOString();
    this.publish();
  }

  private publish() {
    if (!this.rateLimitsResponse || !this.rateLimitsObservedAt) return;
    this.snapshot = normalizeCodexAccount({
      account: this.accountResponse,
      rateLimits: this.rateLimitsResponse,
      usage: this.usageResponse,
      observedAt: this.rateLimitsObservedAt,
      rateLimitsObservedAt: this.rateLimitsObservedAt,
      activityObservedAt: this.activityObservedAt,
    });
  }

  private onNotification(method: string) {
    if (this.stopped) return;
    if (method === "app-server/exited") {
      this.markStaleAndReconnect();
      return;
    }
    if (method !== "account/rateLimits/updated") return;
    if (this.notificationTimer) this.clearTimer(this.notificationTimer);
    this.notificationTimer = this.setTimer(() => {
      this.notificationTimer = undefined;
      void this.refreshLimits().catch(() => this.markStaleAndReconnect());
    }, CODEX_NOTIFICATION_DEBOUNCE_MS);
  }

  private schedulePolls() {
    if (this.stopped) return;
    if (this.rateTimer) this.clearTimer(this.rateTimer);
    if (this.usageTimer) this.clearTimer(this.usageTimer);
    this.rateTimer = this.setTimer(() => {
      this.rateTimer = undefined;
      void this.refreshLimits().then(() => this.scheduleRatePoll()).catch(() => this.markStaleAndReconnect());
    }, this.rateLimitPollMs);
    this.usageTimer = this.setTimer(() => {
      this.usageTimer = undefined;
      void this.refreshUsage().then(() => this.scheduleUsagePoll()).catch(() => this.scheduleUsagePoll());
    }, this.usagePollMs);
  }

  private scheduleRatePoll() {
    if (this.stopped) return;
    this.rateTimer = this.setTimer(() => {
      this.rateTimer = undefined;
      void this.refreshLimits().then(() => this.scheduleRatePoll()).catch(() => this.markStaleAndReconnect());
    }, this.rateLimitPollMs);
  }

  private scheduleUsagePoll() {
    if (this.stopped) return;
    this.usageTimer = this.setTimer(() => {
      this.usageTimer = undefined;
      void this.refreshUsage().then(() => this.scheduleUsagePoll()).catch(() => this.scheduleUsagePoll());
    }, this.usagePollMs);
  }

  private markStaleAndReconnect() {
    this.snapshot = this.snapshot.observedAt ? { ...this.snapshot, status: "stale", freshness: "stale" } : unavailableCodexAccount("error");
    void this.dropTransport().then(() => this.scheduleRetry());
  }

  private scheduleRetry() {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined;
      this.start();
    }, this.retryMs);
  }

  private async dropTransport() {
    const transport = this.transport;
    this.transport = undefined;
    if (transport) await transport.close().catch(() => undefined);
  }

  getSnapshot() {
    if (!this.snapshot.rateLimitsObservedAt) return structuredClone(this.snapshot);
    const age = this.now() - Date.parse(this.snapshot.rateLimitsObservedAt);
    if (age > 5 * 60_000) return structuredClone({ ...this.snapshot, status: "stale" as const, freshness: "stale" as const });
    if (age > 75_000) return structuredClone({ ...this.snapshot, freshness: "recent" as const });
    return structuredClone(this.snapshot);
  }

  async close() {
    this.stopped = true;
    for (const timer of [this.rateTimer, this.usageTimer, this.retryTimer, this.notificationTimer]) if (timer) this.clearTimer(timer);
    await this.dropTransport();
  }
}

export function createCodexAccountService(options: CodexAccountServiceOptions = {}) {
  return new CodexAccountService(options);
}
