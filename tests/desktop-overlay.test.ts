import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { telemetryFreshness } from "../desktop/overlay/src/lib/freshness";
import { defaultDesktopOverlaySettings, isSafeHexColor, isSafeHotkey, parseDesktopOverlaySettings, resolveLayout, shouldPollRemote } from "../desktop/overlay/src/lib/settings";

test("desktop settings preserve supported choices and bound unsafe values", () => {
  const parsed = parseDesktopOverlaySettings({ opacity: 2, fontScale: 400, refreshSeconds: 1, layout: "expanded", density: "comfortable", textColor: "red", surface: "light" });
  assert.equal(parsed.opacity, 20);
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
  const parsed = parseDesktopOverlaySettings({ customTextColor: "url(https://example.com)", accentColor: "red", showHideHotkey: "bad value" });
  assert.equal(parsed.customTextColor, defaultDesktopOverlaySettings.customTextColor);
  assert.equal(parsed.accentColor, defaultDesktopOverlaySettings.accentColor);
  assert.equal(parsed.showHideHotkey, defaultDesktopOverlaySettings.showHideHotkey);
});

test("desktop layout resolution remains usable when resized", () => {
  assert.equal(resolveLayout(300, 150, "expanded"), "mini");
  assert.equal(resolveLayout(360, 250, "expanded"), "standard");
  assert.equal(resolveLayout(430, 500, "expanded"), "expanded");
  assert.equal(resolveLayout(600, 90, "standard"), "strip");
});

test("telemetry freshness distinguishes live, recent, stale, and unavailable", () => {
  const now = Date.parse("2026-09-12T12:00:00.000Z");
  assert.equal(telemetryFreshness("2026-09-12T11:59:52.000Z", now).state, "live");
  assert.equal(telemetryFreshness("2026-09-12T11:59:20.000Z", now).label, "40s ago");
  assert.equal(telemetryFreshness("2026-09-12T11:58:00.000Z", now).label, "2m ago");
  assert.equal(telemetryFreshness("2026-09-12T11:50:00.000Z", now).state, "stale");
  assert.equal(telemetryFreshness(undefined, now).state, "unavailable");
});

test("process-aware polling suspends network work while ChatGPT is closed or the overlay is hidden", () => {
  assert.equal(defaultDesktopOverlaySettings.followChatgpt, true);
  assert.equal(shouldPollRemote(true, false, true), false);
  assert.equal(shouldPollRemote(true, true, true), true);
  assert.equal(shouldPollRemote(true, true, false), false);
  assert.equal(shouldPollRemote(false, false, true), true);
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
