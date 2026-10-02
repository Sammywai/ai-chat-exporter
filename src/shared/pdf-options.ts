/** The public UI uses one transcript layout with two familiar appearances. */
export function createGptPdfOptions(mode: "light" | "dark"): NormalizedPdfOptions {
  const dark = mode === "dark";
  return normalizePdfOptions({
    template: "reference", themeMode: mode, bubbleStyle: "brand",
    speakerColors: "custom", colorPreset: "custom", textSize: "standard",
    spacing: "comfortable", tableStyle: "rules", codeStyle: "panel",
    customColors: {
      page: dark ? "#0D0D0D" : "#FFFFFF",
      text: dark ? "#ECECEC" : "#0D0D0D",
      userBubble: dark ? "#2F2F2F" : "#F4F4F4",
      userText: dark ? "#ECECEC" : "#0D0D0D",
      userAccent: dark ? "#ECECEC" : "#0D0D0D",
      assistantAccent: dark ? "#ECECEC" : "#0D0D0D",
      assistantSurface: dark ? "#0D0D0D" : "#FFFFFF",
      rule: dark ? "#424242" : "#D9D9D9"
    }
  });
}

export const PDF_TEMPLATE_OPTIONS = [
  { value: "reference", label: "GPT-style chat", description: "Light brand-led transcript with rounded user bubbles", bestFor: "Everyday chat" },
  { value: "quiet-paper", label: "V1 · Quiet Paper", description: "Calm transcript for everyday reading and printing", bestFor: "Print-friendly reading" },
  { value: "editorial-ledger", label: "V2 · Editorial Ledger", description: "Warm, book-like hierarchy for notes and research", bestFor: "Notes and research" },
  { value: "midnight-index", label: "V3 · Midnight Index", description: "Dark, high-contrast layout for screen reading", bestFor: "Dark-mode reading" },
  { value: "soft-cards", label: "V4 · Soft Cards", description: "Friendly panels for quick visual scanning", bestFor: "Fast visual scanning" },
  { value: "terminal-ledger", label: "V5 · Classic Archive", description: "Airy bubble-free transcript for long-form reading", bestFor: "Long-form reading" }
] as const;

export const PDF_TEXT_SIZE_OPTIONS = [
  { value: "small", label: "Small", sample: "Aa 12", description: "Compact archive density" },
  { value: "standard", label: "Standard", sample: "Aa 14", description: "Balanced everyday reading" },
  { value: "large", label: "Large", sample: "Aa 17", description: "More comfortable at a distance" }
] as const;

export const PDF_SPACING_OPTIONS = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" }
] as const;

export const PDF_THEME_MODE_OPTIONS = [
  { value: "system", label: "System", description: "Follow the device appearance when available" },
  { value: "light", label: "Light", description: "White page with a distinct user bubble" },
  { value: "dark", label: "Dark", description: "Dark page with a light user bubble" }
] as const;

export const PDF_BUBBLE_STYLE_OPTIONS = [
  { value: "mode", label: "Match theme", description: "Black/white in light mode, white/black in dark mode" },
  { value: "black-white", label: "Black bubble · white text" },
  { value: "white-black", label: "White bubble · black text" },
  { value: "brand", label: "Brand bubble" }
] as const;

export const PDF_SPEAKER_COLOR_OPTIONS = [
  { value: "template", label: "Family preset" },
  { value: "high-contrast", label: "High contrast" },
  { value: "mono", label: "Monochrome" },
  { value: "custom", label: "Custom palette" }
] as const;

export const PDF_COLOR_PRESET_OPTIONS = [
  { value: "blue", label: "Blue", description: "Calm, high-contrast everyday reading" },
  { value: "green", label: "Green", description: "Quiet, grounded reading with clear roles" },
  { value: "purple", label: "Purple", description: "Expressive surfaces with deep violet text" },
  { value: "warm", label: "Warm", description: "Editorial brown and cream for long reading" },
  { value: "black", label: "Black", description: "Black page with light text" },
  { value: "light", label: "Light", description: "White page with dark text" },
  { value: "custom", label: "Custom palette", description: "Keep the individual colors you choose below" }
] as const;

export const PDF_TABLE_STYLE_OPTIONS = [
  { value: "soft", label: "Soft rows" },
  { value: "rules", label: "Rules only" },
  { value: "accent", label: "Accent header" }
] as const;

export const PDF_CODE_STYLE_OPTIONS = [
  { value: "panel", label: "Shaded panel" },
  { value: "plain", label: "Plain text" }
] as const;

export type PdfTemplateId = (typeof PDF_TEMPLATE_OPTIONS)[number]["value"];
export type PdfTextSize = (typeof PDF_TEXT_SIZE_OPTIONS)[number]["value"];
export type PdfSpacing = (typeof PDF_SPACING_OPTIONS)[number]["value"];
export type PdfThemeMode = (typeof PDF_THEME_MODE_OPTIONS)[number]["value"];
export type PdfBubbleStyle = (typeof PDF_BUBBLE_STYLE_OPTIONS)[number]["value"];
export type PdfSpeakerColors = (typeof PDF_SPEAKER_COLOR_OPTIONS)[number]["value"];
export type PdfColorPreset = (typeof PDF_COLOR_PRESET_OPTIONS)[number]["value"];
export type PdfTableStyle = (typeof PDF_TABLE_STYLE_OPTIONS)[number]["value"];
export type PdfCodeStyle = (typeof PDF_CODE_STYLE_OPTIONS)[number]["value"];

export interface PdfCustomColors {
  page: string;
  text: string;
  userBubble: string;
  userText: string;
  userAccent: string;
  assistantAccent: string;
  assistantSurface: string;
  rule: string;
}

export interface PdfColorPalette {
  light: PdfCustomColors;
  dark: PdfCustomColors;
}

export const PDF_COLOR_PRESETS: Record<Exclude<PdfColorPreset, "custom">, PdfColorPalette> = {
  blue: {
    light: {
      page: "#F7F9FA",
      text: "#162E51",
      userBubble: "#D9E8F6",
      userText: "#162E51",
      userAccent: "#005EA2",
      assistantAccent: "#1A4480",
      assistantSurface: "#E7F2F5",
      rule: "#2E6276"
    },
    dark: {
      page: "#0F191C",
      text: "#F7F9FA",
      userBubble: "#002D3F",
      userText: "#F7F9FA",
      userAccent: "#97D4EA",
      assistantAccent: "#A1D3FF",
      assistantSurface: "#14333D",
      rule: "#97D4EA"
    }
  },
  green: {
    light: {
      page: "#ECF3EC",
      text: "#193324",
      userBubble: "#DBEBDE",
      userText: "#193324",
      userAccent: "#216E1F",
      assistantAccent: "#154C21",
      assistantSurface: "#E3F5E1",
      rule: "#37493B"
    },
    dark: {
      page: "#1A1F1A",
      text: "#F7F9FA",
      userBubble: "#0D351E",
      userText: "#F7F9FA",
      userAccent: "#83FCD4",
      assistantAccent: "#B7F5BD",
      assistantSurface: "#193324",
      rule: "#70E17B"
    }
  },
  purple: {
    light: {
      page: "#F7F2FF",
      text: "#312B3F",
      userBubble: "#EDE3FF",
      userText: "#39215E",
      userAccent: "#54278F",
      assistantAccent: "#5942D2",
      assistantSurface: "#F4F1F9",
      rule: "#665190"
    },
    dark: {
      page: "#18161D",
      text: "#F7F2FF",
      userBubble: "#39215E",
      userText: "#F7F2FF",
      userAccent: "#D5BFFF",
      assistantAccent: "#CFC4FD",
      assistantSurface: "#2E2C40",
      rule: "#D5BFFF"
    }
  },
  warm: {
    light: {
      page: "#F6EFE9",
      text: "#322D26",
      userBubble: "#FEF0C8",
      userText: "#3B2B15",
      userAccent: "#7A591A",
      assistantAccent: "#805039",
      assistantSurface: "#FAEEE5",
      rule: "#914734"
    },
    dark: {
      page: "#332D27",
      text: "#FEF0C8",
      userBubble: "#5C410A",
      userText: "#FEF0C8",
      userAccent: "#FFE396",
      assistantAccent: "#F4E3DB",
      assistantSurface: "#4D4438",
      rule: "#F6BD9C"
    }
  },
  black: {
    light: {
      page: "#000000",
      text: "#F7F7F7",
      userBubble: "#1C1C1C",
      userText: "#FFFFFF",
      userAccent: "#FFFFFF",
      assistantAccent: "#D0D7DE",
      assistantSurface: "#121212",
      rule: "#AAB4BF"
    },
    dark: {
      page: "#000000",
      text: "#F7F7F7",
      userBubble: "#1C1C1C",
      userText: "#FFFFFF",
      userAccent: "#FFFFFF",
      assistantAccent: "#D0D7DE",
      assistantSurface: "#121212",
      rule: "#AAB4BF"
    }
  },
  light: {
    light: {
      page: "#FFFFFF",
      text: "#161616",
      userBubble: "#FFFFFF",
      userText: "#161616",
      userAccent: "#303030",
      assistantAccent: "#4B5563",
      assistantSurface: "#F1F4F6",
      rule: "#5D6673"
    },
    dark: {
      page: "#FFFFFF",
      text: "#161616",
      userBubble: "#FFFFFF",
      userText: "#161616",
      userAccent: "#303030",
      assistantAccent: "#4B5563",
      assistantSurface: "#F1F4F6",
      rule: "#5D6673"
    }
  }
};

export const DEFAULT_CUSTOM_COLORS: PdfCustomColors = {
  ...PDF_COLOR_PRESETS.light.light
};

export interface PdfOptions {
  template?: PdfTemplateId;
  textSize?: PdfTextSize;
  spacing?: PdfSpacing;
  themeMode?: PdfThemeMode;
  bubbleStyle?: PdfBubbleStyle;
  speakerColors?: PdfSpeakerColors;
  colorPreset?: PdfColorPreset;
  customColors?: Partial<PdfCustomColors>;
  tableStyle?: PdfTableStyle;
  codeStyle?: PdfCodeStyle;
}

export interface NormalizedPdfOptions {
  template: PdfTemplateId;
  textSize: PdfTextSize;
  spacing: PdfSpacing;
  themeMode: PdfThemeMode;
  bubbleStyle: PdfBubbleStyle;
  speakerColors: PdfSpeakerColors;
  colorPreset: PdfColorPreset;
  customColors: PdfCustomColors;
  tableStyle: PdfTableStyle;
  codeStyle: PdfCodeStyle;
}

export const DEFAULT_PDF_OPTIONS: NormalizedPdfOptions = {
  template: "reference",
  textSize: "standard",
  spacing: "comfortable",
  themeMode: "light",
  bubbleStyle: "brand",
  speakerColors: "template",
  colorPreset: "light",
  customColors: DEFAULT_CUSTOM_COLORS,
  tableStyle: "soft",
  codeStyle: "panel"
};

const templateValues = new Set<string>(PDF_TEMPLATE_OPTIONS.map((option) => option.value));
const textSizeValues = new Set<string>(PDF_TEXT_SIZE_OPTIONS.map((option) => option.value));
const spacingValues = new Set<string>(PDF_SPACING_OPTIONS.map((option) => option.value));
const themeModeValues = new Set<string>(PDF_THEME_MODE_OPTIONS.map((option) => option.value));
const bubbleStyleValues = new Set<string>(PDF_BUBBLE_STYLE_OPTIONS.map((option) => option.value));
const speakerColorValues = new Set<string>(PDF_SPEAKER_COLOR_OPTIONS.map((option) => option.value));
const colorPresetValues = new Set<string>(PDF_COLOR_PRESET_OPTIONS.map((option) => option.value));
const tableStyleValues = new Set<string>(PDF_TABLE_STYLE_OPTIONS.map((option) => option.value));
const codeStyleValues = new Set<string>(PDF_CODE_STYLE_OPTIONS.map((option) => option.value));

const hexColorPattern = /^#[0-9a-f]{6}$/i;

export function normalizePdfOptions(value: unknown): NormalizedPdfOptions {
  const source = isRecord(value) ? value : {};
  const colorPreset = valueFromSet(
    source.colorPreset,
    colorPresetValues,
    DEFAULT_PDF_OPTIONS.colorPreset
  );

  return {
    template: valueFromSet(source.template, templateValues, DEFAULT_PDF_OPTIONS.template),
    textSize: valueFromSet(source.textSize, textSizeValues, DEFAULT_PDF_OPTIONS.textSize),
    spacing: valueFromSet(source.spacing, spacingValues, DEFAULT_PDF_OPTIONS.spacing),
    themeMode: valueFromSet(source.themeMode, themeModeValues, DEFAULT_PDF_OPTIONS.themeMode),
    bubbleStyle: valueFromSet(source.bubbleStyle, bubbleStyleValues, DEFAULT_PDF_OPTIONS.bubbleStyle),
    speakerColors: valueFromSet(
      source.speakerColors,
      speakerColorValues,
      DEFAULT_PDF_OPTIONS.speakerColors
    ),
    colorPreset,
    customColors: normalizeCustomColors(source.customColors, colorPreset),
    tableStyle: valueFromSet(source.tableStyle, tableStyleValues, DEFAULT_PDF_OPTIONS.tableStyle),
    codeStyle: valueFromSet(source.codeStyle, codeStyleValues, DEFAULT_PDF_OPTIONS.codeStyle)
  } as NormalizedPdfOptions;
}

function normalizeCustomColors(value: unknown, preset: PdfColorPreset): PdfCustomColors {
  const source = isRecord(value) ? value : {};
  const fallback = preset === "custom"
    ? DEFAULT_CUSTOM_COLORS
    : PDF_COLOR_PRESETS[preset].light;
  return {
    page: colorFromValue(source.page, fallback.page),
    text: colorFromValue(source.text, fallback.text),
    userBubble: colorFromValue(source.userBubble, fallback.userBubble),
    userText: colorFromValue(source.userText, fallback.userText),
    userAccent: colorFromValue(source.userAccent, fallback.userAccent),
    assistantAccent: colorFromValue(source.assistantAccent, fallback.assistantAccent),
    assistantSurface: colorFromValue(source.assistantSurface, fallback.assistantSurface),
    rule: colorFromValue(source.rule, fallback.rule)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function valueFromSet<T extends string>(value: unknown, values: Set<string>, fallback: T): T {
  return typeof value === "string" && values.has(value) ? value as T : fallback;
}

function colorFromValue(value: unknown, fallback: string): string {
  return typeof value === "string" && hexColorPattern.test(value) ? value.toUpperCase() : fallback;
}
