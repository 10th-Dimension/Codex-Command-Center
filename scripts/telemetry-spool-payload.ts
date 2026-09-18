import { decodeOtlpJson, decodeOtlpProtobuf } from "../src/lib/telemetry/otlp";
import { normalizeOtlpRecords, type NormalizedTelemetryEvent } from "../src/lib/telemetry/normalize";
import type { TelemetrySpoolContentType } from "./telemetry-spool";

const textEncoder = new TextEncoder();

export interface SanitizedTelemetryPayload {
  contentType: TelemetrySpoolContentType;
  body: Uint8Array;
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function varint(value: bigint | number) {
  let remaining = typeof value === "bigint" ? value : BigInt(value);
  if (remaining < 0n) throw new Error("Negative protobuf varints are not supported.");
  const bytes: number[] = [];
  do {
    const next = Number(remaining & 0x7fn);
    remaining >>= 7n;
    bytes.push(remaining ? next | 0x80 : next);
  } while (remaining);
  return Uint8Array.from(bytes);
}

function fieldTag(number: number, wireType: number) {
  return varint((number << 3) | wireType);
}

function fieldVarint(number: number, value: bigint | number) {
  return concat([fieldTag(number, 0), varint(value)]);
}

function fieldFixed64(number: number, value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return concat([fieldTag(number, 1), bytes]);
}

function fieldBytes(number: number, value: Uint8Array) {
  return concat([fieldTag(number, 2), varint(value.byteLength), value]);
}

function fieldString(number: number, value: string) {
  return fieldBytes(number, textEncoder.encode(value));
}

function fieldMessage(number: number, value: Uint8Array) {
  return fieldBytes(number, value);
}

function jsonAnyValue(value: string | number | boolean) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

function protobufAnyValue(value: string | number | boolean) {
  if (typeof value === "string") return fieldString(1, value);
  if (typeof value === "boolean") return fieldVarint(2, value ? 1 : 0);
  return Number.isSafeInteger(value) ? fieldVarint(3, value) : (() => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    return concat([fieldTag(4, 1), bytes]);
  })();
}

function addAttribute(attributes: Array<{ key: string; value: string | number | boolean }>, key: string, value: string | number | boolean | undefined) {
  if (value !== undefined) attributes.push({ key, value });
}

function eventAttributes(event: NormalizedTelemetryEvent) {
  const attributes: Array<{ key: string; value: string | number | boolean }> = [];
  addAttribute(attributes, "event.kind", event.eventKind);
  addAttribute(attributes, "session.id", event.sessionId);
  addAttribute(attributes, "thread.id", event.threadId);
  addAttribute(attributes, "task.id", event.taskId);
  addAttribute(attributes, "project.id", event.projectId);
  addAttribute(attributes, "project.name", event.projectName);
  addAttribute(attributes, "repository.id", event.repositoryId);
  addAttribute(attributes, "workspace.id", event.workspaceId);
  addAttribute(attributes, "environment", event.environment);
  addAttribute(attributes, "model", event.model);
  addAttribute(attributes, "reasoning_effort", event.reasoningEffort);
  addAttribute(attributes, "tool.name", event.toolName);
  addAttribute(attributes, "tool.type", event.toolType);
  addAttribute(attributes, "tool.status", event.toolStatus);
  addAttribute(attributes, "tool_namespace", event.toolNamespace);
  addAttribute(attributes, "decision", event.decision);
  addAttribute(attributes, "approval.decision", event.approvalDecision);
  addAttribute(attributes, "approval_policy", event.approvalPolicy);
  addAttribute(attributes, "sandbox_policy", event.sandboxPolicy);
  addAttribute(attributes, "mcp.server", event.mcpServer);
  addAttribute(attributes, "mcp.tool", event.mcpTool);
  addAttribute(attributes, "mcp_server_origin", event.mcpServerOrigin);
  addAttribute(attributes, "network.host", event.networkHost);
  addAttribute(attributes, "network.decision", event.networkDecision);
  addAttribute(attributes, "agent_name", event.agentName);
  addAttribute(attributes, "provider_name", event.providerName);
  addAttribute(attributes, "originator", event.originator);
  addAttribute(attributes, "app.version", event.appVersion);
  addAttribute(attributes, "service.name", event.serviceName);
  addAttribute(attributes, "service.version", event.serviceVersion);
  addAttribute(attributes, "startup.phase", event.startupPhase);
  addAttribute(attributes, "startup.status", event.startupStatus);
  addAttribute(attributes, "terminal.type", event.terminalType);
  addAttribute(attributes, "success", event.success);
  addAttribute(attributes, "status", event.status);
  addAttribute(attributes, "error.type", event.errorType);
  addAttribute(attributes, "duration_ms", event.durationMs);
  addAttribute(attributes, "ttft_ms", event.ttftMs);
  addAttribute(attributes, "input_tokens", event.inputTokens);
  addAttribute(attributes, "output_tokens", event.outputTokens);
  addAttribute(attributes, "cached_input_tokens", event.cachedInputTokens);
  addAttribute(attributes, "cache_write_token_count", event.cacheWriteTokens);
  addAttribute(attributes, "reasoning_output_tokens", event.reasoningTokens);
  addAttribute(attributes, "tool_token_count", event.toolTokens);
  addAttribute(attributes, "codex.replay.category", event.category);
  addAttribute(attributes, "codex.replay.fingerprint", event.fingerprint);
  addAttribute(attributes, "codex.replay.call_id_hash", event.callIdHash);
  return attributes;
}

function eventTime(event: NormalizedTelemetryEvent) {
  const milliseconds = Date.parse(event.occurredAt);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? BigInt(milliseconds) * 1_000_000n : undefined;
}

function jsonRecord(event: NormalizedTelemetryEvent) {
  const time = eventTime(event);
  const record: Record<string, unknown> = {
    eventName: event.eventName,
    attributes: eventAttributes(event).map(({ key, value }) => ({ key, value: jsonAnyValue(value) })),
  };
  if (time !== undefined) record.timeUnixNano = String(time);
  if (event.severityNumber !== undefined) record.severityNumber = event.severityNumber;
  if (event.severityText !== undefined) record.severityText = event.severityText;
  return record;
}

function jsonPayload(events: NormalizedTelemetryEvent[]) {
  return textEncoder.encode(JSON.stringify({
    resourceLogs: [{
      scopeLogs: [{ logRecords: events.map(jsonRecord) }],
    }],
  }));
}

function protobufAttributes(event: NormalizedTelemetryEvent) {
  return eventAttributes(event).map(({ key, value }) => fieldMessage(6, concat([
    fieldString(1, key),
    fieldMessage(2, protobufAnyValue(value)),
  ])));
}

function protobufRecord(event: NormalizedTelemetryEvent) {
  const fields: Uint8Array[] = [];
  const time = eventTime(event);
  if (time !== undefined) fields.push(fieldFixed64(1, time));
  if (event.severityNumber !== undefined && Number.isSafeInteger(event.severityNumber) && event.severityNumber >= 0) fields.push(fieldVarint(2, event.severityNumber));
  if (event.severityText !== undefined) fields.push(fieldString(3, event.severityText));
  fields.push(...protobufAttributes(event));
  fields.push(fieldString(12, event.eventName));
  return concat(fields);
}

function protobufPayload(events: NormalizedTelemetryEvent[]) {
  const scopeLogs = concat(events.map((event) => fieldMessage(2, protobufRecord(event))));
  const resourceLogs = fieldMessage(2, scopeLogs);
  return concat([fieldMessage(1, resourceLogs)]);
}

export async function sanitizeTelemetryPayload(contentType: TelemetrySpoolContentType, body: Uint8Array, receivedAt: string): Promise<SanitizedTelemetryPayload | undefined> {
  try {
    const records = contentType === "application/json"
      ? decodeOtlpJson(JSON.parse(new TextDecoder().decode(body)))
      : decodeOtlpProtobuf(body);
    const events = await normalizeOtlpRecords(records, receivedAt);
    if (!events.length) return { contentType, body: Uint8Array.from(body) };
    return {
      contentType,
      body: contentType === "application/json" ? jsonPayload(events) : protobufPayload(events),
    };
  } catch {
    return undefined;
  }
}
