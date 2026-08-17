import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../static/popup/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../static/popup/styles.css", import.meta.url), "utf8");
const popup = await readFile(new URL("../src/popup/popup.ts", import.meta.url), "utf8");

test("provides a full-page visual PDF editor without splitting the appearance contract", () => {
  assert.match(html, /id="pdf-workspace"/);
  assert.match(html, /data-live-surface="pdf-template"/);
  assert.match(html, /id="pdf-settings"/);
  assert.match(html, /id="preview-document"/);
  assert.match(html, /id="reset-options"/);
  assert.doesNotMatch(html, /id="(?:theme-mode|bubble-style|speaker-colors|table-style|code-style)"/);
  assert.match(css, /\.editor-mode \.pdf-workspace\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /aspect-ratio:\s*595\.28\s*\/\s*841\.89/);
  assert.match(popup, /normalizePdfOptions/);
  assert.match(popup, /renderPdf\(previewConversation, readOptions\(\)\)/);
  assert.match(popup, /previewConversation = createConversationPreview\(response\.conversation\)/);
  assert.match(popup, /function schedulePdfPreview[\s\S]*const requestId = \+\+previewRequestId[\s\S]*renderSamplePreview\(requestId\)/);
  assert.match(popup, /async function renderSamplePreview\(requestId: number\)/);
  assert.match(html, /Sample appearance · page 1 only/);
  assert.doesNotMatch(html, /exact PDF output|Exact PDF output preview/);
  assert.match(popup, /themeMode:\s*"light"/);
  assert.match(popup, /bubbleStyle:\s*"brand"/);
  assert.match(popup, /tableStyle:\s*"soft"/);
  assert.match(popup, /codeStyle:\s*"panel"/);
  assert.match(popup, /searchParams\.set\("mode", "editor"\)/);
  assert.match(popup, /chrome\.tabs\.create\(\{ url: editorUrl\.href \}\)/);
});

test("keeps popup and editor layouts responsive", () => {
  assert.match(css, /body\s*\{[^}]*min-width:\s*380px/s);
  assert.match(css, /body\.editor-mode\s*\{[^}]*height:\s*100vh/s);
  assert.match(css, /@media \(max-width:\s*420px\)/);
});

test("exposes conversation readiness, Markdown, retry, and guarded preference states", () => {
  for (const id of [
    "conversation-state",
    "conversation-title",
    "conversation-meta",
    "retry-conversation",
    "markdown-workspace",
    "retry-preview"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(popup, /type:\s*"inspect-current-conversation"/);
  assert.match(popup, /response\.messageCount/);
  assert.match(popup, /sourceTabId/);
  assert.match(popup, /markdownWorkspace!\.hidden = pdfVisible/);
  assert.match(popup, /localStorage\.setItem[\s\S]*catch/);
  assert.match(css, /\.conversation-state\[data-state="ready"\]/);
  assert.match(css, /\.preview-loading\[data-state="error"\]/);
});

test("ships the AI Chat Exporter interaction and accessibility contract", () => {
  assert.match(html, /<strong>AI Chat Exporter<\/strong>/);
  assert.match(html, /<span>On-device<\/span>/);
  assert.match(html, /id="format-modes"[^>]*role="group"[^>]*aria-labelledby="format-label"/);
  assert.match(html, /class="format-mode"[^>]*data-format="pdf"[^>]*aria-pressed="true"/);
  assert.match(html, /class="format-mode"[^>]*data-format="markdown"[^>]*aria-pressed="false"/);
  assert.match(html, /class="local-assurance"/);
  assert.match(html, /id="save-state"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /class="job-ticket"/);
  assert.match(html, /id="ticket-format"/);
  assert.match(css, /--registration:\s*#0067c9/);
  assert.match(css, /\.format-mode\[aria-pressed="true"\]/);
  assert.match(css, /\.editor-mode \.settings-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(popup, /ticketFormat!\.textContent = pdfVisible \? "PDF" : "MARKDOWN"/);
  assert.match(popup, /mode\.setAttribute\("aria-pressed"/);
});
