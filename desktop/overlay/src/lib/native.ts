import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { load } from "@tauri-apps/plugin-store";
import type { OverlaySnapshot } from "../../../../src/lib/overlay/contracts";
import type { DesktopOverlaySettings, OverlayCorner, OverlayEffect, OverlayLayout } from "./settings";

const STORE_FILE = "overlay-settings.json";
const STORE_KEY = "settings";

export interface NativeState {
  clickThrough: boolean;
  lockPosition: boolean;
  alwaysOnTop: boolean;
  shortcutsReady: boolean;
  shortcutError?: string;
  effectiveEffect: OverlayEffect;
  followChatgpt: boolean;
  chatgptRunning: boolean;
}

export type NativeAction =
  | { kind: "layout"; value: OverlayLayout }
  | { kind: "show-settings" }
  | { kind: "click-through"; value: boolean }
  | { kind: "lock-position"; value: boolean }
  | { kind: "always-on-top"; value: boolean }
  | { kind: "chatgpt-running"; value: boolean };

export async function loadSettings(): Promise<unknown> {
  const store = await load(STORE_FILE, { autoSave: 150 });
  return store.get(STORE_KEY);
}

export async function saveSettings(settings: DesktopOverlaySettings) {
  const store = await load(STORE_FILE, { autoSave: 150 });
  await store.set(STORE_KEY, settings);
  await store.save();
}

export function fetchOverlay(range: DesktopOverlaySettings["range"]) {
  return invoke<OverlaySnapshot>("fetch_overlay", { range });
}

export function getNativeState() {
  return invoke<NativeState>("get_native_state");
}

export function applyWindowSettings(settings: DesktopOverlaySettings) {
  return invoke<NativeState>("apply_window_settings", { settings: {
    effect: settings.effect,
    lockPosition: settings.lockPosition,
    alwaysOnTop: settings.alwaysOnTop,
    showInTaskbar: settings.showInTaskbar,
    clickThrough: settings.clickThrough,
    edgeSnapping: settings.edgeSnapping,
    followChatgpt: settings.followChatgpt,
  } });
}

export function setLayout(layout: OverlayLayout) { return invoke<void>("set_layout", { layout }); }
export function setCorner(corner: OverlayCorner) { return invoke<void>("set_corner", { corner }); }
export function startDrag(edgeSnapping: boolean) { return invoke<void>("start_drag", { edgeSnapping }); }
export function toggleVisibility() { return invoke<void>("toggle_visibility"); }
export function hideOverlay() { return invoke<void>("hide_overlay"); }
export function quitOverlay() { return invoke<void>("quit_overlay"); }
export function configureHotkeys(showHide: string, clickThrough: string) { return invoke<NativeState>("configure_hotkeys", { showHide, clickThrough }); }
export function onNativeAction(handler: (action: NativeAction) => void) { return listen<NativeAction>("native-action", (event) => handler(event.payload)); }
export function openDashboard() { return invoke<void>("open_dashboard"); }
export async function setAutostart(enabled: boolean) { if (enabled) await enable(); else await disable(); }
export function getAutostart() { return isEnabled(); }
