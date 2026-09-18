import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const TELEMETRY_SPOOL_MAX_BYTES = 64 * 1024 * 1024;
export const TELEMETRY_SPOOL_MAX_FILES = 512;
export const TELEMETRY_SPOOL_MAX_ENTRY_BODY_BYTES = 1_048_576;
export const TELEMETRY_SPOOL_REPLAY_BATCH_SIZE = 16;
export const TELEMETRY_SPOOL_RETRY_MINIMUM_MS = 5_000;
export const TELEMETRY_SPOOL_RETRY_MAXIMUM_MS = 60_000;

const SPOOL_STATE_FILE = ".state.json";
const ENTRY_PATTERN = /^entry-(\d+)-(\d+)\.json$/;
const CONTENT_TYPES = new Set([
  "application/json",
  "application/x-protobuf",
  "application/protobuf",
]);

export type TelemetrySpoolContentType =
  | "application/json"
  | "application/x-protobuf"
  | "application/protobuf";

export type TelemetrySpoolReplayState = "idle" | "buffering" | "replaying" | "degraded";

export interface TelemetryBufferHealth {
  queuedBatches: number;
  queuedBytes: number;
  oldestQueuedAgeSeconds?: number;
  lastSuccessfulReplayAt?: string;
  lastUpstreamFailureAt?: string;
  droppedBatches: number;
  replayState: TelemetrySpoolReplayState;
}

export interface TelemetrySpoolItem {
  id: string;
  contentType: TelemetrySpoolContentType;
  body: Uint8Array;
  enqueuedAt: string;
}

export type TelemetrySpoolReplayResult = "delivered" | "retry" | "drop";

export interface TelemetrySpoolOptions {
  directory: string;
  maxBytes?: number;
  maxFiles?: number;
  now?: () => number;
  replayBatchSize?: number;
  retryMinimumMs?: number;
  retryMaximumMs?: number;
}

interface SpoolEntry extends TelemetrySpoolItem {
  path: string;
  fileBytes: number;
}

interface PersistedSpoolState {
  version: 1;
  nextSequence: number;
  droppedBatches: number;
  lastSuccessfulReplayAt?: string;
  lastUpstreamFailureAt?: string;
}

interface SerializedSpoolEntry {
  version: 1;
  id: string;
  contentType: TelemetrySpoolContentType;
  enqueuedAt: string;
  bodyBytes: number;
  bodyBase64: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function safeTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function isContentType(value: unknown): value is TelemetrySpoolContentType {
  return typeof value === "string" && CONTENT_TYPES.has(value);
}

function isBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

function stateFile(directory: string) {
  return join(directory, SPOOL_STATE_FILE);
}

async function writeAtomically(path: string, contents: string) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function defaultTelemetrySpoolDirectory(environment: Record<string, string | undefined> = process.env) {
  const base = environment.LOCALAPPDATA
    ?? environment.XDG_STATE_HOME
    ?? environment.APPDATA
    ?? join(homedir(), ".local", "state");
  return join(base, "Codex Command Center", "telemetry-spool");
}

export class TelemetrySpool {
  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly now: () => number;
  private readonly replayBatchSize: number;
  private readonly retryMinimumMs: number;
  private readonly retryMaximumMs: number;
  private readyPromise?: Promise<void>;
  private replayPromise?: Promise<number>;
  private mutationChain: Promise<void> = Promise.resolve();
  private entries: SpoolEntry[] = [];
  private queuedBytes = 0;
  private state: PersistedSpoolState = { version: 1, nextSequence: 0, droppedBatches: 0 };
  private replayState: TelemetrySpoolReplayState = "idle";
  private retryDelayMs: number;
  private retryNotBefore = 0;

  constructor(options: TelemetrySpoolOptions) {
    this.directory = options.directory;
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes ?? TELEMETRY_SPOOL_MAX_BYTES));
    this.maxFiles = Math.max(1, Math.floor(options.maxFiles ?? TELEMETRY_SPOOL_MAX_FILES));
    this.now = options.now ?? Date.now;
    this.replayBatchSize = Math.max(1, Math.floor(options.replayBatchSize ?? TELEMETRY_SPOOL_REPLAY_BATCH_SIZE));
    this.retryMinimumMs = Math.max(0, Math.floor(options.retryMinimumMs ?? TELEMETRY_SPOOL_RETRY_MINIMUM_MS));
    this.retryMaximumMs = Math.max(this.retryMinimumMs, Math.floor(options.retryMaximumMs ?? TELEMETRY_SPOOL_RETRY_MAXIMUM_MS));
    this.retryDelayMs = this.retryMinimumMs;
  }

  async ready() {
    if (!this.readyPromise) this.readyPromise = this.initialize();
    return this.readyPromise;
  }

  private async initialize() {
    await mkdir(this.directory, { recursive: true });
    await this.loadState();
    const files = (await readdir(this.directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && ENTRY_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const path = join(this.directory, file);
      try {
        const item = await this.readEntry(path);
        if (!item) {
          await rm(path, { force: true });
          this.state.droppedBatches += 1;
          continue;
        }
        this.entries.push(item);
        this.queuedBytes += item.fileBytes;
        const sequence = Number(ENTRY_PATTERN.exec(file)?.[2] ?? 0);
        this.state.nextSequence = Math.max(this.state.nextSequence, sequence + 1);
      } catch {
        await rm(path, { force: true }).catch(() => undefined);
        this.state.droppedBatches += 1;
      }
    }
    await this.persistState();
    this.replayState = this.entries.length ? "buffering" : "idle";
  }

  private async loadState() {
    try {
      const parsed = JSON.parse(await readFile(stateFile(this.directory), "utf8")) as unknown;
      if (!isRecord(parsed) || parsed.version !== 1) return;
      this.state = {
        version: 1,
        nextSequence: safeInteger(parsed.nextSequence, 0),
        droppedBatches: safeInteger(parsed.droppedBatches, 0),
        lastSuccessfulReplayAt: safeTimestamp(parsed.lastSuccessfulReplayAt),
        lastUpstreamFailureAt: safeTimestamp(parsed.lastUpstreamFailureAt),
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      this.state = { version: 1, nextSequence: 0, droppedBatches: 0 };
    }
  }

  private async persistState() {
    await writeAtomically(stateFile(this.directory), `${JSON.stringify(this.state)}\n`);
  }

  private serialize<T>(work: () => Promise<T>) {
    const pending = this.mutationChain.then(work);
    this.mutationChain = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async readEntry(path: string): Promise<SpoolEntry | undefined> {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.id !== "string" || !isContentType(parsed.contentType) || typeof parsed.enqueuedAt !== "string" || !Number.isFinite(Date.parse(parsed.enqueuedAt)) || typeof parsed.bodyBase64 !== "string" || !isBase64(parsed.bodyBase64)) return undefined;
    const body = Buffer.from(parsed.bodyBase64, "base64");
    const bodyBytes = safeInteger(parsed.bodyBytes, -1);
    if (bodyBytes !== body.byteLength || bodyBytes > TELEMETRY_SPOOL_MAX_ENTRY_BODY_BYTES) return undefined;
    const fileStats = await stat(path);
    return {
      id: parsed.id,
      contentType: parsed.contentType,
      body,
      enqueuedAt: parsed.enqueuedAt,
      path,
      fileBytes: fileStats.size,
    };
  }

  private healthSnapshot(): TelemetryBufferHealth {
    const oldest = this.entries[0];
    return {
      queuedBatches: this.entries.length,
      queuedBytes: this.queuedBytes,
      oldestQueuedAgeSeconds: oldest ? Math.max(0, Math.floor((this.now() - Date.parse(oldest.enqueuedAt)) / 1_000)) : undefined,
      lastSuccessfulReplayAt: this.state.lastSuccessfulReplayAt,
      lastUpstreamFailureAt: this.state.lastUpstreamFailureAt,
      droppedBatches: this.state.droppedBatches,
      replayState: this.replayState,
    };
  }

  async health(): Promise<TelemetryBufferHealth> {
    try {
      await this.ready();
      return this.healthSnapshot();
    } catch {
      return { queuedBatches: 0, queuedBytes: 0, droppedBatches: this.state.droppedBatches, replayState: "degraded" };
    }
  }

  async hasPending() {
    await this.ready();
    return this.entries.length > 0;
  }

  nextRetryAt() {
    return this.retryNotBefore;
  }

  async recordUpstreamFailure() {
    await this.ready();
    return this.serialize(async () => {
      this.state.lastUpstreamFailureAt = new Date(this.now()).toISOString();
      this.replayState = "buffering";
      this.retryNotBefore = Math.max(this.retryNotBefore, this.now() + this.retryDelayMs);
      await this.persistState();
    });
  }

  async enqueue(contentType: TelemetrySpoolContentType, body: Uint8Array) {
    await this.ready();
    return this.serialize(() => this.enqueueReady(contentType, body));
  }

  async drop() {
    await this.ready();
    return this.serialize(async () => {
      this.state.droppedBatches += 1;
      await this.persistState();
      return this.healthSnapshot();
    });
  }

  private async enqueueReady(contentType: TelemetrySpoolContentType, body: Uint8Array) {
    if (!isContentType(contentType)) throw new Error("telemetry_spool_entry_invalid");
    if (body.byteLength > TELEMETRY_SPOOL_MAX_ENTRY_BODY_BYTES) {
      this.state.droppedBatches += 1;
      await this.persistState();
      return this.healthSnapshot();
    }
    const sequence = this.state.nextSequence++;
    const enqueuedAt = new Date(this.now()).toISOString();
    const id = `entry-${String(this.now()).padStart(16, "0")}-${String(sequence).padStart(12, "0")}`;
    const serialized: SerializedSpoolEntry = {
      version: 1,
      id,
      contentType,
      enqueuedAt,
      bodyBytes: body.byteLength,
      bodyBase64: Buffer.from(body).toString("base64"),
    };
    const contents = `${JSON.stringify(serialized)}\n`;
    const fileBytes = Buffer.byteLength(contents, "utf8");
    if (fileBytes > this.maxBytes) {
      this.state.droppedBatches += 1;
      await this.persistState();
      return this.healthSnapshot();
    }

    while (this.entries.length >= this.maxFiles || this.queuedBytes + fileBytes > this.maxBytes) {
      const oldest = this.entries.shift();
      if (!oldest) break;
      this.queuedBytes -= oldest.fileBytes;
      await rm(oldest.path, { force: true });
      this.state.droppedBatches += 1;
    }

    const path = join(this.directory, `${id}.json`);
    await writeAtomically(path, contents);
    this.entries.push({ id, contentType, body: Uint8Array.from(body), enqueuedAt, path, fileBytes });
    this.queuedBytes += fileBytes;
    this.replayState = "buffering";
    await this.persistState();
    return this.healthSnapshot();
  }

  async replay(send: (item: TelemetrySpoolItem) => Promise<TelemetrySpoolReplayResult>, force = false) {
    await this.ready();
    if (this.replayPromise) return this.replayPromise;
    if (!this.entries.length || (!force && this.now() < this.retryNotBefore)) return 0;
    this.replayPromise = this.replayInternal(send).finally(() => {
      this.replayPromise = undefined;
    });
    return this.replayPromise;
  }

  private async replayInternal(send: (item: TelemetrySpoolItem) => Promise<TelemetrySpoolReplayResult>) {
    this.replayState = "replaying";
    let delivered = 0;
    let attempts = 0;
    while (this.entries.length && attempts < this.replayBatchSize) {
      attempts += 1;
      const entry = this.entries[0];
      let result: TelemetrySpoolReplayResult;
      try {
        result = await send({ id: entry.id, contentType: entry.contentType, body: entry.body, enqueuedAt: entry.enqueuedAt });
      } catch {
        result = "retry";
      }
      if (result === "retry") {
        await this.serialize(async () => {
          this.state.lastUpstreamFailureAt = new Date(this.now()).toISOString();
          this.replayState = "degraded";
          this.retryNotBefore = this.now() + this.retryDelayMs;
          this.retryDelayMs = Math.min(this.retryMaximumMs, Math.max(this.retryMinimumMs, this.retryDelayMs * 2 || this.retryMinimumMs));
          await this.persistState();
        });
        return delivered;
      }
      const removed = await this.serialize(async () => {
        if (this.entries[0]?.id !== entry.id) return false;
        this.entries.shift();
        this.queuedBytes -= entry.fileBytes;
        await rm(entry.path, { force: true });
        if (result === "drop") this.state.droppedBatches += 1;
        else {
          delivered += 1;
          this.state.lastSuccessfulReplayAt = new Date(this.now()).toISOString();
        }
        this.retryDelayMs = this.retryMinimumMs;
        this.retryNotBefore = 0;
        await this.persistState();
        return true;
      });
      if (!removed) return delivered;
    }
    await this.serialize(async () => {
      this.replayState = this.entries.length ? "replaying" : "idle";
    });
    return delivered;
  }
}
