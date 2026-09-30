import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_CLI_COMMANDS,
  CODEX_DESKTOP_COMMANDS,
  GPT_61_SOL,
  LOCAL_CODEX_MODELS,
  LOCAL_CODEX_RUNTIME,
  OTHER_REVIEWED_SURFACES,
  PLATFORM_CAPABILITIES,
  PLATFORM_SOURCES,
  SERVICE_TIER_REGISTRY,
  TELEMETRY_BOUNDARIES,
  USAGE_RESET_SEMANTICS,
  normalizeKnownModelIdentifier,
  normalizeServiceTier,
  reasoningEffortSupport,
} from "../src/lib/platform/registry";

test("GPT-6.1 Sol aliases and reasoning-suffixed variants resolve without mutating unknown identifiers", () => {
  assert.equal(normalizeKnownModelIdentifier("GPT-6.1 Sol"), "gpt-6.1-sol");
  assert.equal(normalizeKnownModelIdentifier("gpt-6.1-sol"), "gpt-6.1-sol");
  assert.equal(normalizeKnownModelIdentifier("6.1 Sol"), "gpt-6.1-sol");
  assert.equal(normalizeKnownModelIdentifier("openai/gpt-6.1-sol-xhigh"), "gpt-6.1-sol");
  assert.equal(normalizeKnownModelIdentifier("FutureModel/Case-Sensitive"), "FutureModel/Case-Sensitive");
});

test("GPT-6.1 Sol reasoning support is explicit and surface-scoped", () => {
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    assert.equal(reasoningEffortSupport("6.1 Sol", effort, "api"), "supported", effort);
  }
  assert.equal(reasoningEffortSupport("gpt-6.1-sol", "none", "api"), "unsupported");
  assert.equal(reasoningEffortSupport("gpt-6.1-sol", "minimal", "api"), "unsupported");
  assert.equal(reasoningEffortSupport("gpt-6.1-sol", "low", "installed-codex"), "unknown");
  assert.equal(reasoningEffortSupport("future-model", "low", "api"), "unknown");
});

test("local catalog snapshot preserves legacy entries and separates Ultra effort from Ultrafast tier", () => {
  assert.equal(LOCAL_CODEX_MODELS.length, 11);
  for (const slug of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.ok(LOCAL_CODEX_MODELS.some(({ id }) => id === slug), slug);
  }
  assert.equal(reasoningEffortSupport("gpt-6-astra", "ultra", "installed-codex"), "supported");
  assert.equal(reasoningEffortSupport("gpt-6-astra", "ultrafast", "installed-codex"), "unsupported");
  assert.equal(normalizeServiceTier("ultrafast"), "ultrafast");
  assert.equal(normalizeServiceTier("priority:Fast"), "fast");
  assert.equal(normalizeServiceTier("priority"), "fast");
  assert.equal(normalizeServiceTier(undefined), "unknown");
  assert.equal(normalizeServiceTier("future-tier"), "unknown");
  assert.equal(SERVICE_TIER_REGISTRY.find(({ id }) => id === "ultrafast")?.apiMultiplier, 6);
  assert.equal(SERVICE_TIER_REGISTRY.find(({ id }) => id === "ultrafast")?.workCodexIncludedAllowanceMultiplier, 8);
});

test("GPT-6.1 Sol product release, local bundle observation, and account eligibility remain distinct", () => {
  assert.equal(GPT_61_SOL.apiStatus, "available");
  assert.equal(GPT_61_SOL.workCodexStatus, "available");
  assert.equal(GPT_61_SOL.installedCodexBundleObservation, "not_observed");
  assert.equal(GPT_61_SOL.accountAvailability, "unknown");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "gpt-6.1-multi-agent")?.status, "beta");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "gpt-6.1-multi-agent")?.accountAvailability, "unknown");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "codex-cloud")?.accountAvailability, "unknown");
});

test("command registries separate upstream CLI/TUI source, desktop docs, and local observation", () => {
  const cliNames = new Set(CODEX_CLI_COMMANDS.map(({ command }) => command));
  for (const command of ["/voice", "/goal", "/agents", "/subagents", "/memories", "/apps", "/plugins", "/setup-default-sandbox", "/approve"]) {
    assert.ok(cliNames.has(command), command);
  }
  for (const incorrectCommand of ["/multi-agents", "/elevate-sandbox", "/auto-review"]) {
    assert.ok(!cliNames.has(incorrectCommand), incorrectCommand);
  }
  assert.equal(CODEX_CLI_COMMANDS.find(({ command }) => command === "/voice")?.status, "unknown");
  assert.equal(CODEX_CLI_COMMANDS.find(({ command }) => command === "/voice")?.official, true);
  assert.equal(CODEX_CLI_COMMANDS.find(({ command }) => command === "/voice")?.localObservation, "unknown");
  assert.equal(CODEX_CLI_COMMANDS.find(({ command }) => command === "/rollout")?.surface, "Codex CLI/TUI debug build");
  assert.ok(CODEX_DESKTOP_COMMANDS.some(({ command }) => command === "/cloud-environment"));
  assert.ok(!CODEX_DESKTOP_COMMANDS.some(({ command }) => command === "/plugins"));
  assert.ok(LOCAL_CODEX_RUNTIME.topLevelCommands.includes("app-server"));
  assert.equal(PLATFORM_SOURCES.codexSource.authority, "official_source_code");
  assert.equal(PLATFORM_SOURCES.devDayEvent.effectiveDate, "2026-09-29");
  assert.equal(PLATFORM_SOURCES.devDayEvent.authority, "official_event");
  assert.equal(PLATFORM_SOURCES.desktopCommands.authority, "official_help_center");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "daybreak")?.status, "available");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "daybreak")?.accountAvailability, "unknown");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "gpt-5.5-retirement")?.status, "announced");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "gpt-5.4-codex-retirement")?.status, "unavailable");
  assert.equal(PLATFORM_CAPABILITIES.find(({ id }) => id === "codex-voice-command")?.accountAvailability, "unknown");
  assert.equal("effectiveDate" in PLATFORM_SOURCES.dots, false);
  assert.equal("effectiveDate" in PLATFORM_SOURCES.space, false);
});

test("reset kinds and missing telemetry fields are explicitly distinct and unknown", () => {
  assert.deepEqual(USAGE_RESET_SEMANTICS.map(({ id }) => id), ["automatic-window", "banked", "global-promotional", "purchased-instant", "credits"]);
  assert.match(USAGE_RESET_SEMANTICS.find(({ id }) => id === "banked")?.field ?? "", /expiresAt/);
  assert.match(USAGE_RESET_SEMANTICS.find(({ id }) => id === "global-promotional")?.field ?? "", /not exposed/);
  assert.match(USAGE_RESET_SEMANTICS.find(({ id }) => id === "purchased-instant")?.field ?? "", /not exposed/);
  assert.match(USAGE_RESET_SEMANTICS.find(({ id }) => id === "credits")?.observation ?? "", /never derived/);
  assert.ok(TELEMETRY_BOUNDARIES.every(({ state }) => state === "unknown" || state === "unavailable"));
  assert.ok(OTHER_REVIEWED_SURFACES.some(({ title }) => title === "dots"));
  assert.ok(OTHER_REVIEWED_SURFACES.some(({ title }) => title === "ChatGPT Space"));
});
