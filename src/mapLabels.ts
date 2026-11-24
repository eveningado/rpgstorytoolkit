// Shared look of world-map markers and text labels, used by the editor (WorldMap.tsx)
// and the read-only public wiki map (WorldMapWiki.tsx). Pure, no app imports.
import type { MapTextSize } from "./types";

// Marker icons a pin can show (key stored on the pin). Plain Unicode symbols, not emoji, so they look the same
// on every OS and take the pin colour.
export const MAP_PIN_ICONS: { key: string; glyph: string }[] = [
  { key: "dot", glyph: "●" },
  { key: "settlement", glyph: "⌂" },
  { key: "castle", glyph: "♜" },
  { key: "landmark", glyph: "★" },
  { key: "flag", glyph: "⚑" },
  { key: "mountain", glyph: "▲" },
  { key: "camp", glyph: "△" },
  { key: "port", glyph: "⚓" },
  { key: "battle", glyph: "⚔" },
  { key: "temple", glyph: "✚" },
  { key: "treasure", glyph: "◆" },
  { key: "danger", glyph: "☠" },
  { key: "quest", glyph: "!" },
  { key: "mystery", glyph: "?" },
  { key: "nature", glyph: "✿" },
  { key: "wonder", glyph: "☼" },
];
export const pinGlyph = (icon?: string) => MAP_PIN_ICONS.find((i) => i.key === icon)?.glyph ?? "";

// Text label sizes, as a fraction of the map image's width (so text scales with the map).
export const MAP_TEXT_SIZES: MapTextSize[] = ["s", "m", "l", "xl"];
const TEXT_SIZE_FRACTION: Record<MapTextSize, number> = { s: 0.012, m: 0.02, l: 0.032, xl: 0.05 };
export const mapTextFontPx = (size: MapTextSize | undefined, imageWidthPx: number) =>
  (TEXT_SIZE_FRACTION[size ?? "m"] ?? TEXT_SIZE_FRACTION.m) * imageWidthPx;

export const MAP_TEXT_COLORS = ["#ffffff", "#f3e6c4", "#2b2118", "#1e3a5f", "#7a1f1f", "#f5a524", "#30a46c", "#4f8cff"];
export const MAP_TEXT_DEFAULT_COLOR = "#ffffff";
export const MAP_TEXT_FONT = "Georgia, 'Times New Roman', serif";

// A halo in the opposite tone keeps a label readable on any part of the map.
export const isLightColor = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
};
export const mapTextHalo = (color: string) => (isLightColor(color) ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.85)");
