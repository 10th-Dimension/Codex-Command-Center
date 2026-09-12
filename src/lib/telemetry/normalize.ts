import type { CodexTelemetryCategory, CodexToolExecutionState } from "@/lib/providers/types";
import type { OtlpLogRecord } from "@/lib/telemetry/otlp";

const MAX_KEYS = 64;
const SECRET_KEY = /(?:^|[_.-])(?:authorization|cookie|credential|password|secret|api[_.-]?key|access[_.-]?token|refresh[_.-]?token|client[_.-]?secret|private[_.-]?key)(?:$|[_.-])/i;
const CONTENT_KEY = /(?:^|[_.-])(?:prompt|content|body|message|arguments?|commands?|stdout|stderr|result|response|reasoning[_.-]?summary|tool[_.-]?output)(?:$|[_.-])/i;
const PRIVATE_KEY = /^(?:user\.(?:email|account_id)|host\.name)$/i;
const AUTH_KEY = /^(?:auth(?:entication)?[_.]|auth_mode$)/i;
const SECRET_VALUE = /^(?:bearer\s+|github_pat_|gh[pousr]_|sk-[a-z0-9]|eyJ[^.]+\.[^.]+\.)/i;
const KNOWN_KEYS = new Set([
  "event.name", "event_name", "event.kind", "event.timestamp", "conversation.id", "conversation_id", "session.id", "session_id", "thread.id", "thread_id", "task.id", "task_id",
  "project.id", "project_id", "project.name", "project_name", "repository.id", "repository_id", "workspace.id", "workspace_id", "environment", "deployment.environment.name", "env",
  "model", "gen_ai.request.model", "tool", "tool.name", "tool_name", "tool_names", "tool.type", "tool_type", "tool.status", "tool_status", "tool_namespace", "call_id",
  "decision", "approval.decision", "approval_decision", "approval_policy", "sandbox_policy", "mcp.server", "mcp_server", "mcp_servers", "mcp.tool", "mcp_tool", "mcp_server_origin",
  "network.host", "network.domain", "server.address", "network.decision", "network_decision", "success", "status", "error.type", "error_type", "error.code", "duration_ms", "duration.ms", "ttft_ms",
  "input_token_count", "input_tokens", "gen_ai.usage.input_tokens", "output_token_count", "output_tokens", "gen_ai.usage.output_tokens", "cached_input_token_count", "cached_input_tokens", "cached_token_count",
  "cache_write_token_count", "reasoning_output_token_count", "reasoning_output_tokens", "reasoning_token_count", "tool_token_count", "reasoning_effort", "model_reasoning_effort",
  "agent_name", "provider_name", "originator", "app.version", "service.name", "service.version", "startup.phase", "startup.status", "terminal.type",
]);

export interface NormalizedTelemetryEvent {
  id: string; fingerprint: string; occurredAt: string; receivedAt: string; eventName: string; eventKind?: string; category: CodexTelemetryCategory;
  severityText?: string; severityNumber?: number; sessionId?: string; threadId?: string; taskId?: string; projectId?: string; projectName?: string;
  repositoryId?: string; workspaceId?: string; environment?: string; model?: string; reasoningEffort?: string; toolName?: string; toolType?: string;
  toolStatus?: string; toolNamespace?: string; callIdHash?: string; toolExecutionState?: CodexToolExecutionState; decision?: string; approvalDecision?: string;
  approvalPolicy?: string; sandboxPolicy?: string; mcpServer?: string; mcpTool?: string; mcpServerOrigin?: string; networkHost?: string; networkDecision?: string;
  agentName?: string; providerName?: string; originator?: string; appVersion?: string; serviceName?: string; serviceVersion?: string; startupPhase?: string;
  startupStatus?: string; terminalType?: string; success?: boolean; status?: string; errorType?: string; durationMs?: number; ttftMs?: number;
  inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number; toolTokens?: number;
  safeAttributeKeys: string[]; unknownAttributeKeys: string[]; redactedAttributeCount: number; source: "openai-codex-otel"; schemaVersion: 2;
}

function identifier(value: unknown, max = 160) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return text && !SECRET_VALUE.test(text) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? text.slice(0, max) : undefined;
}
function dimension(value: unknown, max = 160) { const text = identifier(value, max); return text && /^[a-zA-Z0-9_.:/-]+$/.test(text) ? text : undefined; }
function singleton(value: unknown) { return Array.isArray(value) ? value.length === 1 ? dimension(value[0]) : undefined : dimension(value); }
function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : undefined;
}
function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (["true", "success", "succeeded", "ok", "allowed", "approved", "complete", "completed"].includes(text)) return true;
  if (["false", "failure", "failed", "error", "denied", "rejected", "cancelled", "canceled"].includes(text)) return false;
  return undefined;
}
function first(attributes: Record<string, unknown>, keys: string[]) { for (const key of keys) if (attributes[key] != null) return attributes[key]; }
function occurredAt(value: bigint | undefined, fallback: string) {
  if (!value || value <= 0n) return fallback;
  const millis = value / 1_000_000n;
  if (millis > 8_640_000_000_000_000n) return fallback;
  const date = new Date(Number(millis));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
function includesAny(value: string, terms: string[]) { return terms.some((term) => value.includes(term)); }
function classify(x: { identity: string; severity?: string; severityNumber?: number; error?: string; startup?: string; approval?: string; mcp?: string; tool?: string; hasUsage: boolean; model?: string }): CodexTelemetryCategory {
  const value = x.identity.toLowerCase(); const severity = x.severity?.toLowerCase() ?? "";
  if (x.error || includesAny(value, ["error", "failed", "failure"]) || (x.severityNumber ?? 0) >= 17 || includesAny(severity, ["error", "fatal"])) return "error";
  if (value.includes("warn") || (x.severityNumber ?? 0) >= 13 || severity.includes("warn")) return "warning";
  if (includesAny(value, ["startup", "initialize", "initialise"])) return "startup";
  if (value.includes("mcp")) return "mcp";
  if (includesAny(value, ["approval", "tool_decision", "decision"])) return "approval";
  if (includesAny(value, ["tool_call", "tool_result", "tool_execution", "exec_command"])) return "tool";
  if (x.startup) return "startup";
  if (x.approval) return "approval";
  if (x.mcp) return "mcp";
  if (x.tool) return "tool";
  if (includesAny(value, ["network", "proxy"])) return "network";
  if (x.hasUsage || includesAny(value, ["usage", "token_count", "token_usage"])) return "usage";
  if (includesAny(value, ["api_request", "websocket", "sse_event"])) return "api-request";
  if (x.model && includesAny(value, ["model", "response"])) return "model";
  if (includesAny(value, ["conversation_start", "session", "thread_start"])) return "session";
  return "unknown";
}
function executionState(identity: string, status: string | undefined, success: boolean | undefined): CodexToolExecutionState {
  const value = `${identity} ${status ?? ""}`.toLowerCase();
  if (success === false || includesAny(value, ["failure", "failed", "error", "denied", "rejected", "cancelled", "canceled"])) return "failed";
  if (success === true || includesAny(value, ["success", "succeeded", "complete", "completed"])) return "succeeded";
  if (includesAny(value, ["start", "begin", "in_progress", "requested", "call"])) return "started";
  return "related";
}
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeOtlpRecords(records: OtlpLogRecord[], receivedAt: string) {
  const output: NormalizedTelemetryEvent[] = [];
  for (const record of records) {
    const a = { ...record.resourceAttributes, ...record.attributes };
    const safeKeys: string[] = []; const unknownKeys: string[] = []; let redacted = 0;
    for (const rawKey of Object.keys(a).slice(0, MAX_KEYS * 2)) {
      if (PRIVATE_KEY.test(rawKey) || AUTH_KEY.test(rawKey) || SECRET_KEY.test(rawKey) || CONTENT_KEY.test(rawKey)) { redacted += 1; continue; }
      const key = rawKey.replace(/[^a-zA-Z0-9_.:/-]+/g, "_").slice(0, 80); if (!key) continue;
      safeKeys.push(key); if (!KNOWN_KEYS.has(rawKey)) unknownKeys.push(key); if (safeKeys.length >= MAX_KEYS) break;
    }
    const eventKind = identifier(a["event.kind"], 128);
    const named = identifier(record.eventName, 128) ?? identifier(first(a, ["event.name", "event_name"]), 128);
    const body = typeof record.body === "string" && record.body.startsWith("codex.") ? record.body : undefined;
    const candidate = named ?? identifier(body, 128) ?? eventKind;
    const eventName = candidate && /^[a-zA-Z0-9_.:/-]+$/.test(candidate) ? candidate : "unknown";
    const sessionId = identifier(first(a, ["conversation.id", "conversation_id", "session.id", "session_id"]));
    const threadId = identifier(first(a, ["thread.id", "thread_id"]));
    const model = identifier(first(a, ["model", "gen_ai.request.model"]));
    const reasoningEffort = dimension(first(a, ["reasoning_effort", "model_reasoning_effort"]), 40)?.toLowerCase();
    const toolName = dimension(first(a, ["tool.name", "tool_name", "tool"])) ?? (eventName.toLowerCase().includes("tool") || a.call_id != null ? singleton(a.tool_names) : undefined);
    const toolStatus = dimension(first(a, ["tool.status", "tool_status"]), 80)?.toLowerCase();
    const status = dimension(a.status, 80)?.toLowerCase(); const success = booleanValue(first(a, ["success", "tool.status", "tool_status", "status"]));
    const errorType = dimension(first(a, ["error.type", "error_type", "error.code"]), 120);
    const approvalDecision = dimension(first(a, ["approval.decision", "approval_decision", "decision"]), 80)?.toLowerCase();
    const approvalPolicy = dimension(a.approval_policy, 80)?.toLowerCase();
    const mcpServer = dimension(first(a, ["mcp.server", "mcp_server"])) ?? singleton(a.mcp_servers); const mcpTool = dimension(first(a, ["mcp.tool", "mcp_tool"]));
    const inputTokens = numberValue(first(a, ["input_token_count", "input_tokens", "gen_ai.usage.input_tokens"]));
    const outputTokens = numberValue(first(a, ["output_token_count", "output_tokens", "gen_ai.usage.output_tokens"]));
    const cachedInputTokens = numberValue(first(a, ["cached_input_token_count", "cached_input_tokens", "cached_token_count"]));
    const cacheWriteTokens = numberValue(a.cache_write_token_count); const reasoningTokens = numberValue(first(a, ["reasoning_output_token_count", "reasoning_output_tokens", "reasoning_token_count"])); const toolTokens = numberValue(a.tool_token_count);
    const startupPhase = dimension(a["startup.phase"], 80); const startupStatus = dimension(a["startup.status"], 80);
    const identity = `${eventName} ${eventKind ?? ""}`;
    const category = classify({ identity, severity: record.severityText, severityNumber: record.severityNumber, error: errorType, startup: startupPhase ?? startupStatus, approval: approvalDecision ?? approvalPolicy, mcp: mcpServer ?? mcpTool, tool: toolName ?? toolStatus, hasUsage: [inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens, toolTokens].some((v) => v !== undefined), model });
    const rawCallId = identifier(a.call_id, 256); const callIdHash = rawCallId ? await hash(`codex-call:${rawCallId}`) : undefined;
    const at = occurredAt(record.timeUnixNano ?? record.observedTimeUnixNano, receivedAt);
    const fingerprint = await hash(JSON.stringify([at, eventName, eventKind, sessionId, threadId, model, toolName, rawCallId, status, approvalDecision, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens, toolTokens, record.scopeName]));
    output.push({
      id: fingerprint, fingerprint, occurredAt: at, receivedAt, eventName, eventKind, category, severityText: identifier(record.severityText, 40), severityNumber: record.severityNumber,
      sessionId, threadId, taskId: identifier(first(a, ["task.id", "task_id"])), projectId: identifier(first(a, ["project.id", "project_id"])), projectName: identifier(first(a, ["project.name", "project_name"])), repositoryId: identifier(first(a, ["repository.id", "repository_id"])), workspaceId: identifier(first(a, ["workspace.id", "workspace_id"])), environment: identifier(first(a, ["deployment.environment.name", "environment", "env"]), 80),
      model, reasoningEffort, toolName, toolType: dimension(first(a, ["tool.type", "tool_type"]), 80), toolStatus, toolNamespace: dimension(a.tool_namespace, 120), callIdHash,
      toolExecutionState: category === "tool" ? executionState(identity, toolStatus ?? status, success) : undefined,
      decision: dimension(a.decision, 80), approvalDecision, approvalPolicy, sandboxPolicy: dimension(a.sandbox_policy, 120), mcpServer, mcpTool, mcpServerOrigin: dimension(a.mcp_server_origin, 120),
      networkHost: identifier(first(a, ["network.host", "network.domain", "server.address"]), 253), networkDecision: identifier(first(a, ["network.decision", "network_decision"]), 40),
      agentName: dimension(a.agent_name), providerName: dimension(a.provider_name), originator: dimension(a.originator), appVersion: dimension(a["app.version"], 80), serviceName: dimension(a["service.name"], 120), serviceVersion: dimension(a["service.version"], 80), startupPhase, startupStatus, terminalType: dimension(a["terminal.type"], 80),
      success, status, errorType, durationMs: numberValue(first(a, ["duration_ms", "duration.ms"])), ttftMs: numberValue(a.ttft_ms), inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens, toolTokens,
      safeAttributeKeys: [...new Set(safeKeys)].sort(), unknownAttributeKeys: [...new Set(unknownKeys)].sort().slice(0, 32), redactedAttributeCount: redacted, source: "openai-codex-otel", schemaVersion: 2,
    });
  }
  return output;
}
