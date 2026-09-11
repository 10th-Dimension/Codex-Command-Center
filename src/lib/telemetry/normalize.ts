import type { CodexTelemetryCategory } from "@/lib/providers/types";
import type { OtlpLogRecord } from "@/lib/telemetry/otlp";

const MAX_EVENT_NAME_LENGTH = 128;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_ATTRIBUTE_KEYS = 64;
const SAFE_KEY_PATTERN = /[^a-zA-Z0-9_.:/-]+/g;
const SECRET_KEY_PATTERN = /(?:^|[_.-])(?:authorization|cookie|credential|password|secret|api[_.-]?key|access[_.-]?token|refresh[_.-]?token|client[_.-]?secret|private[_.-]?key)(?:$|[_.-])/i;
const CONTENT_KEY_PATTERN = /(?:^|[_.-])(?:prompt|content|body|input|output|arguments|command|stdout|stderr|result|response)(?:$|[_.-])/i;
const SECRET_VALUE_PATTERN = /^(?:bearer\s+|github_pat_|gh[pousr]_|sk-[a-z0-9]|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/i;

const knownKeys = new Set([
  "event.name",
  "event_name",
  "conversation.id",
  "conversation_id",
  "session.id",
  "session_id",
  "thread.id",
  "thread_id",
  "task.id",
  "task_id",
  "project.id",
  "project_id",
  "project.name",
  "project_name",
  "repository.id",
  "repository_id",
  "workspace.id",
  "workspace_id",
  "environment",
  "deployment.environment.name",
  "model",
  "gen_ai.request.model",
  "tool",
  "tool.name",
  "tool_name",
  "tool.type",
  "tool_type",
  "tool.status",
  "tool_status",
  "decision",
  "approval.decision",
  "approval_decision",
  "mcp.server",
  "mcp_server",
  "mcp.tool",
  "mcp_tool",
  "network.host",
  "network.domain",
  "server.address",
  "network.decision",
  "network_decision",
  "success",
  "status",
  "error.type",
  "error_type",
  "error.code",
  "duration_ms",
  "duration.ms",
  "input_token_count",
  "input_tokens",
  "gen_ai.usage.input_tokens",
  "output_token_count",
  "output_tokens",
  "gen_ai.usage.output_tokens",
  "cached_input_token_count",
  "cached_input_tokens",
  "reasoning_output_token_count",
  "reasoning_output_tokens",
]);

export interface NormalizedTelemetryEvent {
  id: string;
  fingerprint: string;
  occurredAt: string;
  receivedAt: string;
  eventName: string;
  category: CodexTelemetryCategory;
  severityText?: string;
  severityNumber?: number;
  sessionId?: string;
  threadId?: string;
  taskId?: string;
  projectId?: string;
  projectName?: string;
  repositoryId?: string;
  workspaceId?: string;
  environment?: string;
  model?: string;
  toolName?: string;
  toolType?: string;
  toolStatus?: string;
  decision?: string;
  approvalDecision?: string;
  mcpServer?: string;
  mcpTool?: string;
  networkHost?: string;
  networkDecision?: string;
  success?: boolean;
  status?: string;
  errorType?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
  safeAttributeKeys: string[];
  unknownAttributeKeys: string[];
  redactedAttributeCount: number;
  source: "openai-codex-otel";
  schemaVersion: 1;
}

function sanitizeKey(value: string) {
  return value.replace(SAFE_KEY_PATTERN, "_").slice(0, 80);
}

function safeIdentifier(value: unknown, maxLength = MAX_IDENTIFIER_LENGTH) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return text && !SECRET_VALUE_PATTERN.test(text) ? text.slice(0, maxLength) : undefined;
}

function safeNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : undefined;
}

function safeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (["true", "success", "succeeded", "ok", "allowed", "approved"].includes(normalized)) return true;
  if (["false", "failure", "failed", "error", "denied", "rejected"].includes(normalized)) return false;
  return undefined;
}

function safeNetworkHost(value: unknown) {
  const host = safeIdentifier(value, 253)?.toLowerCase();
  return host && /^(?:\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(host) ? host : undefined;
}

function first(attributes: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (attributes[key] !== undefined && attributes[key] !== null) return attributes[key];
  }
  return undefined;
}

function nanosToIso(value: bigint | undefined, fallback: string) {
  if (!value || value <= BigInt(0)) return fallback;
  const millis = value / BigInt(1_000_000);
  if (millis > BigInt(8_640_000_000_000_000)) return fallback;
  const date = new Date(Number(millis));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function eventCategory(eventName: string, severityNumber?: number, severityText?: string): CodexTelemetryCategory {
  const name = eventName.toLowerCase();
  const severity = severityText?.toLowerCase() ?? "";
  if (name.includes("error") || name.includes("failed") || severityNumber && severityNumber >= 17 || severity.includes("error") || severity.includes("fatal")) return "error";
  if (name.includes("warn") || severityNumber && severityNumber >= 13 || severity.includes("warn")) return "warning";
  if (name.includes("conversation_start") || name.includes("session")) return "session";
  if (name.includes("mcp")) return "mcp";
  if (name.includes("network") || name.includes("proxy")) return "network";
  if (name.includes("tool_decision") || name.includes("approval") || name.includes("decision")) return "decision";
  if (name.includes("tool_result") || name.includes("tool_call") || name.includes("tool")) return "tool";
  if (name.includes("api_request") || name.includes("websocket") || name.includes("sse_event")) return "api-request";
  if (name.includes("usage") || name.includes("token")) return "usage";
  return "unknown";
}

function safeEventName(record: OtlpLogRecord, attributes: Record<string, unknown>) {
  const namedEvent = record.eventName ?? first(attributes, ["event.name", "event_name"]);
  const bodyEvent = typeof record.body === "string" && record.body.startsWith("codex.") ? record.body : undefined;
  const candidate = namedEvent ?? bodyEvent;
  const value = safeIdentifier(candidate, MAX_EVENT_NAME_LENGTH);
  return value && /^codex\.[a-zA-Z0-9_.:/-]+$/.test(value) ? value : "unknown";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeOtlpRecords(records: OtlpLogRecord[], receivedAt: string) {
  const normalized: NormalizedTelemetryEvent[] = [];

  for (const record of records) {
    const attributes = { ...record.resourceAttributes, ...record.attributes };
    const safeAttributeKeys: string[] = [];
    const unknownAttributeKeys: string[] = [];
    let redactedAttributeCount = 0;

    for (const rawKey of Object.keys(attributes).slice(0, MAX_ATTRIBUTE_KEYS * 2)) {
      if (SECRET_KEY_PATTERN.test(rawKey) || CONTENT_KEY_PATTERN.test(rawKey) && !knownKeys.has(rawKey)) {
        redactedAttributeCount += 1;
        continue;
      }
      const key = sanitizeKey(rawKey);
      if (!key) continue;
      safeAttributeKeys.push(key);
      if (!knownKeys.has(rawKey)) unknownAttributeKeys.push(key);
      if (safeAttributeKeys.length >= MAX_ATTRIBUTE_KEYS) break;
    }

    const eventName = safeEventName(record, attributes);
    const occurredAt = nanosToIso(record.timeUnixNano ?? record.observedTimeUnixNano, receivedAt);
    const sessionId = safeIdentifier(first(attributes, ["conversation.id", "conversation_id", "session.id", "session_id"]));
    const threadId = safeIdentifier(first(attributes, ["thread.id", "thread_id"]));
    const taskId = safeIdentifier(first(attributes, ["task.id", "task_id"]));
    const projectId = safeIdentifier(first(attributes, ["project.id", "project_id"]));
    const projectName = safeIdentifier(first(attributes, ["project.name", "project_name"]));
    const repositoryId = safeIdentifier(first(attributes, ["repository.id", "repository_id"]));
    const workspaceId = safeIdentifier(first(attributes, ["workspace.id", "workspace_id"]));
    const environment = safeIdentifier(first(attributes, ["deployment.environment.name", "environment"]), 80);
    const model = safeIdentifier(first(attributes, ["model", "gen_ai.request.model"]));
    const toolName = safeIdentifier(first(attributes, ["tool.name", "tool_name", "tool"]));
    const toolType = safeIdentifier(first(attributes, ["tool.type", "tool_type"]), 80);
    const toolStatus = safeIdentifier(first(attributes, ["tool.status", "tool_status"]), 80);
    const decision = safeIdentifier(first(attributes, ["decision"]), 80);
    const approvalDecision = safeIdentifier(first(attributes, ["approval.decision", "approval_decision", "decision"]), 80);
    const mcpServer = safeIdentifier(first(attributes, ["mcp.server", "mcp_server"]));
    const mcpTool = safeIdentifier(first(attributes, ["mcp.tool", "mcp_tool"]));
    const networkHost = safeNetworkHost(first(attributes, ["network.host", "network.domain", "server.address"]));
    const networkDecision = safeIdentifier(first(attributes, ["network.decision", "network_decision"]), 40);
    const status = safeIdentifier(first(attributes, ["status"]), 80);
    const success = safeBoolean(first(attributes, ["success", "tool.status", "tool_status", "status"]));
    const errorType = safeIdentifier(first(attributes, ["error.type", "error_type", "error.code"]), 120);
    const inputTokens = safeNumber(first(attributes, ["input_token_count", "input_tokens", "gen_ai.usage.input_tokens"]));
    const outputTokens = safeNumber(first(attributes, ["output_token_count", "output_tokens", "gen_ai.usage.output_tokens"]));
    const cachedInputTokens = safeNumber(first(attributes, ["cached_input_token_count", "cached_input_tokens"]));
    const reasoningOutputTokens = safeNumber(first(attributes, ["reasoning_output_token_count", "reasoning_output_tokens"]));
    const durationMs = safeNumber(first(attributes, ["duration_ms", "duration.ms"]));
    const category = eventCategory(eventName, record.severityNumber, record.severityText);
    const fingerprint = await sha256(JSON.stringify([
      occurredAt,
      eventName,
      sessionId,
      threadId,
      taskId,
      model,
      toolName,
      decision,
      status,
      approvalDecision,
      mcpServer,
      mcpTool,
      networkHost,
      networkDecision,
      inputTokens,
      outputTokens,
      record.scopeName,
    ]));

    normalized.push({
      id: fingerprint,
      fingerprint,
      occurredAt,
      receivedAt,
      eventName,
      category,
      severityText: safeIdentifier(record.severityText, 40),
      severityNumber: record.severityNumber,
      sessionId,
      taskId,
      projectId,
      projectName,
      repositoryId,
      workspaceId,
      environment,
      model,
      toolName,
      toolType,
      toolStatus,
      decision,
      approvalDecision,
      mcpServer,
      mcpTool,
      networkHost,
      networkDecision,
      success,
      status,
      errorType,
      durationMs,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningOutputTokens,
      safeAttributeKeys: [...new Set(safeAttributeKeys)].sort(),
      unknownAttributeKeys: [...new Set(unknownAttributeKeys)].sort().slice(0, 32),
      redactedAttributeCount,
      source: "openai-codex-otel",
      schemaVersion: 1,
    });
  }

  return normalized;
}
