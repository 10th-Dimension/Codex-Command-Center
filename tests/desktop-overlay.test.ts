import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { telemetryFreshness } from "../desktop/overlay/src/lib/freshness";
import { shouldReplaceOverlaySnapshot } from "../desktop/overlay/src/lib/snapshot";
import { absoluteResetTime, estimateUsagePace, quotaFreshness, resetCountdown } from "../src/lib/overlay/account";
import type { OverlaySnapshot } from "../src/lib/overlay/contracts";
import { defaultDesktopOverlaySettings, isSafeHexColor, isSafeHotkey, needsPresetResize, overlayLayouts, overlayRanges, parseDesktopOverlaySettings, shouldPollRemote } from "../desktop/overlay/src/lib/settings";

test("desktop settings preserve supported choices and bound unsafe values", () => {
  const parsed = parseDesktopOverlaySettings({ opacity: 2, fontScale: 400, refreshSeconds: 1, layout: "expanded", density: "comfortable", textColor: "red", surface: "light" });
  assert.equal(parsed.opacity, 2);
  assert.equal(parseDesktopOverlaySettings({ opacity: -1 }).opacity, 0);
  assert.equal(parseDesktopOverlaySettings({ opacity: 101 }).opacity, 100);
  assert.equal(parsed.fontScale, 150);
  assert.equal(parsed.refreshSeconds, 5);
  assert.equal(parsed.layout, "expanded");
  assert.equal(parsed.density, "comfortable");
  assert.equal(parsed.textColor, "red");
  assert.equal(parsed.surface, "light");
});

test("desktop color and hotkey validation reject content-shaped input", () => {
  assert.equal(isSafeHexColor("#f0a123"), true);
  assert.equal(isSafeHexColor("rgba(0,0,0,.5)"), false);
  assert.equal(isSafeHotkey("Ctrl+Shift+Space"), true);
  assert.equal(isSafeHotkey("run powershell.exe"), false);
  const parsed = parseDesktopOverlaySettings({ customTextColor: "url(https://example.com)", accentColor: "red", chartLineColor: "var(--secret)", showHideHotkey: "bad value" });
  assert.equal(parsed.customTextColor, defaultDesktopOverlaySettings.customTextColor);
  assert.equal(parsed.accentColor, defaultDesktopOverlaySettings.accentColor);
  assert.equal(parsed.chartLineColor, defaultDesktopOverlaySettings.chartLineColor);
  assert.equal(parseDesktopOverlaySettings({ chartLineColor: "#d123ef" }).chartLineColor, "#d123ef");
  assert.equal(parseDesktopOverlaySettings({}).chartLineColor, "#66d9e8");
  assert.equal(parsed.showHideHotkey, defaultDesktopOverlaySettings.showHideHotkey);
});

test("manual resizing preserves the selected layout while undersized restored presets are repaired", () => {
  assert.equal(needsPresetResize(600, 90, "strip"), false);
  assert.equal(needsPresetResize(600, 180, "strip"), false);
  assert.equal(needsPresetResize(280, 123, "strip"), true);
  assert.equal(needsPresetResize(310, 140, "mini"), false);
  assert.equal(needsPresetResize(430, 320, "standard"), false);
  assert.equal(needsPresetResize(430, 500, "expanded"), false);
  assert.equal(needsPresetResize(300, 150, "expanded"), true);
});

test("telemetry freshness distinguishes healthy activity, idle time, degraded paths, and unavailable data", () => {
  const now = Date.parse("2026-09-12T12:00:00.000Z");
  assert.equal(telemetryFreshness("2026-09-12T11:59:52.000Z", now).state, "live");
  assert.equal(telemetryFreshness("2026-09-12T11:59:20.000Z", now).label, "40s ago");
  assert.equal(telemetryFreshness("2026-09-12T11:58:00.000Z", now).label, "2m ago");
  assert.deepEqual(telemetryFreshness("2026-09-12T11:48:00.000Z", now), { state: "idle", label: "Idle · 12m", ageSeconds: 720 });
  assert.equal(telemetryFreshness("2026-09-12T10:50:00.000Z", now).label, "Idle · 1h");
  assert.equal(telemetryFreshness("2026-09-12T11:59:52.000Z", now, false).state, "stale");
  assert.equal(telemetryFreshness(undefined, now).state, "unavailable");
});

test("native overlay keeps a usable snapshot during a degraded same-range refresh", () => {
  const usable = {
    generatedAt: "2026-09-12T12:00:00.000Z",
    range: "24h",
    lastTelemetryAt: "2026-09-12T11:59:00.000Z",
    health: { telemetry: "connected", d1: "connected", github: "connected", ci: "connected" },
    windowSummary: { inputTokens: 10 },
    tokenTrend: [],
    modelDistribution: [],
    reasoningDistribution: [],
  } as OverlaySnapshot;
  const degraded = { ...usable, generatedAt: "2026-09-12T12:00:01.000Z", health: { ...usable.health, telemetry: "unavailable", d1: "unavailable" }, windowSummary: {}, tokenTrend: [], modelDistribution: [], reasoningDistribution: [] } as OverlaySnapshot;
  assert.equal(shouldReplaceOverlaySnapshot(usable, degraded), false);
  assert.equal(shouldReplaceOverlaySnapshot(undefined, degraded), true);
  assert.equal(shouldReplaceOverlaySnapshot(usable, { ...degraded, range: "7d" }), true);
});

test("overlay quick controls reuse supported ranges, layouts, and the existing snapshot fetch", async () => {
  assert.deepEqual(overlayRanges, ["24h", "7d", "30d"]);
  assert.deepEqual(overlayLayouts, ["mini", "standard", "expanded", "strip"]);
  const [app, native, rust, main, workflow] = await Promise.all([
    readFile(new URL("../desktop/overlay/src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src/lib/native.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src-tauri/src/main.rs", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);
  assert.ok((app.match(/overlayRanges\.map/g) ?? []).length >= 2);
  assert.ok((app.match(/overlayLayouts\.map/g) ?? []).length >= 2);
  assert.match(app, /Click-through enabled · Ctrl\+Shift\+O to regain control/);
  assert.match(native, /invoke<OverlaySnapshot>\("fetch_overlay", \{ range \}\)/);
  assert.match(rust, /\.query\(&\[\("range", range\)\]\)/);
  assert.match(native, /kind: "recover-overlay"/);
  assert.match(rust, /\("recover", "Recover Overlay"\)/);
  assert.match(rust, /fn recover_overlay[\s\S]+click_through = false;[\s\S]+lock_position = false;/);
  assert.match(native, /startResizeDragging/);
  assert.match(app, /function ResizeHandles/);
  assert.match(app, /className="standard-trend"/);
  assert.match(app, /Observed operations/);
  assert.match(app, /Snapshot unavailable/);
  assert.match(app, /overlayCache/);
  assert.match(app, /Snapshot stale · showing last good data/);
  assert.match(app, /Recover movement/);
  assert.match(app, /prepareOverlayTrend/);
  assert.match(app, /trend\.observedBuckets/);
  assert.match(app, /Measured input tokens/);
  assert.match(app, /label="Chart line" value=\{settings\.chartLineColor\}/);
  assert.doesNotMatch(app, /compactOverlayTrendPoints|spark-total-line|stackTokenSeries|Token composition/);
  assert.match(app, /formatOverlayTrendLabel/);
  assert.match(app, /No events observed/);
  assert.match(workflow, /tauri -- build --debug --no-bundle/);
  assert.match(rust, /DEFAULT_CLICK_THROUGH: &str = "Ctrl\+Shift\+O"/);
  assert.match(main, /cfg_attr\(windows, windows_subsystem = "windows"\)/);
  assert.doesNotMatch([app, native, rust].join("\n"), /codex_telemetry_events/i);
});

test("process-aware polling suspends network work while ChatGPT is closed or the overlay is hidden", () => {
  assert.equal(defaultDesktopOverlaySettings.followChatgpt, true);
  assert.equal(shouldPollRemote(true, false, true), false);
  assert.equal(shouldPollRemote(true, true, true), true);
  assert.equal(shouldPollRemote(true, true, false), false);
  assert.equal(shouldPollRemote(false, false, true), true);
});

test("native overlay owns a hidden relay child and exposes safe lifecycle controls", async () => {
  const [rust, native, relay, shortcut] = await Promise.all([
    readFile(new URL("../desktop/overlay/src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src/lib/native.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/telemetry-relay.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install-codex-live-shortcut.vbs", import.meta.url), "utf8"),
  ]);
  assert.match(rust, /relay_child: Option<Child>/);
  assert.match(rust, /creation_flags\(CREATE_NO_WINDOW\)/);
  assert.match(rust, /fn relay_is_healthy/);
  assert.match(rust, /fn reconcile_relay/);
  assert.match(rust, /stop_owned_relay/);
  assert.match(rust, /relay_manual_stop/);
  assert.match(rust, /CODEX_LIVE_PARENT_PID/);
  assert.match(relay, /stopWithParent/);
  assert.match(rust, /\("relay-start", "Start Relay"\)/);
  assert.match(rust, /\("relay-restart", "Restart Relay"\)/);
  assert.match(rust, /\("relay-stop", "Stop Relay"\)/);
  assert.match(native, /control_relay/);
  assert.match(relay, /codex-telemetry-relay/);
  assert.match(shortcut, /Codex Live\.lnk/);
  assert.match(shortcut, /codex-command-center-overlay\.exe/);
  assert.doesNotMatch([rust, native, shortcut].join("\n"), /CF_ACCESS_CLIENT|GITHUB_TOKEN|TELEMETRY_INGEST_KEY|authorization/i);
});

test("desktop frontend models and capabilities contain no credential fields or broad permissions", async () => {
  const files = await Promise.all([
    readFile(new URL("../desktop/overlay/src/lib/native.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src-tauri/capabilities/main.json", import.meta.url), "utf8"),
  ]);
  const frontend = files.slice(0, 2).join("\n");
  assert.doesNotMatch(frontend, /CF_ACCESS_CLIENT|GITHUB_TOKEN|TELEMETRY_INGEST_KEY|authorization|promptText|reasoningText|toolArguments|stdout|stderr/i);
  assert.doesNotMatch(files[2], /shell:|fs:|http:|process:|global-shortcut:/);
  assert.match(files[2], /store:allow-get/);
  assert.match(files[2], /autostart:allow-is-enabled/);
});

test("quota presentation uses remaining percentages, local countdowns, and explicitly labeled estimates", async () => {
  const now = Date.parse("2026-09-14T12:00:00.000Z");
  const resetsAt = now / 1_000 + 3 * 3_600;
  const quota = { slot: "primary" as const, kind: "5h" as const, label: "5-hour", durationMins: 300, usedPercent: 67, remainingPercent: 33, resetsAt };
  assert.equal(resetCountdown(resetsAt, now), "3h 0m");
  assert.ok(absoluteResetTime(resetsAt));
  assert.ok(estimateUsagePace(quota, now));
  assert.equal(quotaFreshness({ status: "connected", freshness: "live", rateLimitsObservedAt: new Date(now).toISOString(), limits: [] }, now).label, "Live");
  const app = await readFile(new URL("../desktop/overlay/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /remainingPercent/);
  assert.match(app, /Quota unavailable/);
  assert.match(app, /Linear pace/);
  assert.match(app, /Projected/);
  assert.match(app, /Banked resets/);
  assert.match(app, /Account Activity/);
});

test("native standard overlay reserves enough room for its operational surface", async () => {
  const [config, rust] = await Promise.all([
    readFile(new URL("../desktop/overlay/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);
  assert.match(config, /"width": 430/);
  assert.match(config, /"height": 320/);
  assert.match(rust, /"standard" => Some\(LogicalSize::new\(430\.0, 320\.0\)\)/);
  assert.match(rust, /"strip" => Some\(LogicalSize::new\(600\.0, 90\.0\)\)/);
  assert.match(rust, /"mini" => Some\(LogicalSize::new\(310\.0, 140\.0\)\)/);
  assert.match(rust, /migrate_legacy_standard_size/);
});

test("native pricing rows expose partial USD amounts and keep the long rate note collapsed", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../desktop/overlay/src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /codexEquivalentModelPriceLabel\(model\)/);
  assert.match(app, /"Full coverage"/);
  assert.match(app, /<details className="pricing-details pricing-note-details"><summary>Pricing assumptions/);
  assert.doesNotMatch(app, /<details className="pricing-details pricing-note-details" open/);
  assert.match(app, /pricing-note-details\"><summary>Pricing assumptions <span>\+<\/span><\/summary><p>\{pricing\?\.note/);
  assert.match(styles, /\.pricing-note-details summary/);
  assert.match(styles, /\.pricing-note-details p/);
});

test("native pricing keeps model amounts in view beside long reasons", async () => {
  const styles = await readFile(new URL("../desktop/overlay/src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.pricing-details > div\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)[^}]*overflow-x:\s*hidden/);
  assert.match(styles, /\.pricing-details > div > div\s*\{[^}]*min-width:\s*0[^}]*width:\s*100%[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.pricing-details > div > div > span\s*\{[^}]*flex:\s*1 1 0%/);
  assert.match(styles, /\.pricing-details > div > div > strong\s*\{[^}]*flex:\s*0 0 auto[^}]*margin-left:\s*auto/);
});

test("overlay layouts keep content scrollable when the window is resized", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../desktop/overlay/src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /overlay-content overlay-content-strip/);
  assert.match(app, /overlay-content overlay-content-mini/);
  assert.match(app, /overlay-content-\$\{layout\}/);
  assert.match(app, /if \(layout === "standard"\) return/);
  assert.match(app, /if \(layout === "mini"\) return/);
  assert.match(app, /if \(layout === "strip"\) return/);
  assert.match(styles, /\.overlay-content-standard,\.overlay-content-expanded\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.overlay-content-mini\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.overlay-content-strip\s*\{[^}]*display:\s*grid/);
  assert.doesNotMatch(styles, /\.expanded-content\s*\{[^}]*height:\s*calc\(100% - 238px\)/);
  assert.match(styles, /footer\s*\{[^}]*position:\s*relative/);
  assert.match(styles, /footer\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.doesNotMatch(styles, /footer\s*\{[^}]*(?:position:\s*(?:absolute|fixed|sticky)|inset:)/);
  assert.doesNotMatch(styles, /\.overlay-content-(?:standard|expanded|mini)[^{]*\{[^}]*padding-bottom:/);
  assert.doesNotMatch(styles, /footer \.health-chip[^}]*display:\s*none/);
  assert.match(styles, /@media \(max-width: 330px\)\s*\{[^}]*\.split\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("compact layouts show only their intended information, while expanded retains full diagnostics", async () => {
  const [app, styles, rust] = await Promise.all([
    readFile(new URL("../desktop/overlay/src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);
  const content = app.slice(app.indexOf("function OverlayContent("), app.indexOf("function Expanded("));
  const strip = content.slice(content.indexOf('if (layout === "strip")'), content.indexOf('if (layout === "mini")'));
  const mini = content.slice(content.indexOf('if (layout === "mini")'), content.indexOf('if (layout === "standard")'));
  const standard = content.slice(content.indexOf('if (layout === "standard")'), content.indexOf('return <div className={`overlay-content overlay-content-${layout}`}'));
  const expanded = content.slice(content.indexOf('return <div className={`overlay-content overlay-content-${layout}`}'));
  assert.match(strip, /<StripQuota/);
  assert.doesNotMatch(strip, /<Metric|<HealthChip|<BufferStatus|<footer/);
  assert.match(mini, /<MiniQuota/);
  assert.doesNotMatch(mini, /<Metric|<HealthChip|<BufferStatus|<footer/);
  assert.match(standard, /<QuotaPanel/);
  assert.match(standard, /<TokenTrendChart/);
  assert.doesNotMatch(standard, /<PricingPanel|<BufferStatus|<footer/);
  assert.match(expanded, /<PricingPanel/);
  assert.match(expanded, /<Expanded snapshot/);
  assert.match(expanded, /<BufferStatus/);
  assert.match(app, /estimateUsagePace\(window, now\)/);
  assert.match(app, /width: `\$\{window\.remainingPercent\}%`/);
  assert.match(styles, /\.layout-strip\.app\s*\{[^}]*min-height:\s*0/);
  assert.match(styles, /\.layout-mini \.brand-mode\s*\{[^}]*display:\s*none/);
  assert.match(rust, /fn layout_size\(layout: &str\) -> Option<LogicalSize<f64>>/);
});

test("layout choice, position lock, and transient menus stay coherent at every window size", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../desktop/overlay/src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/overlay/src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /layout-\$\{settings\.layout\}/);
  assert.match(app, /layout=\{settings\.layout\}/);
  assert.doesNotMatch(app, /setEffectiveLayout|addEventListener\("resize"/);
  assert.match(app, /aria-label=\{settings\.lockPosition \? "Unlock position" : "Lock position"\}/);
  assert.match(app, /settings\.lockPosition \? <Lock size=\{12\} \/> : <Unlock size=\{12\} \/>/);
  assert.doesNotMatch(styles, /header-meta > button:first-of-type/);
  assert.match(app, /const openSettings = useCallback\(\(\) => \{\s*setHeaderMenu\(undefined\);\s*setContextOpen\(false\);\s*setSettingsOpen\(true\)/);
  assert.match(app, /document\.addEventListener\("pointerdown", dismissOnOutsideClick\)/);
  assert.match(app, /window\.addEventListener\("blur", dismissOnBlur\)/);
  assert.match(styles, /\.settings-panel\s*\{[^}]*z-index:\s*70/);
});

test("overlay appearance remains stable when the native window loses focus", async () => {
  const rust = await readFile(new URL("../desktop/overlay/src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(rust, /native Mica\/Acrylic tint when a window gains or loses focus/);
  assert.match(rust, /apply_effect[\s\S]*clear_effects\(\)/);
  assert.doesNotMatch(rust, /\.effect\(Effect::(?:Mica|Acrylic)\)/);
});
