export type OverlayLayout = "compact" | "expanded" | "strip";
export type OverlayDensity = "compact" | "comfortable";
export type OverlayVisualStyle = "mica" | "translucent" | "acrylic" | "solid";
export type OverlayTextColor = "auto" | "white" | "black" | "red" | "amber" | "cyan" | "custom";
export interface OverlaySettings { backgroundOpacity: number; textColor: OverlayTextColor; customTextColor: string; accentColor: string; fontScale: number; density: OverlayDensity; layout: OverlayLayout; visualStyle: OverlayVisualStyle; }
export const defaultOverlaySettings: OverlaySettings = { backgroundOpacity: 86, textColor: "auto", customTextColor: "#e8f7fa", accentColor: "#64d8e8", fontScale: 100, density: "compact", layout: "expanded", visualStyle: "translucent" };
export function isSafeHexColor(value: unknown): value is string { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value); }
function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback; }
export function parseOverlaySettings(value: unknown): OverlaySettings {
  const input = value && typeof value === "object" ? value as Partial<OverlaySettings> : {};
  return {
    backgroundOpacity: boundedNumber(input.backgroundOpacity, 20, 100, defaultOverlaySettings.backgroundOpacity),
    textColor: choice(input.textColor, ["auto", "white", "black", "red", "amber", "cyan", "custom"] as const, defaultOverlaySettings.textColor),
    customTextColor: isSafeHexColor(input.customTextColor) ? input.customTextColor : defaultOverlaySettings.customTextColor,
    accentColor: isSafeHexColor(input.accentColor) ? input.accentColor : defaultOverlaySettings.accentColor,
    fontScale: boundedNumber(input.fontScale, 80, 150, defaultOverlaySettings.fontScale),
    density: choice(input.density, ["compact", "comfortable"] as const, defaultOverlaySettings.density),
    layout: choice(input.layout, ["compact", "expanded", "strip"] as const, defaultOverlaySettings.layout),
    visualStyle: choice(input.visualStyle, ["mica", "translucent", "acrylic", "solid"] as const, defaultOverlaySettings.visualStyle),
  };
}
export function resolveOverlayLayout(width: number, height: number, preferred: OverlayLayout): OverlayLayout {
  if (height <= 150 && width >= 480) return "strip";
  if (width < 390 || height < 350) return "compact";
  return preferred;
}
