import { spawn } from "node:child_process";
import { join } from "node:path";

// One-time, opt-in repair for pricing counters introduced by migration 0004.
// It never rewrites raw evidence, scalar rollups, sessions, or snapshots.
const databaseName = "codex-command-center-telemetry";
const argumentsList = process.argv.slice(2);
const persistenceOption = argumentsList.find((argument) => argument.startsWith("--persist-to="));
const allowed = new Set(["--remote", "--confirm-remote", "--apply"]);
if (argumentsList.some((argument) => !allowed.has(argument) && argument !== persistenceOption)) {
  throw new Error("Unsupported pricing repair argument.");
}
const remote = argumentsList.includes("--remote");
const apply = argumentsList.includes("--apply");
if (remote && (!argumentsList.includes("--confirm-remote") || persistenceOption)) {
  throw new Error("Remote pricing repair requires --remote --confirm-remote and no local persistence path; --apply enables writes.");
}
if (!remote && argumentsList.includes("--confirm-remote")) throw new Error("--confirm-remote is remote-only.");

const wranglerCli = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const location = remote ? ["--remote"] : ["--local", ...(persistenceOption ? ["--persist-to", persistenceOption.slice("--persist-to=".length)] : [])];
const hourMs = 3_600_000;
const now = Date.now();
const firstHour = new Date(Math.ceil((now - 30 * 24 * hourMs) / hourMs) * hourMs).toISOString();
const currentHour = new Date(Math.floor(now / hourMs) * hourMs).toISOString();
const sqlQuote = (value) => `'${value.replaceAll("'", "''")}'`;

function execute(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, "d1", "execute", databaseName, ...location, "--command", sql, "--json"], {
      cwd: process.cwd(), env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    // Do not echo Wrangler stderr, SQL, paths, or environment into diagnostics.
    child.stderr.resume();
    child.once("error", () => reject(new Error("Unable to start the pricing repair database command.")));
    child.once("exit", (code) => {
      if (code !== 0) return reject(new Error(`Pricing repair database command failed (exit ${code}).`));
      try {
        const result = JSON.parse(stdout)[0];
        if (!result?.success) throw new Error("Database operation was not successful.");
        resolve(result);
      } catch {
        reject(new Error("Pricing repair database response was invalid."));
      }
    });
  });
}

// Only scalar fields needed for exact model-hour pricing are read. A retained
// raw group must reproduce the existing rollup before any counter is updated.
const rawSql = `WITH raw AS (
  SELECT strftime('%Y-%m-%dT%H:00:00.000Z',occurred_at) AS hour_start,model,
    COUNT(*) AS event_count,COALESCE(SUM(input_tokens),0) AS input_tokens,
    COALESCE(SUM(output_tokens),0) AS output_tokens,
    COALESCE(SUM(cached_input_tokens),0) AS cached_tokens,
    COALESCE(SUM(COALESCE(reasoning_tokens,reasoning_output_tokens)),0) AS reasoning_tokens,
    COALESCE(SUM(tool_tokens),0) AS tool_tokens,
    COALESCE(SUM(ttft_ms),0) AS ttft_sum_ms,COUNT(ttft_ms) AS ttft_sample_count,
    COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL
      AND cached_input_tokens+cache_write_tokens<=input_tokens THEN input_tokens ELSE 0 END),0) AS pricing_input_tokens,
    COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL
      AND cached_input_tokens+cache_write_tokens<=input_tokens THEN cached_input_tokens ELSE 0 END),0) AS pricing_cached_tokens,
    COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL
      AND cached_input_tokens+cache_write_tokens<=input_tokens THEN cache_write_tokens ELSE 0 END),0) AS pricing_cache_write_tokens,
    COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL
      AND cached_input_tokens+cache_write_tokens<=input_tokens THEN output_tokens ELSE 0 END),0) AS pricing_output_tokens,
    SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL
      AND cached_input_tokens+cache_write_tokens<=input_tokens THEN 1 ELSE 0 END) AS pricing_sample_count,
    COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL AND cache_write_tokens IS NOT NULL
      AND cached_input_tokens+cache_write_tokens>input_tokens
      THEN cached_input_tokens+cache_write_tokens-input_tokens ELSE 0 END),0) AS pricing_category_overlap_tokens
  FROM codex_telemetry_events_all
  WHERE occurred_at>=${sqlQuote(firstHour)} AND occurred_at<${sqlQuote(currentHour)} AND model IS NOT NULL
  GROUP BY strftime('%Y-%m-%dT%H:00:00.000Z',occurred_at),model
)`;
const candidate = `m.hour_start>=${sqlQuote(firstHour)} AND m.hour_start<${sqlQuote(currentHour)}
  AND m.input_tokens+m.output_tokens>0 AND m.pricing_sample_count=0
  AND m.pricing_input_tokens=0 AND m.pricing_cached_tokens=0
  AND m.pricing_cache_write_tokens=0 AND m.pricing_output_tokens=0
  AND m.pricing_category_overlap_tokens=0`;
const exact = `r.event_count=m.event_count AND r.input_tokens=m.input_tokens
  AND r.output_tokens=m.output_tokens AND r.cached_tokens=m.cached_tokens
  AND r.reasoning_tokens=m.reasoning_tokens AND r.tool_tokens=m.tool_tokens
  AND r.ttft_sum_ms=m.ttft_sum_ms AND r.ttft_sample_count=m.ttft_sample_count`;
const useful = `(r.pricing_sample_count>0 OR r.pricing_category_overlap_tokens>0)`;
const preview = await execute(`${rawSql} SELECT COUNT(*) AS candidates,
  SUM(CASE WHEN ${exact} AND ${useful} THEN 1 ELSE 0 END) AS eligible,
  SUM(CASE WHEN ${exact} AND ${useful} THEN r.pricing_input_tokens+r.pricing_output_tokens ELSE 0 END) AS recoverable_tokens,
  SUM(CASE WHEN ${exact} THEN m.input_tokens+m.output_tokens ELSE 0 END) AS matched_tokens
  FROM codex_rollup_model_hourly m LEFT JOIN raw r ON r.hour_start=m.hour_start AND r.model=m.model WHERE ${candidate}`);
const summary = preview.results?.[0] ?? {};
console.log("Pricing repair preflight:", JSON.stringify({
  candidates: Number(summary.candidates ?? 0), eligible: Number(summary.eligible ?? 0),
  recoverableTokens: Number(summary.recoverable_tokens ?? 0), matchedTokens: Number(summary.matched_tokens ?? 0),
}));
if (!apply) {
  console.log("Dry run only; no database rows changed.");
} else if (Number(summary.eligible ?? 0) === 0) {
  console.log("No exactly matched historical pricing rows require repair.");
} else {
  const updated = await execute(`${rawSql} UPDATE codex_rollup_model_hourly AS m SET
    pricing_input_tokens=r.pricing_input_tokens,pricing_cached_tokens=r.pricing_cached_tokens,
    pricing_cache_write_tokens=r.pricing_cache_write_tokens,pricing_output_tokens=r.pricing_output_tokens,
    pricing_sample_count=r.pricing_sample_count,pricing_category_overlap_tokens=r.pricing_category_overlap_tokens
    FROM raw AS r WHERE r.hour_start=m.hour_start AND r.model=m.model
    AND ${candidate} AND ${exact} AND ${useful} RETURNING 1 AS updated`);
  console.log("Exactly matched model-hour rows updated:", updated.results?.length ?? 0);
  console.log("Raw telemetry, other rollups, and dashboard snapshots were not modified. Snapshots refresh on the normal ingest schedule.");
}
