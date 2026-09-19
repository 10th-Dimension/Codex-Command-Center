import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { calculateCodexEquivalentPricing } from "../src/lib/telemetry/pricing.ts";

const databaseName = "codex-command-center-telemetry";
const allowed = new Set(["--remote", "--confirm-remote", "--rebuild"]);
const persistenceOption = process.argv.slice(2).find((argument) => argument.startsWith("--persist-to="));
const unknown = process.argv.slice(2).filter((argument) => !allowed.has(argument) && argument !== persistenceOption);
if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(", ")}`);

const remote = process.argv.includes("--remote");
const confirmedRemote = process.argv.includes("--confirm-remote");
const rebuild = process.argv.includes("--rebuild");
if (confirmedRemote && !remote) throw new Error("--confirm-remote is valid only with --remote.");
if (remote && persistenceOption) throw new Error("--persist-to is local-only.");
if (remote && !confirmedRemote) {
  throw new Error("Remote backfill refused. Re-run with both --remote and --confirm-remote after reviewing the target binding.");
}

const wranglerCli = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const locationArgs = remote ? ["--remote"] : ["--local", ...(persistenceOption ? ["--persist-to", persistenceOption.slice("--persist-to=".length)] : [])];

function runWrangler(argumentsList, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...argumentsList], {
      cwd: process.cwd(),
      env: { ...process.env, CI: "1" },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Wrangler exited with code ${code}. ${stderr}`)));
  });
}

function rowsFromJson(output) {
  const parsed = JSON.parse(output);
  const queue = [parsed];
  while (queue.length) {
    const value = queue.shift();
    if (value && typeof value === "object") {
      if (Array.isArray(value.results)) return value.results;
      queue.push(...(Array.isArray(value) ? value : Object.values(value)));
    }
  }
  return [];
}

async function query(sql) {
  const result = await runWrangler(["d1", "execute", databaseName, ...locationArgs, "--command", sql, "--json"], true);
  return rowsFromJson(result.stdout);
}

const countRows = await query(`SELECT
  (SELECT COUNT(*) FROM codex_rollup_hourly) +
  (SELECT COUNT(*) FROM codex_rollup_model_hourly) +
  (SELECT COUNT(*) FROM codex_rollup_reasoning_hourly) +
  (SELECT COUNT(*) FROM codex_session_summary) AS row_count`);
const existingRows = Number(countRows[0]?.row_count ?? 0);
if (existingRows && !rebuild) {
  throw new Error(`Rollup tables contain ${existingRows} rows. Backfill stopped; use --rebuild only when an intentional rollup-only rebuild is desired.`);
}

console.log(`${remote ? "REMOTE" : "LOCAL"} rollup backfill target: ${databaseName}`);
console.log("The utility reads only privacy-safe scalar/dimension columns and never reads prompt, command, output, credential, or reasoning text.");
console.log(rebuild ? "Existing rollup and snapshot rows will be rebuilt; raw telemetry will not be modified." : "Rollup tables are empty; additive backfill will begin.");

const tempDirectory = await mkdtemp(join(tmpdir(), "codex-rollup-backfill-"));
const sqlPath = join(tempDirectory, "backfill.sql");
const rebuildPrefix = rebuild ? `
DELETE FROM codex_dashboard_snapshot;
DELETE FROM codex_rollup_hourly;
DELETE FROM codex_rollup_model_hourly;
DELETE FROM codex_rollup_reasoning_hourly;
DELETE FROM codex_session_summary;
` : "";
const backfillSql = `${rebuildPrefix}
INSERT INTO codex_rollup_hourly
SELECT substr(occurred_at,1,13) || ':00:00.000Z',COUNT(*),COALESCE(SUM(input_tokens),0),COUNT(input_tokens),
  COALESCE(SUM(output_tokens),0),COUNT(output_tokens),COALESCE(SUM(cached_input_tokens),0),COUNT(cached_input_tokens),
  COALESCE(SUM(cache_write_tokens),0),COUNT(cache_write_tokens),COALESCE(SUM(COALESCE(reasoning_tokens,reasoning_output_tokens)),0),COUNT(COALESCE(reasoning_tokens,reasoning_output_tokens)),
  COALESCE(SUM(tool_tokens),0),COUNT(tool_tokens),
  SUM(CASE WHEN event_category='error' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_category='warning' THEN 1 ELSE 0 END),
  SUM(CASE WHEN tool_execution_state IN ('succeeded','failed') THEN 1 ELSE 0 END),
  SUM(CASE WHEN tool_execution_state='failed' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_category IN ('approval','decision') THEN 1 ELSE 0 END),
  COALESCE(SUM(ttft_ms),0),COUNT(ttft_ms),COALESCE(SUM(duration_ms),0),COUNT(duration_ms),MAX(received_at)
FROM codex_telemetry_events GROUP BY substr(occurred_at,1,13);

INSERT INTO codex_rollup_model_hourly
SELECT substr(occurred_at,1,13) || ':00:00.000Z',model,COUNT(*),COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0),
  COALESCE(SUM(cached_input_tokens),0),COALESCE(SUM(COALESCE(reasoning_tokens,reasoning_output_tokens)),0),COALESCE(SUM(tool_tokens),0),
  COALESCE(SUM(ttft_ms),0),COUNT(ttft_ms)
FROM codex_telemetry_events WHERE model IS NOT NULL GROUP BY substr(occurred_at,1,13),model;

INSERT INTO codex_rollup_reasoning_hourly
SELECT substr(occurred_at,1,13) || ':00:00.000Z',reasoning_effort,COUNT(*),COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0),
  COALESCE(SUM(cached_input_tokens),0),COALESCE(SUM(COALESCE(reasoning_tokens,reasoning_output_tokens)),0),COALESCE(SUM(tool_tokens),0),
  COALESCE(SUM(ttft_ms),0),COUNT(ttft_ms)
FROM codex_telemetry_events WHERE reasoning_effort IS NOT NULL GROUP BY substr(occurred_at,1,13),reasoning_effort;

INSERT INTO codex_session_summary
WITH ranked AS (
  SELECT id,occurred_at,project_name,model,reasoning_effort,event_category,tool_execution_state,input_tokens,output_tokens,
    cached_input_tokens,cache_write_tokens,reasoning_tokens,reasoning_output_tokens,tool_tokens,ttft_ms,
    COALESCE(session_id,thread_id) AS rollup_session_id,
    ROW_NUMBER() OVER (PARTITION BY COALESCE(session_id,thread_id) ORDER BY occurred_at DESC,id DESC) AS recency
  FROM codex_telemetry_events WHERE COALESCE(session_id,thread_id) IS NOT NULL
)
SELECT rollup_session_id,MAX(CASE WHEN recency=1 THEN project_name END),MIN(occurred_at),MAX(occurred_at),
  MAX(CASE WHEN recency=1 THEN model END),MAX(CASE WHEN recency=1 THEN reasoning_effort END),COUNT(*),
  COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0),COALESCE(SUM(cached_input_tokens),0),COALESCE(SUM(cache_write_tokens),0),
  COALESCE(SUM(COALESCE(reasoning_tokens,reasoning_output_tokens)),0),COALESCE(SUM(tool_tokens),0),
  SUM(CASE WHEN tool_execution_state IN ('succeeded','failed') THEN 1 ELSE 0 END),
  SUM(CASE WHEN tool_execution_state='failed' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_category='error' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_category='warning' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_category IN ('approval','decision') THEN 1 ELSE 0 END),
  COALESCE(SUM(ttft_ms),0),COUNT(ttft_ms)
FROM ranked GROUP BY rollup_session_id;
`;

await writeFile(sqlPath, backfillSql, "utf8");
try {
  await runWrangler(["d1", "execute", databaseName, ...locationArgs, "--file", sqlPath]);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

const now = new Date();
const ranges = { "24h": 24, "7d": 168, "30d": 720 };
const measured = (total, samples, observed) => !observed ? { availability: "unavailable", sampleCount: 0 }
  : !Number(samples) ? { availability: "no-samples", sampleCount: 0 }
    : { availability: "available", value: Number(total), sampleCount: Number(samples) };
const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

for (const [range, hours] of Object.entries(ranges)) {
  const cutoff = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const label = range === "24h" ? "hour_start" : "substr(hour_start,1,10)";
  const hourly = await query(`SELECT ${label} AS label,SUM(event_count) AS event_count,SUM(input_tokens) AS input_tokens,SUM(input_samples) AS input_samples,SUM(output_tokens) AS output_tokens,SUM(output_samples) AS output_samples,SUM(cached_tokens) AS cached_tokens,SUM(cached_samples) AS cached_samples,SUM(cache_write_tokens) AS cache_write_tokens,SUM(cache_write_samples) AS cache_write_samples,SUM(reasoning_tokens) AS reasoning_tokens,SUM(reasoning_samples) AS reasoning_samples,SUM(tool_tokens) AS tool_tokens,SUM(tool_token_samples) AS tool_token_samples,SUM(error_count) AS error_count,SUM(warning_count) AS warning_count,SUM(completed_tools) AS completed_tools,SUM(failed_tools) AS failed_tools,SUM(approvals) AS approvals,SUM(ttft_sum_ms) AS ttft_sum_ms,SUM(ttft_sample_count) AS ttft_sample_count,SUM(duration_sum_ms) AS duration_sum_ms,SUM(duration_sample_count) AS duration_sample_count,MAX(last_received_at) AS last_received_at FROM codex_rollup_hourly WHERE hour_start>=${sqlQuote(cutoff)} GROUP BY label ORDER BY label LIMIT 744`);
  const models = await query(`SELECT model AS label,SUM(event_count) AS count,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(cached_tokens) AS cached_tokens,SUM(reasoning_tokens) AS reasoning_tokens,SUM(tool_tokens) AS tool_tokens,COUNT(*) OVER() AS model_count FROM codex_rollup_model_hourly WHERE hour_start>=${sqlQuote(cutoff)} GROUP BY model ORDER BY count DESC LIMIT 64`);
  const reasoning = await query(`SELECT reasoning_effort AS label,SUM(event_count) AS count FROM codex_rollup_reasoning_hourly WHERE hour_start>=${sqlQuote(cutoff)} GROUP BY reasoning_effort ORDER BY count DESC LIMIT 8`);
  const sessions = await query(`SELECT *,COUNT(*) OVER() AS range_session_count FROM codex_session_summary WHERE last_seen_at>=${sqlQuote(cutoff)} ORDER BY last_seen_at DESC LIMIT 20`);
  const total = (key) => hourly.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const observed = hourly.length > 0;
  const pricing = calculateCodexEquivalentPricing({
    metrics: {
      inputTokens: measured(total("input_tokens"), total("input_samples"), observed),
      cachedTokens: measured(total("cached_tokens"), total("cached_samples"), observed),
      outputTokens: measured(total("output_tokens"), total("output_samples"), observed),
    },
    models: models.map((row) => ({ model: row.label, eventCount: Number(row.count), inputTokens: row.input_tokens, cachedInputTokens: row.cached_tokens, outputTokens: row.output_tokens, reasoningTokens: row.reasoning_tokens, toolTokens: row.tool_tokens })),
    modelCount: Number(models[0]?.model_count ?? models.length),
    modelsTruncated: Number(models[0]?.model_count ?? models.length) > models.length,
  });
  const snapshot = {
    schemaVersion: 1, range, generatedAt: now.toISOString(),
    sourceUpdatedAt: hourly.reduce((latest, row) => !row.last_received_at || latest >= row.last_received_at ? latest : row.last_received_at, "") || undefined,
    summary: {
      events: total("event_count"), sessions: Number(sessions[0]?.range_session_count ?? 0),
      inputTokens: measured(total("input_tokens"), total("input_samples"), observed), outputTokens: measured(total("output_tokens"), total("output_samples"), observed),
      cachedTokens: measured(total("cached_tokens"), total("cached_samples"), observed), cacheWriteTokens: measured(total("cache_write_tokens"), total("cache_write_samples"), observed),
      reasoningTokens: measured(total("reasoning_tokens"), total("reasoning_samples"), observed), toolTokens: measured(total("tool_tokens"), total("tool_token_samples"), observed),
      errors: total("error_count"), warnings: total("warning_count"), completedTools: total("completed_tools"), failedTools: total("failed_tools"), approvals: total("approvals"),
      averageTtftMs: total("ttft_sample_count") ? total("ttft_sum_ms") / total("ttft_sample_count") : undefined,
      averageDurationMs: total("duration_sample_count") ? total("duration_sum_ms") / total("duration_sample_count") : undefined,
    },
    trend: hourly.map((row) => ({ label: row.label, events: Number(row.event_count), errors: Number(row.error_count), toolExecutions: Number(row.completed_tools), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), cachedTokens: Number(row.cached_tokens), cacheWriteTokens: Number(row.cache_write_tokens), reasoningTokens: Number(row.reasoning_tokens), toolTokens: Number(row.tool_tokens) })),
    models: models.map((row) => ({ label: row.label, count: Number(row.count) })),
    reasoningEfforts: reasoning.map((row) => ({ label: row.label, count: Number(row.count) })),
    sessions: sessions.map((row) => ({ sessionId: row.session_id, projectName: row.project_name ?? undefined, models: row.latest_model ? [row.latest_model] : [], reasoningEfforts: row.latest_reasoning_effort ? [row.latest_reasoning_effort] : [], eventCount: Number(row.event_count), errorCount: Number(row.error_count), warningCount: Number(row.warning_count), toolExecutions: Number(row.completed_tools), failedTools: Number(row.failed_tools), toolRelatedEvents: Number(row.completed_tools), usageEvents: Number(row.event_count), approvalEvents: Number(row.approvals), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), cachedTokens: Number(row.cached_tokens), cacheWriteTokens: Number(row.cache_write_tokens), reasoningTokens: Number(row.reasoning_tokens), toolTokens: Number(row.tool_tokens), averageTtftMs: Number(row.ttft_sample_count) ? Number(row.ttft_sum_ms) / Number(row.ttft_sample_count) : undefined, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at })),
    pricing,
  };
  const payload = JSON.stringify(snapshot);
  if (payload.length > 262_144) throw new Error(`${range} snapshot exceeds the 256 KiB bound.`);
  await query(`INSERT INTO codex_dashboard_snapshot (range,generated_at,source_updated_at,payload_json) VALUES (${sqlQuote(range)},${sqlQuote(snapshot.generatedAt)},${snapshot.sourceUpdatedAt ? sqlQuote(snapshot.sourceUpdatedAt) : "NULL"},${sqlQuote(payload)}) ON CONFLICT(range) DO UPDATE SET generated_at=excluded.generated_at,source_updated_at=excluded.source_updated_at,payload_json=excluded.payload_json`);
}

const counts = await query(`SELECT
  (SELECT COUNT(*) FROM codex_rollup_hourly) AS hours,
  (SELECT COUNT(*) FROM codex_rollup_model_hourly) AS model_hours,
  (SELECT COUNT(*) FROM codex_rollup_reasoning_hourly) AS reasoning_hours,
  (SELECT COUNT(*) FROM codex_session_summary) AS sessions,
  (SELECT COUNT(*) FROM codex_dashboard_snapshot) AS snapshots`);
console.log("Backfill complete:", counts[0]);
console.log("Raw telemetry was read for four grouped aggregate scans and was not modified.");
