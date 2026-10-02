import assert from "node:assert/strict";
import test from "node:test";
import { createGptPdfOptions } from "../dist/shared/pdf-options.js";
import { resolvePdfPalette } from "../dist/shared/pdf-appearance.js";

for (const mode of ["light", "dark"]) {
  test(`ChatGPT layout uses familiar ${mode} surfaces without an alternate template`, () => {
    const options = createGptPdfOptions(mode);
    assert.equal(options.template, "reference");
    assert.equal(options.themeMode, mode);
    const colors = resolvePdfPalette(options);
    assert.equal(colors.page, mode === "dark" ? "#0D0D0D" : "#FFFFFF");
    assert.equal(colors.text, mode === "dark" ? "#ECECEC" : "#0D0D0D");
    assert.equal(colors.userBubble, mode === "dark" ? "#2F2F2F" : "#F4F4F4");
    assert.equal(colors.assistantSurface, colors.page);
    // Each call owns its colors; preference edits cannot alter the next export.
    options.customColors.page = "#FF0000";
    assert.notEqual(createGptPdfOptions(mode).customColors.page, "#FF0000");
  });
}
