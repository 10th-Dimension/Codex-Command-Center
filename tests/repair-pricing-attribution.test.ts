import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const database = "codex-command-center-telemetry";
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const repair = join(root, "scripts", "repair-pricing-attribution.mjs");

function run(args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Command failed (${code}): ${stderr || stdout}`)));
  });
}

test("pricing repair changes only exact historical model-hour attribution and is idempotent", { timeout: 180_000 }, async () => {
  const persistence = await mkdtemp(join(tmpdir(), "codex-pricing-repair-"));
  const location = ["--local", "--persist-to", persistence];
  const execute = async (sql: string) => {
    const response = await run([wrangler, "d1", "execute", database, ...location, "--command", sql, "--json"]);
    return JSON.parse(response.stdout)[0].results as Array<Record<string, unknown>>;
  };
  const time = new Date(Math.floor((Date.now() - 12 * 3_600_000) / 3_600_000) * 3_600_000).toISOString();
  const rows = [
    ["a1", "gpt-6-sol", 100, 30, 20, 10],
    ["a2", "gpt-6-sol", 60, 5, 10, "NULL"],
    ["b1", "gpt-6-luna", 40, 2, 0, 0],
    ["b2", "gpt-6-luna", 40, 2, 0, 0],
    ["c1", "gpt-5.6-sol", 50, 5, "NULL", "NULL"],
    ["d1", "gpt-6-astra", 70, 7, 0, 0],
    ["e1", "gpt-5.6-luna", 20, 5, 15, 10],
  ] as const;
  try {
    await run([wrangler, "d1", "migrations", "apply", database, ...location]);
    await execute(`INSERT INTO codex_telemetry_events
      (id,event_fingerprint,occurred_at,received_at,event_name,event_category,model,input_tokens,output_tokens,cached_input_tokens,cache_write_tokens)
      VALUES ${rows.map(([id, model, input, output, cached, written]) =>
        `('${id}','${id}','${time}','${time}','codex.api_request','api-request','${model}',${input},${output},${cached},${written})`).join(",")}`);
    const modelRows = [
      ["gpt-6-sol", 2, 160, 35, 30, 0, 0, 0],
      ["gpt-6-luna", 1, 40, 2, 0, 0, 0, 0], // Disagrees with retained raw events.
      ["gpt-5.6-sol", 1, 50, 5, 0, 0, 0, 0], // Missing original token categories.
      ["gpt-6-astra", 1, 70, 7, 0, 70, 7, 1], // Already attributed.
      ["gpt-5.6-luna", 1, 20, 5, 15, 0, 0, 0], // Categories overlap.
    ] as const;
    await execute(`INSERT INTO codex_rollup_model_hourly
      (hour_start,model,event_count,input_tokens,output_tokens,cached_tokens,pricing_input_tokens,pricing_output_tokens,pricing_sample_count)
      VALUES ${modelRows.map(([model, count, input, output, cached, pricedInput, pricedOutput, samples]) =>
        `('${time}','${model}',${count},${input},${output},${cached},${pricedInput},${pricedOutput},${samples})`).join(",")}`);
    await execute("INSERT INTO codex_dashboard_snapshot (range,generated_at,payload_json) VALUES ('24h','2026-01-01T00:00:00.000Z','{}')");
    const rawBefore = await execute("SELECT COUNT(*) AS events,SUM(input_tokens) AS tokens FROM codex_telemetry_events");
    const snapshotBefore = await execute("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot");
    const dry = await run([repair, `--persist-to=${persistence}`]);
    assert.match(dry.stdout, /"candidates":4,"eligible":2,"recoverableTokens":130/);
    assert.match(dry.stdout, /Dry run only/);
    const applied = await run([repair, `--persist-to=${persistence}`, "--apply"]);
    assert.match(applied.stdout, /Exactly matched model-hour rows updated: 2/);
    const sql = "SELECT model,pricing_input_tokens,pricing_cached_tokens,pricing_cache_write_tokens,pricing_output_tokens,pricing_sample_count,pricing_category_overlap_tokens FROM codex_rollup_model_hourly ORDER BY model";
    const repaired = await execute(sql);
    const byModel = new Map(repaired.map((row) => [row.model, row]));
    assert.deepEqual(byModel.get("gpt-6-sol"), {
      model: "gpt-6-sol", pricing_input_tokens: 100, pricing_cached_tokens: 20, pricing_cache_write_tokens: 10,
      pricing_output_tokens: 30, pricing_sample_count: 1, pricing_category_overlap_tokens: 0,
    });
    assert.equal(byModel.get("gpt-6-luna")?.pricing_sample_count, 0);
    assert.equal(byModel.get("gpt-5.6-sol")?.pricing_sample_count, 0);
    assert.equal(byModel.get("gpt-6-astra")?.pricing_sample_count, 1);
    assert.equal(byModel.get("gpt-5.6-luna")?.pricing_category_overlap_tokens, 5);
    const repeated = await run([repair, `--persist-to=${persistence}`, "--apply"]);
    assert.match(repeated.stdout, /No exactly matched historical pricing rows require repair/);
    assert.deepEqual(await execute("SELECT COUNT(*) AS events,SUM(input_tokens) AS tokens FROM codex_telemetry_events"), rawBefore);
    assert.deepEqual(await execute("SELECT range,generated_at,payload_json FROM codex_dashboard_snapshot"), snapshotBefore);
    assert.deepEqual(await execute(sql), repaired);
  } finally {
    await rm(persistence, { recursive: true, force: true });
  }
});
