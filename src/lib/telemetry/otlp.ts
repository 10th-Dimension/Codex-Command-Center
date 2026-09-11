export const MAX_OTLP_LOG_RECORDS = 500;
export const MAX_OTLP_ATTRIBUTES = 100;

export interface OtlpLogRecord {
  attributes: Record<string, unknown>;
  body?: unknown;
  eventName?: string;
  observedTimeUnixNano?: bigint;
  resourceAttributes: Record<string, unknown>;
  scopeName?: string;
  severityNumber?: number;
  severityText?: string;
  timeUnixNano?: bigint;
}

class ProtobufReader {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  get done() {
    return this.offset >= this.bytes.length;
  }

  varint() {
    let value = BigInt(0);
    let shift = BigInt(0);

    for (let count = 0; count < 10; count += 1) {
      if (this.offset >= this.bytes.length) throw new Error("Truncated protobuf varint.");
      const byte = this.bytes[this.offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += BigInt(7);
    }

    throw new Error("Invalid protobuf varint.");
  }

  fixed64() {
    if (this.offset + 8 > this.bytes.length) throw new Error("Truncated protobuf fixed64 value.");
    let value = BigInt(0);
    for (let index = 0; index < 8; index += 1) {
      value |= BigInt(this.bytes[this.offset + index]) << BigInt(index * 8);
    }
    this.offset += 8;
    return value;
  }

  double() {
    if (this.offset + 8 > this.bytes.length) throw new Error("Truncated protobuf double value.");
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8);
    const value = view.getFloat64(0, true);
    this.offset += 8;
    return value;
  }

  lengthDelimited() {
    const length = Number(this.varint());
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("Invalid protobuf length-delimited field.");
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string() {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.lengthDelimited());
  }

  skip(wireType: number) {
    if (wireType === 0) {
      this.varint();
      return;
    }
    if (wireType === 1) {
      if (this.offset + 8 > this.bytes.length) throw new Error("Truncated protobuf field.");
      this.offset += 8;
      return;
    }
    if (wireType === 2) {
      this.lengthDelimited();
      return;
    }
    if (wireType === 5) {
      if (this.offset + 4 > this.bytes.length) throw new Error("Truncated protobuf field.");
      this.offset += 4;
      return;
    }
    throw new Error("Unsupported protobuf wire type.");
  }
}

function field(reader: ProtobufReader) {
  const tag = Number(reader.varint());
  if (!Number.isSafeInteger(tag) || tag <= 0) throw new Error("Invalid protobuf field tag.");
  return { number: tag >>> 3, wireType: tag & 0x07 };
}

function parseAnyValue(bytes: Uint8Array, depth = 0): unknown {
  if (depth > 6) return undefined;
  const reader = new ProtobufReader(bytes);
  let value: unknown;

  while (!reader.done) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) value = reader.string();
    else if (current.number === 2 && current.wireType === 0) value = reader.varint() !== BigInt(0);
    else if (current.number === 3 && current.wireType === 0) {
      const integer = BigInt.asIntN(64, reader.varint());
      value = integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(integer)
        : integer.toString();
    } else if (current.number === 4 && current.wireType === 1) value = reader.double();
    else if (current.number === 5 && current.wireType === 2) value = parseArrayValue(reader.lengthDelimited(), depth + 1);
    else if (current.number === 6 && current.wireType === 2) value = parseKeyValueList(reader.lengthDelimited(), depth + 1);
    else if (current.number === 7 && current.wireType === 2) value = reader.lengthDelimited();
    else reader.skip(current.wireType);
  }

  return value;
}

function parseArrayValue(bytes: Uint8Array, depth: number) {
  const reader = new ProtobufReader(bytes);
  const values: unknown[] = [];
  while (!reader.done && values.length < MAX_OTLP_ATTRIBUTES) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) values.push(parseAnyValue(reader.lengthDelimited(), depth));
    else reader.skip(current.wireType);
  }
  return values;
}

function parseKeyValueList(bytes: Uint8Array, depth: number) {
  const reader = new ProtobufReader(bytes);
  const values: Record<string, unknown> = {};
  while (!reader.done && Object.keys(values).length < MAX_OTLP_ATTRIBUTES) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) {
      const pair = parseKeyValue(reader.lengthDelimited(), depth);
      if (pair?.key) values[pair.key] = pair.value;
    } else reader.skip(current.wireType);
  }
  return values;
}

function parseKeyValue(bytes: Uint8Array, depth = 0) {
  const reader = new ProtobufReader(bytes);
  let key = "";
  let value: unknown;
  while (!reader.done) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) key = reader.string();
    else if (current.number === 2 && current.wireType === 2) value = parseAnyValue(reader.lengthDelimited(), depth + 1);
    else reader.skip(current.wireType);
  }
  return { key, value };
}

function parseAttributes(bytes: Uint8Array) {
  const reader = new ProtobufReader(bytes);
  const attributes: Record<string, unknown> = {};
  while (!reader.done && Object.keys(attributes).length < MAX_OTLP_ATTRIBUTES) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) {
      const pair = parseKeyValue(reader.lengthDelimited());
      if (pair.key) attributes[pair.key] = pair.value;
    } else reader.skip(current.wireType);
  }
  return attributes;
}

function parseLogRecord(bytes: Uint8Array, resourceAttributes: Record<string, unknown>, scopeName?: string): OtlpLogRecord {
  const reader = new ProtobufReader(bytes);
  const record: OtlpLogRecord = { attributes: {}, resourceAttributes, scopeName };

  while (!reader.done) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 1) record.timeUnixNano = reader.fixed64();
    else if (current.number === 2 && current.wireType === 0) record.severityNumber = Number(reader.varint());
    else if (current.number === 3 && current.wireType === 2) record.severityText = reader.string();
    else if (current.number === 5 && current.wireType === 2) record.body = parseAnyValue(reader.lengthDelimited());
    else if (current.number === 6 && current.wireType === 2 && Object.keys(record.attributes).length < MAX_OTLP_ATTRIBUTES) {
      const pair = parseKeyValue(reader.lengthDelimited());
      if (pair.key) record.attributes[pair.key] = pair.value;
    } else if (current.number === 11 && current.wireType === 1) record.observedTimeUnixNano = reader.fixed64();
    else if (current.number === 12 && current.wireType === 2) record.eventName = reader.string();
    else reader.skip(current.wireType);
  }

  return record;
}

function parseScopeLogs(bytes: Uint8Array, resourceAttributes: Record<string, unknown>, records: OtlpLogRecord[]) {
  const reader = new ProtobufReader(bytes);
  const recordPayloads: Uint8Array[] = [];
  let scopeName: string | undefined;

  while (!reader.done) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) {
      const scope = new ProtobufReader(reader.lengthDelimited());
      while (!scope.done) {
        const scopeField = field(scope);
        if (scopeField.number === 1 && scopeField.wireType === 2) scopeName = scope.string();
        else scope.skip(scopeField.wireType);
      }
    } else if (current.number === 2 && current.wireType === 2) recordPayloads.push(reader.lengthDelimited());
    else reader.skip(current.wireType);
  }

  for (const payload of recordPayloads) {
    if (records.length >= MAX_OTLP_LOG_RECORDS) throw new Error("OTLP log record limit exceeded.");
    records.push(parseLogRecord(payload, resourceAttributes, scopeName));
  }
}

function parseResourceLogs(bytes: Uint8Array, records: OtlpLogRecord[]) {
  const reader = new ProtobufReader(bytes);
  const scopePayloads: Uint8Array[] = [];
  let resourceAttributes: Record<string, unknown> = {};

  while (!reader.done) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) resourceAttributes = parseAttributes(reader.lengthDelimited());
    else if (current.number === 2 && current.wireType === 2) scopePayloads.push(reader.lengthDelimited());
    else reader.skip(current.wireType);
  }

  for (const payload of scopePayloads) parseScopeLogs(payload, resourceAttributes, records);
}

export function decodeOtlpProtobuf(bytes: Uint8Array) {
  const reader = new ProtobufReader(bytes);
  const records: OtlpLogRecord[] = [];
  while (!reader.done) {
    const current = field(reader);
    if (current.number === 1 && current.wireType === 2) parseResourceLogs(reader.lengthDelimited(), records);
    else reader.skip(current.wireType);
  }
  return records;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function property(value: Record<string, unknown>, camel: string, snake: string) {
  return value[camel] ?? value[snake];
}

function jsonAnyValue(value: unknown, depth = 0): unknown {
  const object = objectValue(value);
  if (!object || depth > 6) return undefined;
  if ("stringValue" in object || "string_value" in object) return property(object, "stringValue", "string_value");
  if ("boolValue" in object || "bool_value" in object) return property(object, "boolValue", "bool_value");
  if ("intValue" in object || "int_value" in object) return property(object, "intValue", "int_value");
  if ("doubleValue" in object || "double_value" in object) return property(object, "doubleValue", "double_value");
  if ("bytesValue" in object || "bytes_value" in object) return undefined;
  const array = objectValue(property(object, "arrayValue", "array_value"));
  if (array) {
    const values = array.values;
    return Array.isArray(values) ? values.slice(0, MAX_OTLP_ATTRIBUTES).map((item) => jsonAnyValue(item, depth + 1)) : [];
  }
  const list = objectValue(property(object, "kvlistValue", "kvlist_value"));
  return list ? jsonAttributes(list.values, depth + 1) : undefined;
}

function jsonAttributes(value: unknown, depth = 0) {
  const attributes: Record<string, unknown> = {};
  if (!Array.isArray(value)) return attributes;
  for (const item of value.slice(0, MAX_OTLP_ATTRIBUTES)) {
    const pair = objectValue(item);
    if (!pair || typeof pair.key !== "string") continue;
    attributes[pair.key] = jsonAnyValue(pair.value, depth + 1);
  }
  return attributes;
}

function jsonNanos(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= BigInt(0) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function decodeOtlpJson(payload: unknown) {
  const root = objectValue(payload);
  const resourceLogs = root && property(root, "resourceLogs", "resource_logs");
  if (!Array.isArray(resourceLogs)) throw new Error("OTLP JSON payload does not contain resourceLogs.");
  const records: OtlpLogRecord[] = [];

  for (const resourceEntry of resourceLogs) {
    const resourceLog = objectValue(resourceEntry);
    if (!resourceLog) continue;
    const resource = objectValue(resourceLog.resource);
    const resourceAttributes = jsonAttributes(resource?.attributes);
    const scopeLogs = property(resourceLog, "scopeLogs", "scope_logs");
    if (!Array.isArray(scopeLogs)) continue;

    for (const scopeEntry of scopeLogs) {
      const scopeLog = objectValue(scopeEntry);
      if (!scopeLog) continue;
      const scope = objectValue(scopeLog.scope);
      const scopeName = typeof scope?.name === "string" ? scope.name : undefined;
      const logRecords = property(scopeLog, "logRecords", "log_records");
      if (!Array.isArray(logRecords)) continue;

      for (const recordEntry of logRecords) {
        if (records.length >= MAX_OTLP_LOG_RECORDS) throw new Error("OTLP log record limit exceeded.");
        const record = objectValue(recordEntry);
        if (!record) continue;
        records.push({
          attributes: jsonAttributes(record.attributes),
          body: jsonAnyValue(record.body),
          eventName: typeof property(record, "eventName", "event_name") === "string" ? String(property(record, "eventName", "event_name")) : undefined,
          observedTimeUnixNano: jsonNanos(property(record, "observedTimeUnixNano", "observed_time_unix_nano")),
          resourceAttributes,
          scopeName,
          severityNumber: typeof property(record, "severityNumber", "severity_number") === "number" ? Number(property(record, "severityNumber", "severity_number")) : undefined,
          severityText: typeof property(record, "severityText", "severity_text") === "string" ? String(property(record, "severityText", "severity_text")) : undefined,
          timeUnixNano: jsonNanos(property(record, "timeUnixNano", "time_unix_nano")),
        });
      }
    }
  }

  return records;
}
