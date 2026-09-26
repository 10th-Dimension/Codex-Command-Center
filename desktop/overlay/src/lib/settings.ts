export const overlayLayouts = ["mini", "standard", "expanded", "strip"] as const;
export const overlayRanges = ["24h", "7d", "30d"] as const;

export type OverlayLayout = typeof overlayLayouts[number];
export type OverlayRange = typeof overlayRanges[number];
export type OverlayDensity = "tight" | "comfortable";
export type OverlayEffect = "translucent" | "mica" | "acrylic" | "solid";
export type OverlaySurface = "dark" | "light";
export type OverlayTextColor = "auto" | "white" | "black" | "red" | "amber" | "cyan" | "custom";
export type OverlayCorner = "free" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface DesktopOverlaySettings {
  layout: OverlayLayout;
  range: OverlayRange;
  effect: OverlayEffect;
  surface: OverlaySurface;
  opacity: number;
  textColor: OverlayTextColor;
  customTextColor: string;
  accentColor: string;
  chartLineColor: string;
  fontScale: number;
  density: OverlayDensity;
  corner: OverlayCorner;
  edgeSnapping: boolean;
  lockPosition: boolean;
  alwaysOnTop: boolean;
  showInTaskbar: boolean;
  clickThrough: boolean;
  refreshSeconds: number;
  startWithWindows: boolean;
  followChatgpt: boolean;
  showHideHotkey: string;
  clickThroughHotkey: string;
}

export const defaultDesktopOverlaySettings: DesktopOverlaySettings = {
  layout: "standard",
  range: "24h",
  effect: "translucent",
  surface: "dark",
  opacity: 86,
  textColor: "auto",
  customTextColor: "#f2f8fa",
  accentColor: "#66d9e8",
  chartLineColor: "#66d9e8",
  fontScale: 100,
  density: "tight",
  corner: "free",
  edgeSnapping: true,
  lockPosition: false,
  alwaysOnTop: true,
  showInTaskbar: false,
  clickThrough: false,
  refreshSeconds: 10,
  startWithWindows: false,
  followChatgpt: true,
  showHideHotkey: "Ctrl+Shift+Space",
  clickThroughHotkey: "Ctrl+Shift+O",
};

export function isSafeHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function bounded(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

export function isSafeHotkey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 64 && /^[A-Za-z0-9+_-]+$/.test(value) && value.includes("+");
}

export function parseDesktopOverlaySettings(value: unknown): DesktopOverlaySettings {
  const input = value && typeof value === "object" ? value as Partial<DesktopOverlaySettings> : {};
  return {
    layout: choice(input.layout, overlayLayouts, defaultDesktopOverlaySettings.layout),
    range: choice(input.range, overlayRanges, defaultDesktopOverlaySettings.range),
    effect: choice(input.effect, ["translucent", "mica", "acrylic", "solid"] as const, defaultDesktopOverlaySettings.effect),
    surface: choice(input.surface, ["dark", "light"] as const, defaultDesktopOverlaySettings.surface),
    opacity: bounded(input.opacity, 0, 100, defaultDesktopOverlaySettings.opacity),
    textColor: choice(input.textColor, ["auto", "white", "black", "red", "amber", "cyan", "custom"] as const, defaultDesktopOverlaySettings.textColor),
    customTextColor: isSafeHexColor(input.customTextColor) ? input.customTextColor : defaultDesktopOverlaySettings.customTextColor,
    accentColor: isSafeHexColor(input.accentColor) ? input.accentColor : defaultDesktopOverlaySettings.accentColor,
    chartLineColor: isSafeHexColor(input.chartLineColor) ? input.chartLineColor : defaultDesktopOverlaySettings.chartLineColor,
    fontScale: bounded(input.fontScale, 80, 150, defaultDesktopOverlaySettings.fontScale),
    density: choice(input.density, ["tight", "comfortable"] as const, defaultDesktopOverlaySettings.density),
    corner: choice(input.corner, ["free", "top-left", "top-right", "bottom-left", "bottom-right"] as const, defaultDesktopOverlaySettings.corner),
    edgeSnapping: Boolean(input.edgeSnapping ?? defaultDesktopOverlaySettings.edgeSnapping),
    lockPosition: Boolean(input.lockPosition ?? defaultDesktopOverlaySettings.lockPosition),
    alwaysOnTop: Boolean(input.alwaysOnTop ?? defaultDesktopOverlaySettings.alwaysOnTop),
    showInTaskbar: Boolean(input.showInTaskbar ?? defaultDesktopOverlaySettings.showInTaskbar),
    clickThrough: Boolean(input.clickThrough ?? defaultDesktopOverlaySettings.clickThrough),
    refreshSeconds: bounded(input.refreshSeconds, 5, 60, defaultDesktopOverlaySettings.refreshSeconds),
    startWithWindows: Boolean(input.startWithWindows ?? defaultDesktopOverlaySettings.startWithWindows),
    followChatgpt: Boolean(input.followChatgpt ?? defaultDesktopOverlaySettings.followChatgpt),
    showHideHotkey: isSafeHotkey(input.showHideHotkey) ? input.showHideHotkey : defaultDesktopOverlaySettings.showHideHotkey,
    clickThroughHotkey: isSafeHotkey(input.clickThroughHotkey) ? input.clickThroughHotkey : defaultDesktopOverlaySettings.clickThroughHotkey,
  };
}

export function shouldPollRemote(followChatgpt: boolean, chatgptRunning: boolean, overlayVisible: boolean) {
  return overlayVisible && (!followChatgpt || chatgptRunning);
}

// Window-state restoration can retain undersized geometry from an older DPI-scaled
// build. Repair only those cases; manual resizing never changes the chosen layout.
export function needsPresetResize(width: number, height: number, layout: OverlayLayout): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  switch (layout) {
    case "strip": return width < 280 || height < 90;
    case "mini": return width < 280 || height < 125;
    case "standard": return width < 390 || height < 250;
    case "expanded": return width < 390 || height < 390;
  }
}

export function textColorValue(settings: DesktopOverlaySettings) {
  if (settings.textColor === "custom") return settings.customTextColor;
  if (settings.textColor === "auto") return settings.surface === "light" ? "#10191d" : "#f5fafb";
  return { white: "#ffffff", black: "#080b0d", red: "#ff6875", amber: "#ffc35b", cyan: "#79e4ef" }[settings.textColor];
}
