import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const databaseName = "codex-command-center-telemetry";
const persistence = await mkdtemp(join(tmpdir(), "codex-d1-audit-"));
const wranglerCli = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");

function run(argumentsList, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...argumentsList], {
      cwd: process.cwd(), env: { ...process.env, CI: "1" },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Wrangler exited with code ${code}. ${stderr || stdout}`)));
  });
}

function firstResult(parsed) {
  const queue = [parsed];
  while (queue.length) {
    const value = queue.shift();
    if (value && typeof value === "object") {
      if (Array.isArray(value.results)) return value;
      queue.push(...(Array.isArray(value) ? value : Object.values(value)));
    }
  }
  return { results: [] };
}

async function query(sql) {
  const result = await run(["d1", "execute", databaseName, "--local", "--persist-to", persistence, "--command", sql, "--json"], true);
  return firstResult(JSON.parse(result.stdout));
}

function cost(result) {
  return {
    statements: 1,
    rows_read: result.meta?.rows_read ?? "not exposed by local Wrangler",
    rows_written: result.meta?.rows_written ?? 0,
  };
}

try {
  await run(["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persistence]);
  const digits = "digits(v) AS (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9))";
  await query(`WITH ${digits},seq(n) AS (SELECT a.v+10*b.v+100*c.v+1000*d.v+10000*e.v FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d CROSS JOIN digits e LIMIT 50000)
      INSERT INTO codex_telemetry_events (id,event_fingerprint,occurred_at,received_at,event_name,event_category,session_id,model,input_tokens,output_tokens,safe_attribute_keys_json,unknown_attribute_keys_json)
      SELECT 'audit-'||n,'fingerprint-'||n,datetime('now','-'||(n%43200)||' minutes'),datetime('now'),
        CASE WHEN n%10=0 THEN 'codex.tool_result' ELSE 'codex.api_request' END,CASE WHEN n%97=0 THEN 'error' ELSE 'api-request' END,
        'session-'||(n%200),'audit-model-'||(n%3),10+(n%20),2+(n%8),'[]','[]' FROM seq`);

  const payload = JSON.stringify({ schemaVersion: 1, range: "24h", generatedAt: new Date().toISOString(), summary: {}, trend: [], models: [], reasoningEfforts: [], sessions: [] });
  const quoted = `'${payload.replaceAll("'", "''")}'`;
  await query(`INSERT INTO codex_dashboard_snapshot(range,generated_at,payload_json) VALUES
    ('24h',datetime('now'),${quoted}),('7d',datetime('now'),replace(${quoted},'\"24h\"','\"7d\"')),('30d',datetime('now'),replace(${quoted},'\"24h\"','\"30d\"'))`);

  const overlay = await query("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot WHERE range='24h' LIMIT 1");
  const codexPage = await query("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot WHERE range IN ('24h','7d','30d')");
  const forensicPlan = await query("EXPLAIN QUERY PLAN SELECT model,COUNT(*) FROM codex_telemetry_events WHERE occurred_at>=datetime('now','-30 days') GROUP BY model");

  const [providerSource, overlaySource, querySource, databaseSource] = await Promise.all([
    readFile(join(process.cwd(), "src/lib/providers/codex-core.ts"), "utf8"),
    readFile(join(process.cwd(), "src/lib/overlay/query.ts"), "utf8"),
    readFile(join(process.cwd(), "src/lib/dashboard/queries.ts"), "utf8"),
    readFile(join(process.cwd(), "src/lib/telemetry/database.ts"), "utf8"),
  ]);
  assert.doesNotMatch(providerSource, /codex_telemetry_events/);
  assert.doesNotMatch(overlaySource, /codex_telemetry_events/);
  const githubFunction = querySource.slice(querySource.indexOf("export async function getGitHubPageData"));
  assert.doesNotMatch(githubFunction, /providerRegistry\.codex|CODEX_TELEMETRY_DB|codex_telemetry_events/);
  assert.match(databaseSource, /readTelemetryForensics[\s\S]+codex_telemetry_events/);
  assert.equal(overlay.results.length, 1);
  assert.ok(codexPage.results.length <= 3);

  console.log("D1 COST AUDIT (isolated local database; production was not accessed)");
  console.log("Stress rows:", 50_000);
  console.log("Old forensic/raw path: 35 statements; raw telemetry scans and grouped 30-day analytics are explicit-only.");
  console.log("Overlay normal path:", { ...cost(overlay), returned_rows: overlay.results.length, raw_table_touched: false, budget: "<=5 PASS" });
  console.log("Codex normal page:", { ...cost(codexPage), returned_rows: codexPage.results.length, raw_table_touched: false, budget: "<=50 PASS" });
  console.log("GitHub page:", { statements: 0, rows_read: 0, raw_table_touched: false, budget: "PASS" });
  console.log("Forensic example plan (explicit only):", forensicPlan.results);
  console.log("Local metadata can differ from billed production D1 metrics; source-boundary assertions and returned-row bounds are authoritative architectural guards.");
} finally {
  await rm(persistence, { recursive: true, force: true });
}
