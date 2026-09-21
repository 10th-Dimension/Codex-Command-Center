import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const databaseName = "codex-command-center-telemetry";
const projectRoot = process.cwd();
const wranglerCli = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const backfillScript = join(projectRoot, "scripts", "backfill-codex-rollups.mjs");

function run(command: string, argumentsList: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: projectRoot,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}. ${stderr || stdout}`));
    });
  });
}

function rowsFromJson(output: string): Record<string, unknown>[] {
  const queue: unknown[] = [JSON.parse(output)];
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      queue.push(...value);
    } else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (Array.isArray(object.results)) return object.results as Record<string, unknown>[];
      queue.push(...Object.values(object));
    }
  }
  return [];
}

test("historical backfill writes zeroes for absent count dimensions without changing raw telemetry", { timeout: 120_000 }, async () => {
  const persistence = await mkdtemp(join(tmpdir(), "codex-backfill-null-test-"));
  const locationArguments = ["--local", "--persist-to", persistence];
  const wrangler = (...argumentsList: string[]) => run(process.execPath, [wranglerCli, ...argumentsList]);
  const query = async (sql: string) => {
    const result = await wrangler("d1", "execute", databaseName, ...locationArguments, "--command", sql, "--json");
    return rowsFromJson(result.stdout);
  };

  try {
    await wrangler("d1", "migrations", "apply", databaseName, ...locationArguments);
    await query(`INSERT INTO codex_telemetry_events (
      id,event_fingerprint,occurred_at,received_at,event_name,event_category,session_id,
      safe_attribute_keys_json,unknown_attribute_keys_json
    ) VALUES (
      'backfill-null-event','backfill-null-fingerprint',datetime('now','-1 hour'),datetime('now'),
      'codex.api_request','api-request','backfill-null-session','[]','[]'
    )`);

    const rawBefore = await query("SELECT * FROM codex_telemetry_events ORDER BY id");
    const backfill = await run(process.execPath, [backfillScript, `--persist-to=${persistence}`]);
    assert.match(backfill.stdout, /Backfill complete/);

    const hourlyRows = await query("SELECT hour_start,completed_tools,failed_tools,error_count,warning_count,approvals FROM codex_rollup_hourly ORDER BY hour_start");
    const sessionRows = await query("SELECT completed_tools,failed_tools,error_count,warning_count,approvals FROM codex_session_summary");
    const snapshots = await query("SELECT range,payload_json FROM codex_dashboard_snapshot ORDER BY range");
    const rawAfter = await query("SELECT * FROM codex_telemetry_events ORDER BY id");
    const expectedCounters = {
      completed_tools: 0,
      failed_tools: 0,
      error_count: 0,
      warning_count: 0,
      approvals: 0,
    };

    assert.equal(hourlyRows.length, 1);
    assert.deepEqual({
      completed_tools: hourlyRows[0]?.completed_tools,
      failed_tools: hourlyRows[0]?.failed_tools,
      error_count: hourlyRows[0]?.error_count,
      warning_count: hourlyRows[0]?.warning_count,
      approvals: hourlyRows[0]?.approvals,
    }, expectedCounters);
    assert.match(String(hourlyRows[0]?.hour_start), /T\d{2}:(00|10|20|30|40|50):00\.000Z$/);
    const overviewSnapshot = snapshots.find((row) => row.range === "24h");
    const overviewPayload = JSON.parse(String(overviewSnapshot?.payload_json)) as { trend?: Array<{ label?: string }> };
    assert.equal(overviewPayload.trend?.[0]?.label, hourlyRows[0]?.hour_start);
    assert.equal(sessionRows.length, 1);
    assert.deepEqual(sessionRows[0], expectedCounters);
    assert.deepEqual(snapshots.map((row) => row.range).sort(), ["24h", "30d", "7d"]);
    assert.deepEqual(rawAfter, rawBefore);
  } finally {
    await rm(persistence, { recursive: true, force: true });
  }
});
