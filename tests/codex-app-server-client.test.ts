import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  CodexAccountService,
  CodexJsonRpcClient,
  classifyRateLimitWindow,
  normalizeAccountUsage,
  normalizeCodexAccount,
  unavailableCodexAccount,
  type CodexAppServerTransport,
} from "../scripts/codex-app-server-client";

function window(usedPercent: number, windowDurationMins: number | null, resetsAt: number | null = 2_000_000_000) {
  return { usedPercent, windowDurationMins, resetsAt };
}

function rateLimits(overrides: Record<string, unknown> = {}) {
  return {
    ordinaryUsageAllowed: true,
    rateLimits: {
      limitId: "codex",
      planType: "pro",
      primary: window(33, 300),
      secondary: window(19, 10_080),
      credits: null,
    },
    rateLimitsByLimitId: null,
    rateLimitResetCredits: null,
    accountId: "must-not-escape",
    ...overrides,
  };
}

function normalize(rates: unknown = rateLimits(), usage?: unknown) {
  return normalizeCodexAccount({
    account: { account: { type: "chatgpt", email: "private@example.com", planType: "pro" } },
    rateLimits: rates,
    usage,
    observedAt: "2026-09-14T12:00:00.000Z",
    activityObservedAt: usage ? "2026-09-14T12:00:01.000Z" : undefined,
  });
}

test("rate-limit windows are classified by duration rather than primary or secondary position", () => {
  assert.deepEqual(classifyRateLimitWindow(300), { kind: "5h", label: "5-hour", durationMins: 300 });
  assert.deepEqual(classifyRateLimitWindow(10_080), { kind: "7d", label: "Weekly", durationMins: 10_080 });
  assert.deepEqual(classifyRateLimitWindow(60), { kind: "other", label: "1-hour limit", durationMins: 60 });
  assert.deepEqual(classifyRateLimitWindow(null), { kind: "other", label: "Usage limit" });

  const reversed = normalize(rateLimits({ rateLimits: { limitId: "codex", primary: window(20, 10_080), secondary: window(40, 300) } }));
  assert.deepEqual(reversed.limits[0].windows.map((item) => [item.slot, item.kind]), [["primary", "7d"], ["secondary", "5h"]]);
});

test("normalization preserves honest single, missing, and unknown quota windows", () => {
  const weekly = normalize(rateLimits({ rateLimits: { primary: window(10, 10_080), secondary: null } }));
  assert.equal(weekly.limits[0].windows.length, 1);
  assert.equal(weekly.limits[0].windows[0].kind, "7d");

  const fiveHour = normalize(rateLimits({ rateLimits: { primary: null, secondary: window(10, 300) } }));
  assert.equal(fiveHour.limits[0].windows[0].kind, "5h");

  const unknown = normalize(rateLimits({ rateLimits: { primary: window(10, 1_234, null), secondary: null } }));
  assert.equal(unknown.limits[0].windows[0].label, "1234-minute limit");
  assert.equal(unknown.limits[0].windows[0].resetsAt, undefined);

  const missing = normalize(rateLimits({ rateLimits: { primary: null, secondary: null } }));
  assert.deepEqual(missing.limits[0].windows, []);
});

test("remaining percentages are derived from source usage and display-clamped", () => {
  const snapshot = normalize(rateLimits({ rateLimits: { primary: window(125, 300), secondary: window(-8, 10_080) } }));
  assert.equal(snapshot.limits[0].windows[0].usedPercent, 125);
  assert.equal(snapshot.limits[0].windows[0].remainingPercent, 0);
  assert.equal(snapshot.limits[0].windows[1].usedPercent, -8);
  assert.equal(snapshot.limits[0].windows[1].remainingPercent, 100);
});

test("rateLimitsByLimitId prefers codex and preserves additional model pools", () => {
  const snapshot = normalize(rateLimits({
    rateLimitsByLimitId: {
      luna: { limitId: "luna", limitName: "Model limit", normalModelSlug: "gpt-5.6-luna", primary: window(2, 300), secondary: null },
      codex: { limitId: "codex", limitName: "Codex", primary: window(4, 300), secondary: window(8, 10_080) },
    },
  }));
  assert.deepEqual(snapshot.limits.map((limit) => limit.limitId), ["codex", "luna"]);
  assert.equal(snapshot.limits[1].normalModelSlug, "gpt-5.6-luna");
});

test("credits and banked reset credits remain distinct and optional", () => {
  const missing = normalize();
  assert.equal(missing.limits[0].credits, undefined);
  assert.equal(missing.resetCredits, undefined);

  const unlimited = normalize(rateLimits({
    rateLimits: { primary: window(1, 300), secondary: null, credits: { hasCredits: true, unlimited: true, balance: null } },
  }));
  assert.deepEqual(unlimited.limits[0].credits, { hasCredits: true, unlimited: true });

  const finite = normalize(rateLimits({
    rateLimits: { primary: window(1, 300), secondary: null, credits: { hasCredits: true, unlimited: false, balance: "12.50" } },
    rateLimitResetCredits: {
      availableCount: 4,
      credits: [{ id: "discard", status: "available", grantedAt: 1_700_000_000, expiresAt: 1_800_000_000, title: "Earned reset", description: "discard" }],
    },
  }));
  assert.equal(finite.limits[0].credits?.balance, "12.50");
  assert.equal(finite.resetCredits?.availableCount, 4);
  assert.equal(finite.resetCredits?.details?.length, 1);
  assert.equal(finite.resetCredits?.expirations?.[0], 1_800_000_000);

  const noDetails = normalize(rateLimits({ rateLimitResetCredits: { availableCount: 3, credits: null } }));
  assert.deepEqual(noDetails.resetCredits, { availableCount: 3 });
});

test("ordinary usage blocks and account display fields are normalized without identity", () => {
  const snapshot = normalize(rateLimits({ ordinaryUsageAllowed: false }));
  assert.equal(snapshot.ordinaryUsageAllowed, false);
  assert.equal(snapshot.accountType, "chatgpt");
  assert.equal(snapshot.planType, "pro");
  const encoded = JSON.stringify(snapshot);
  assert.doesNotMatch(encoded, /private@example|must-not-escape|accountId|email/i);
});

test("account usage summary and bounded backend daily buckets are normalized", () => {
  const activity = normalizeAccountUsage({
    summary: { lifetimeTokens: 1234, currentStreakDays: 3, longestStreakDays: 9, peakDailyTokens: 456, longestRunningTurnSec: 77 },
    dailyUsageBuckets: Array.from({ length: 100 }, (_, index) => ({ startDate: `2026-06-${String(index + 1).padStart(2, "0")}`, tokens: index })),
    threadUsage: { groups: [{ model: "discarded" }] },
  });
  assert.equal(activity?.lifetimeTokens, 1234);
  assert.equal(activity?.currentStreakDays, 3);
  assert.equal(activity?.dailyUsageBuckets?.length, 90);
  assert.equal(activity?.dailyUsageBuckets?.[0].tokens, 10);
});

class FakeTransport implements CodexAppServerTransport {
  calls: string[] = [];
  closed = false;
  constructor(private readonly responses: Record<string, unknown>) {}
  async request(method: "account/read" | "account/rateLimits/read" | "account/usage/read") {
    this.calls.push(method);
    const response = this.responses[method];
    if (response instanceof Error) throw response;
    return response;
  }
  async close() { this.closed = true; }
}

async function eventually(predicate: () => boolean, timeout = 500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition_not_met");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("service performs read-only account requests and sparse updates trigger a full limits refetch", async () => {
  const transport = new FakeTransport({
    "account/read": { account: { type: "chatgpt", planType: "plus", email: "discard" } },
    "account/rateLimits/read": rateLimits(),
    "account/usage/read": { summary: { lifetimeTokens: 44 }, dailyUsageBuckets: [] },
  });
  let notification: ((method: string) => void) | undefined;
  const service = new CodexAccountService({
    discoverExecutable: async () => "safe-candidate",
    connect: async (_candidate, handler) => { notification = handler; return transport; },
    rateLimitPollMs: 60_000,
    usagePollMs: 60_000,
  });
  service.start();
  await eventually(() => service.getSnapshot().status === "connected");
  assert.deepEqual(transport.calls, ["account/read", "account/rateLimits/read", "account/usage/read"]);
  notification?.("account/rateLimits/updated");
  await eventually(() => transport.calls.filter((method) => method === "account/rateLimits/read").length === 2, 1_000);
  assert.equal(transport.calls.includes("account/rateLimitResetCredit/consume"), false);
  await service.close();
  assert.equal(transport.closed, true);
});

test("missing executable and usage-read failure degrade only account activity", async () => {
  const unavailable = new CodexAccountService({ discoverExecutable: async () => undefined });
  unavailable.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(unavailable.getSnapshot(), unavailableCodexAccount());
  await unavailable.close();

  const transport = new FakeTransport({
    "account/read": { account: { type: "chatgpt", planType: "pro" } },
    "account/rateLimits/read": rateLimits(),
    "account/usage/read": new Error("unsupported"),
  });
  const partial = new CodexAccountService({ discoverExecutable: async () => "candidate", connect: async () => transport });
  partial.start();
  await eventually(() => partial.getSnapshot().status === "connected");
  assert.equal(partial.getSnapshot().activity, undefined);
  await partial.close();
});

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  kill: () => boolean;
};

function fakeChild(respond: (message: Record<string, unknown>, child: FakeChild) => void) {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit("exit", 0, null); return true; };
  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      respond(JSON.parse(line), child);
      newline = buffer.indexOf("\n");
    }
  });
  return child;
}

test("JSON-RPC client initializes, tolerates malformed lines, and uses the read-only transport", async () => {
  const messages: Record<string, unknown>[] = [];
  const child = fakeChild((message, current) => {
    messages.push(message);
    if (message.method === "initialize") {
      current.stdout.write("not-json\n");
      current.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: "fake" } })}\n`);
    } else if (message.method === "account/read") {
      current.stdout.write(`${JSON.stringify({ id: message.id, result: { account: null, requiresOpenaiAuth: true } })}\n`);
    }
  });
  const client = await CodexJsonRpcClient.connectChild(child as never, () => undefined, 100);
  assert.equal(messages[0].method, "initialize");
  assert.equal(messages[1].method, "initialized");
  assert.deepEqual(await client.request("account/read", {}), { account: null, requiresOpenaiAuth: true });
  await client.close();
});

test("JSON-RPC requests time out and reject promptly when the child exits", async () => {
  const timeoutChild = fakeChild((message, current) => {
    if (message.method === "initialize") current.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
  });
  const timeoutClient = await CodexJsonRpcClient.connectChild(timeoutChild as never, () => undefined, 25);
  await assert.rejects(timeoutClient.request("account/read"), /app_server_request_timeout/);
  await timeoutClient.close();

  const exitChild = fakeChild((message, current) => {
    if (message.method === "initialize") current.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
    if (message.method === "account/read") {
      current.exitCode = 1;
      current.emit("exit", 1, null);
    }
  });
  const exitClient = await CodexJsonRpcClient.connectChild(exitChild as never, () => undefined, 1_000);
  await assert.rejects(exitClient.request("account/read"), /app_server_exited/);
});
