import { createGptPdfOptions } from "../shared/pdf-options.js";
import { createConversationPreview, type Conversation } from "../core/conversation.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { ExportSession, inspectTab } from "../core/export-session.js";
import type { ExportFormat } from "../shared/protocol.js";

const query = new URLSearchParams(location.search);
const SETTINGS_KEY = "chat-archive.appearance";
GlobalWorkerOptions.workerSrc = "./pdf.worker.js";
document.body.classList.add("editor-mode");

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing export control: ${id}`);
  return node as T;
}
const form = element<HTMLFormElement>("export-form");
const exportButton = element<HTMLButtonElement>("export-button");
const cancelButton = element<HTMLButtonElement>("cancel-export");
const rescanButton = element<HTMLButtonElement>("retry-conversation");
const status = element("status");
const conversationState = element("conversation-state");
const title = element("conversation-title");
const meta = element("conversation-meta");
const pdfWorkspace = element("pdf-workspace");
const markdownWorkspace = element("markdown-workspace");
const appearance = element("appearance-control");
const canvas = element<HTMLCanvasElement>("preview-document");
const loading = element("preview-loading");
const loadingText = element("preview-loading-text");
const retryPreview = element<HTMLButtonElement>("retry-preview");
const previewSource = element("preview-source");
const previewDetails = element<HTMLDetailsElement>("preview-details");

let format: ExportFormat = query.get("exportFormat") === "markdown" ? "markdown" : "pdf";
let theme: "light" | "dark" = loadTheme();
let activeTabId = parseTabId(query.get("sourceTabId"));
let sourceUrl: string | undefined;
let session: ExportSession | undefined;
let ready = false;
let exporting = false;
let inspecting = false;
let previewTimer: number | undefined;
let previewId = 0;
let stopPreview: (() => void) | undefined;
let previewConversation: Conversation | undefined;

function parseTabId(value: string | null): number | undefined {
  const number = Number(value);
  return value !== null && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}
function loadTheme(): "light" | "dark" {
  const requested = query.get("theme");
  if (requested === "light" || requested === "dark") return requested;
  try { return localStorage.getItem(SETTINGS_KEY) === "light" ? "light" : "dark"; }
  catch { return "dark"; }
}
function showStatus(message: string, error = false): void {
  status.textContent = message;
  status.dataset.state = error ? "error" : "normal";
}
function syncControls(): void {
  document.body.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>(".format-mode").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.format === format));
    button.disabled = exporting;
  });
  document.querySelectorAll<HTMLButtonElement>(".theme-mode").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
    button.disabled = exporting;
  });
  pdfWorkspace.hidden = format !== "pdf";
  markdownWorkspace.hidden = format !== "markdown";
  appearance.hidden = format !== "pdf";
  exportButton.disabled = !ready || exporting || inspecting;
  exportButton.textContent = exporting ? "Exporting…" : `Export ${format === "pdf" ? "PDF" : "Markdown"} ↓`;
  cancelButton.hidden = !exporting;
  rescanButton.disabled = exporting || inspecting;
}

async function refreshConversation(): Promise<void> {
  if (exporting || inspecting) return;
  inspecting = true;
  ready = false;
  session?.clear();
  previewConversation = undefined;
  ++previewId;
  clearTimeout(previewTimer);
  stopPreview?.();
  canvas.width = canvas.height = 0;
  loading.hidden = false;
  loadingText.textContent = "Loading conversation…";
  conversationState.setAttribute("aria-busy", "true");
  title.textContent = "Checking your chat…";
  meta.textContent = "Looking for a supported conversation";
  showStatus("Checking conversation…");
  syncControls();
  try {
    if (activeTabId === undefined) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab?.id;
    }
    if (activeTabId === undefined) throw new Error("Open a supported chat, then click the extension.");
    const tab = await chrome.tabs.get(activeTabId);
    sourceUrl = tab.url;
    const result = await inspectTab(activeTabId);
    if (result.status !== "captured") throw new Error(result.message);
    previewConversation = createConversationPreview(result.conversation);
    previewSource.textContent = "Visible messages";
    title.textContent = result.conversation.title;
    meta.textContent = `${result.conversation.messages.length} visible messages · Full scan on export`;
    session = new ExportSession(activeTabId, (phase, count) => {
      showStatus(`${phase}${count ? ` · ${count} messages captured` : ""}…`);
      // Once Chrome's save dialog opens, cancelling belongs to that dialog.
      cancelButton.hidden = phase === "Choose where to save" || phase === "Saving file";
    });
    ready = true;
    showStatus("Ready to save the whole conversation.");
    schedulePreview();
  } catch (error) {
    title.textContent = "Chat unavailable";
    meta.textContent = "Open ChatGPT, Gemini, or another supported chat";
    showStatus(error instanceof Error ? error.message : "Could not read this chat. Reload it and retry.", true);
  } finally {
    inspecting = false;
    rescanButton.hidden = false;
    conversationState.setAttribute("aria-busy", "false");
    syncControls();
  }
}

async function exportConversation(): Promise<void> {
  if (!ready || exporting || inspecting || !session) return;
  exporting = true;
  syncControls();
  showStatus("Starting export…");
  try {
    if (!session.captured) {
      const tab = await chrome.tabs.get(session.tabId);
      if (tab.url !== sourceUrl) throw new Error("Chat changed. Rescan before exporting.");
    }
    const result = await session.export(format, createGptPdfOptions(theme));
    meta.textContent = `${result.count} messages captured · Ready to save again`;
    showStatus(`Saved ${result.filename}`);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Export failed. Retry or choose Markdown.", true);
  } finally {
    if (session.captured) {
      meta.textContent = `${session.captured.messages.length} messages captured · Ready to save again`;
      previewConversation = createConversationPreview(session.captured);
      previewSource.textContent = "Captured messages";
      schedulePreview();
    }
    exporting = false;
    syncControls();
  }
}

function schedulePreview(): void {
  if (!previewConversation || !previewDetails.open || format !== "pdf") return;
  clearTimeout(previewTimer);
  const id = ++previewId;
  stopPreview?.();
  loading.hidden = false;
  loadingText.textContent = "Preparing preview…";
  retryPreview.hidden = true;
  previewTimer = window.setTimeout(() => { void renderPreview(id); }, 100);
}
async function previewBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const conversation = previewConversation;
  if (!conversation) throw new Error("Chat preview unavailable.");
  return new Promise((resolve, reject) => {
    const worker = new Worker(chrome.runtime.getURL("renderers/pdf-export-worker.js"), { type: "module" });
    const finish = (): void => { clearTimeout(timer); worker.terminate(); stopPreview = undefined; };
    const timer = window.setTimeout(() => { finish(); reject(new Error("Preview timed out.")); }, 90_000);
    stopPreview = () => { finish(); reject(new Error("Preview replaced.")); };
    worker.onmessage = (event: MessageEvent<{ pdf?: ArrayBuffer; error?: string }>) => {
      finish();
      if (event.data.pdf) resolve(new Uint8Array(event.data.pdf));
      else reject(new Error(event.data.error ?? "Preview could not be rendered."));
    };
    worker.onerror = () => { finish(); reject(new Error("Preview unavailable.")); };
    worker.postMessage({ conversation, options: createGptPdfOptions(theme) });
  });
}
async function renderPreview(id: number): Promise<void> {
  let pdf: Awaited<ReturnType<typeof getDocument>["promise"]> | undefined;
  try {
    const bytes = await previewBytes();
    if (id !== previewId) return;
    pdf = await getDocument({ data: bytes, useSystemFonts: true }).promise;
    const page = await pdf.getPage(1);
    if (id !== previewId) return;
    const viewport = page.getViewport({ scale: 1.8 });
    // Render offscreen so an obsolete request cannot paint over the current theme.
    const scratch = document.createElement("canvas");
    scratch.width = Math.ceil(viewport.width);
    scratch.height = Math.ceil(viewport.height);
    await page.render({ canvas: scratch, viewport }).promise;
    if (id !== previewId) return;
    canvas.width = scratch.width;
    canvas.height = scratch.height;
    canvas.getContext("2d")?.drawImage(scratch, 0, 0);
    loading.hidden = true;
  } catch {
    if (id !== previewId) return;
    loadingText.textContent = "Preview unavailable. Export is still available.";
    retryPreview.hidden = false;
  } finally { await pdf?.destroy(); }
}

form.addEventListener("submit", event => { event.preventDefault(); void exportConversation(); });
previewDetails.addEventListener("toggle", () => {
  if (previewDetails.open) schedulePreview();
  else { ++previewId; clearTimeout(previewTimer); stopPreview?.(); }
});
rescanButton.addEventListener("click", () => { void refreshConversation(); });
retryPreview.addEventListener("click", schedulePreview);
cancelButton.addEventListener("click", () => {
  cancelButton.disabled = true;
  showStatus("Cancelling…");
  void session?.cancel().catch(() => showStatus("Source tab unavailable. Waiting for scan to stop…", true))
    .finally(() => { cancelButton.disabled = false; });
});
document.querySelectorAll<HTMLButtonElement>(".format-mode").forEach(button => button.addEventListener("click", () => {
  if (exporting) return;
  format = button.dataset.format === "markdown" ? "markdown" : "pdf";
  syncControls();
  if (format === "pdf") schedulePreview();
  else { ++previewId; clearTimeout(previewTimer); stopPreview?.(); }
}));
document.querySelectorAll<HTMLButtonElement>(".theme-mode").forEach(button => button.addEventListener("click", () => {
  if (exporting) return;
  theme = button.dataset.theme === "light" ? "light" : "dark";
  try { localStorage.setItem(SETTINGS_KEY, theme); } catch { /* Preferences must not block exports. */ }
  syncControls();
  schedulePreview();
}));
window.addEventListener("beforeunload", event => {
  stopPreview?.();
  if (exporting) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("pagehide", () => {
  if (exporting) void session?.cancel().catch(() => {});
});
syncControls();
void refreshConversation().then(() => {
  if (ready && query.get("autostart") === "1") void exportConversation();
});
