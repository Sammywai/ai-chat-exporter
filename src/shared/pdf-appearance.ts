import {
  PDF_COLOR_PRESETS,
  type NormalizedPdfOptions,
  type PdfCustomColors,
  type PdfThemeMode
} from "./pdf-options.js";

export type PdfAppearanceMode = Exclude<PdfThemeMode, "system">;

export function resolvePdfAppearanceMode(
  options: Pick<NormalizedPdfOptions, "themeMode">,
  systemDark = false
): PdfAppearanceMode {
  if (options.themeMode === "dark") {
    return "dark";
  }
  if (options.themeMode === "light") {
    return "light";
  }
  return systemDark ? "dark" : "light";
}

export function resolvePdfPalette(
  options: Pick<NormalizedPdfOptions, "colorPreset" | "customColors" | "speakerColors" | "themeMode">,
  systemDark = false
): PdfCustomColors {
  if (options.speakerColors === "custom" || options.colorPreset === "custom") {
    return { ...options.customColors };
  }

  const mode = resolvePdfAppearanceMode(options, systemDark);
  return { ...PDF_COLOR_PRESETS[options.colorPreset][mode] };
}

export function applyPdfBubbleStyle<T extends Pick<PdfCustomColors, "userBubble" | "userText">>(
  colors: T,
  style: NormalizedPdfOptions["bubbleStyle"],
  mode: PdfAppearanceMode
): T {
  if (style === "brand") {
    return { ...colors };
  }
  if (style === "black-white") {
    return { ...colors, userBubble: "#000000", userText: "#FFFFFF" };
  }
  if (style === "white-black") {
    return { ...colors, userBubble: "#FFFFFF", userText: "#000000" };
  }
  return mode === "dark"
    ? { ...colors, userBubble: "#FFFFFF", userText: "#000000" }
    : { ...colors, userBubble: "#000000", userText: "#FFFFFF" };
}
