import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PDF_OPTIONS,
  PDF_COLOR_PRESETS,
  PDF_TEMPLATE_OPTIONS,
  normalizePdfOptions
} from "../dist/shared/pdf-options.js";
import {
  applyPdfBubbleStyle,
  resolvePdfAppearanceMode,
  resolvePdfPalette
} from "../dist/shared/pdf-appearance.js";

test("uses the branded reference chat layout as the default PDF template", () => {
  assert.deepEqual(DEFAULT_PDF_OPTIONS, {
    template: "reference",
    textSize: "standard",
    spacing: "comfortable",
    themeMode: "light",
    bubbleStyle: "brand",
    speakerColors: "template",
    colorPreset: "light",
    customColors: {
      page: "#FFFFFF",
      text: "#161616",
      userBubble: "#FFFFFF",
      userText: "#161616",
      userAccent: "#303030",
      assistantAccent: "#4B5563",
      assistantSurface: "#F1F4F6",
      rule: "#5D6673"
    },
    tableStyle: "soft",
    codeStyle: "panel"
  });
});

test("labels V5 as the classic archive style", () => {
  assert.equal(
    PDF_TEMPLATE_OPTIONS.find((option) => option.value === "terminal-ledger")?.label,
    "V5 · Classic Archive"
  );
});

test("normalizes persisted PDF preferences without accepting unknown values", () => {
  assert.deepEqual(
    normalizePdfOptions({
      template: "soft-cards",
      textSize: "large",
      spacing: "compact",
      themeMode: "dark",
      bubbleStyle: "white-black",
      speakerColors: "high-contrast",
      colorPreset: "purple",
      customColors: {
        page: "#ffffff",
        text: "#620800",
        userBubble: "#ff98d0",
        userText: "#125603",
        userAccent: "#7523b3",
        assistantAccent: "#0e5072",
        assistantSurface: "#fcc6c6",
        rule: "#906813"
      },
      tableStyle: "accent",
      codeStyle: "plain",
      ignored: "value"
    }),
    {
      template: "soft-cards",
      textSize: "large",
      spacing: "compact",
      themeMode: "dark",
      bubbleStyle: "white-black",
      speakerColors: "high-contrast",
      colorPreset: "purple",
      customColors: {
        page: "#FFFFFF",
        text: "#620800",
        userBubble: "#FF98D0",
        userText: "#125603",
        userAccent: "#7523B3",
        assistantAccent: "#0E5072",
        assistantSurface: "#FCC6C6",
        rule: "#906813"
      },
      tableStyle: "accent",
      codeStyle: "plain"
    }
  );
});

test("falls back per custom color when a saved value is invalid", () => {
  const normalized = normalizePdfOptions({
    speakerColors: "custom",
    customColors: { page: "not-a-color", text: "#123456" }
  });

  assert.equal(normalized.speakerColors, "custom");
  assert.equal(normalized.customColors.page, "#FFFFFF");
  assert.equal(normalized.customColors.text, "#123456");
  assert.equal(normalized.customColors.userBubble, "#FFFFFF");
});

test("uses the selected preset when saved colors are not present", () => {
  const normalized = normalizePdfOptions({ colorPreset: "purple" });

  assert.equal(normalized.colorPreset, "purple");
  assert.equal(normalized.customColors.page, "#F7F2FF");
  assert.equal(normalized.customColors.userBubble, "#EDE3FF");
});

test("exposes readable color-family presets with light and dark role maps", () => {
  for (const family of ["blue", "green", "purple", "warm", "black", "light"]) {
    assert.ok(PDF_COLOR_PRESETS[family].light.page.startsWith("#"));
    assert.ok(PDF_COLOR_PRESETS[family].dark.page.startsWith("#"));
    assert.ok(PDF_COLOR_PRESETS[family].light.text.startsWith("#"));
    assert.ok(PDF_COLOR_PRESETS[family].dark.text.startsWith("#"));
  }
});

test("keeps Black dark and Light white regardless of appearance mode", () => {
  for (const themeMode of ["light", "dark"]) {
    const black = resolvePdfPalette(normalizePdfOptions({ colorPreset: "black", themeMode }));
    const light = resolvePdfPalette(normalizePdfOptions({ colorPreset: "light", themeMode }));

    assert.equal(black.page, "#000000");
    assert.equal(black.text, "#F7F7F7");
    assert.equal(light.page, "#FFFFFF");
    assert.equal(light.text, "#161616");
  }
});

test("resolves family colors for light/dark modes and custom overrides", () => {
  const light = normalizePdfOptions({ colorPreset: "blue", themeMode: "light" });
  const dark = normalizePdfOptions({ colorPreset: "blue", themeMode: "dark" });
  const custom = normalizePdfOptions({
    colorPreset: "custom",
    speakerColors: "custom",
    customColors: { page: "#123456", text: "#FFFFFF" }
  });

  assert.equal(resolvePdfAppearanceMode(light), "light");
  assert.equal(resolvePdfAppearanceMode(dark), "dark");
  assert.equal(resolvePdfPalette(light).page, "#F7F9FA");
  assert.equal(resolvePdfPalette(dark).page, "#0F191C");
  assert.equal(resolvePdfPalette(custom).page, "#123456");
  assert.equal(applyPdfBubbleStyle(resolvePdfPalette(light), "black-white", "light").userText, "#FFFFFF");
});
