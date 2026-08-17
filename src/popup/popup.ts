import {
  DEFAULT_PDF_OPTIONS,
  normalizePdfOptions,
  PDF_COLOR_PRESETS,
  PDF_COLOR_PRESET_OPTIONS,
  PDF_SPACING_OPTIONS,
  PDF_TEMPLATE_OPTIONS,
  PDF_TEXT_SIZE_OPTIONS,
  type PdfCustomColors,
  type NormalizedPdfOptions,
  type PdfOptions
} from "../shared/pdf-options.js";
import { renderPdf } from "../renderers/pdf.js";
import { createConversationPreview, type Conversation } from "../core/conversation.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type {
  ConversationInspectionResponse,
  ExportCurrentConversationRequest,
  ExportResponse
} from "../shared/protocol.js";

const SETTINGS_KEY = "chat-archive.pdf-options";
GlobalWorkerOptions.workerSrc = "./pdf.worker.js";
const PREVIEW_CONVERSATION: Conversation = {
  provider: "chatgpt",
  title: "Building a readable local archive",
  messages: [
    {
      id: "preview-user-1",
      role: "user",
      blocks: [{ type: "paragraph", text: "Can you make this easier to read?" }]
    },
    {
      id: "preview-assistant-1",
      role: "assistant",
      blocks: [
        { type: "heading", level: 2, text: "A clear answer" },
        { type: "paragraph", text: "Use strong text, visible roles, and generous spacing." },
        {
          type: "table",
          headers: ["Role", "Visual cue"],
          rows: [["You", "Right-aligned bubble"], ["Assistant", "Label and content rail"]]
        },
        { type: "code", language: "shell", code: "export --format pdf" }
      ]
    },
    {
      id: "preview-user-2",
      role: "user",
      blocks: [{ type: "paragraph", text: "Keep it local." }]
    },
    {
      id: "preview-assistant-2",
      role: "assistant",
      blocks: [{ type: "paragraph", text: "Conversation extraction, styling, and export stay in your browser." }]
    }
  ]
};
let previewConversation = PREVIEW_CONVERSATION;
const editorMode = new URLSearchParams(window.location.search).get("mode") === "editor";

document.body.classList.toggle("editor-mode", editorMode);

const form = document.querySelector<HTMLFormElement>("#export-form");
const format = document.querySelector<HTMLSelectElement>("#format");
const formatModes = document.querySelector<HTMLElement>("#format-modes");
const status = document.querySelector<HTMLElement>("#status");
const ticketFormat = document.querySelector<HTMLElement>("#ticket-format");
const pdfWorkspace = document.querySelector<HTMLElement>("#pdf-workspace");
const markdownWorkspace = document.querySelector<HTMLElement>("#markdown-workspace");
const settingsPanel = document.querySelector<HTMLElement>("#pdf-settings");
const openEditor = document.querySelector<HTMLButtonElement>("#open-editor");
const resetOptions = document.querySelector<HTMLButtonElement>("#reset-options");
const exportButton = document.querySelector<HTMLButtonElement>("#export-button");
const exportButtonLabel = exportButton?.querySelector<HTMLElement>("span");
const saveState = document.querySelector<HTMLElement>("#save-state");
const template = document.querySelector<HTMLSelectElement>("#template");
const textSize = document.querySelector<HTMLSelectElement>("#text-size");
const spacing = document.querySelector<HTMLSelectElement>("#spacing");
const customColorsPanel = document.querySelector<HTMLElement>("#custom-colors");
const templateCards = document.querySelector<HTMLElement>("#template-cards");
const textSizeCards = document.querySelector<HTMLElement>("#text-size-cards");
const colorFamilyCards = document.querySelector<HTMLElement>("#color-family-cards");
const previewDocument = document.querySelector<HTMLCanvasElement>("#preview-document");
const previewLoading = document.querySelector<HTMLElement>("#preview-loading");
const previewLoadingText = document.querySelector<HTMLElement>("#preview-loading-text");
const retryPreview = document.querySelector<HTMLButtonElement>("#retry-preview");
const previewTitle = document.querySelector<HTMLElement>("#preview-title");
const previewBestFor = document.querySelector<HTMLElement>("#preview-best-for");
const colorPreset = document.querySelector<HTMLSelectElement>("#color-preset");
const colorRole = document.querySelector<HTMLSelectElement>("#color-role");
const colorSwatches = document.querySelector<HTMLElement>("#color-swatches");
const activeColorLabel = document.querySelector<HTMLElement>("#active-color-label");
const contrastStatus = document.querySelector<HTMLElement>("#contrast-status");
const conversationState = document.querySelector<HTMLElement>("#conversation-state");
const conversationTitle = document.querySelector<HTMLElement>("#conversation-title");
const conversationMeta = document.querySelector<HTMLElement>("#conversation-meta");
const retryConversation = document.querySelector<HTMLButtonElement>("#retry-conversation");

const customColorInputs = {
  page: document.querySelector<HTMLInputElement>("#custom-page"),
  text: document.querySelector<HTMLInputElement>("#custom-text"),
  userBubble: document.querySelector<HTMLInputElement>("#custom-user-bubble"),
  userText: document.querySelector<HTMLInputElement>("#custom-user-text"),
  userAccent: document.querySelector<HTMLInputElement>("#custom-user-accent"),
  assistantAccent: document.querySelector<HTMLInputElement>("#custom-assistant-accent"),
  assistantSurface: document.querySelector<HTMLInputElement>("#custom-assistant-surface"),
  rule: document.querySelector<HTMLInputElement>("#custom-rule")
} as const;

const customColorValueLabels = {
  page: document.querySelector<HTMLElement>("#custom-page-value"),
  text: document.querySelector<HTMLElement>("#custom-text-value"),
  userBubble: document.querySelector<HTMLElement>("#custom-user-bubble-value"),
  userText: document.querySelector<HTMLElement>("#custom-user-text-value"),
  userAccent: document.querySelector<HTMLElement>("#custom-user-accent-value"),
  assistantAccent: document.querySelector<HTMLElement>("#custom-assistant-accent-value"),
  assistantSurface: document.querySelector<HTMLElement>("#custom-assistant-surface-value"),
  rule: document.querySelector<HTMLElement>("#custom-rule-value")
} as const;

type CustomColorKey = keyof PdfCustomColors;
const customColorKeys: CustomColorKey[] = [
  "page",
  "text",
  "userBubble",
  "userText",
  "userAccent",
  "assistantAccent",
  "assistantSurface",
  "rule"
];

const colorRoleLabels: Record<CustomColorKey, string> = {
  page: "Page background",
  text: "Main text",
  userBubble: "Your bubble",
  userText: "Your text",
  userAccent: "Your label",
  assistantAccent: "Assistant label",
  assistantSurface: "Assistant panel",
  rule: "Dividers"
};

const colorSwatchValues = [
  "#000000", "#4D4D4D", "#666666", "#999999", "#B3B3B3", "#D9D9D9", "#FFFFFF",
  "#FF3333", "#FF565B", "#F15BB5", "#D9A0E8", "#BD5DD9", "#8747F5", "#5718E6",
  "#0B98B2", "#13B5D0", "#5AD3D7", "#39A8ED", "#526FF0", "#0752AC", "#1C08B5",
  "#00B95B", "#7BD957", "#B5FF68", "#FFDD59", "#FFB64F", "#FF8A4E", "#FF6B1A"
];

let previewRenderTimer: number | undefined;
let previewRequestId = 0;
let preferenceLoadFailed = false;
let conversationReady = false;
let activeTabId = parseSourceTabId();

if (
  !form ||
  !format ||
  !formatModes ||
  !status ||
  !ticketFormat ||
  !pdfWorkspace ||
  !markdownWorkspace ||
  !settingsPanel ||
  !openEditor ||
  !resetOptions ||
  !exportButton ||
  !exportButtonLabel ||
  !saveState ||
  !template ||
  !textSize ||
  !spacing ||
  !customColorsPanel ||
  !templateCards ||
  !textSizeCards ||
  !colorFamilyCards ||
  !previewDocument ||
  !previewLoading ||
  !previewLoadingText ||
  !retryPreview ||
  !previewTitle ||
  !previewBestFor ||
  !colorPreset ||
  !colorRole ||
  !colorSwatches ||
  !activeColorLabel ||
  !contrastStatus ||
  !conversationState ||
  !conversationTitle ||
  !conversationMeta ||
  !retryConversation ||
  customColorKeys.some((key) => !customColorInputs[key] || !customColorValueLabels[key])
) {
  throw new Error("The export popup is missing required controls.");
}

populateOptions(template, PDF_TEMPLATE_OPTIONS);
populateOptions(textSize, PDF_TEXT_SIZE_OPTIONS);
populateOptions(spacing, PDF_SPACING_OPTIONS);
populateOptions(colorPreset, PDF_COLOR_PRESET_OPTIONS);
renderTemplateCards();
renderTextSizeCards();
renderColorFamilyCards();
renderColorSwatches();
applyOptions(loadOptions());
syncSettingsVisibility();
syncCustomColorVisibility();
syncAppearanceUi();
if (preferenceLoadFailed) {
  showPreferenceError("Saved preferences unavailable; readable defaults loaded.");
}
void refreshConversationState();

openEditor.addEventListener("click", () => {
  const editorUrl = new URL(window.location.href);
  editorUrl.searchParams.set("mode", "editor");
  if (activeTabId !== undefined) {
    editorUrl.searchParams.set("sourceTabId", String(activeTabId));
  }
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    void chrome.tabs.create({ url: editorUrl.href });
    return;
  }
  window.open(editorUrl.href, "_blank");
});

resetOptions.addEventListener("click", () => {
  applyOptions(DEFAULT_PDF_OPTIONS);
  syncCustomColorVisibility();
  syncAppearanceUi();
  const saved = saveOptions();
  status!.dataset.state = saved ? "success" : "error";
  status!.textContent = saved
    ? "Appearance reset to readable defaults."
    : "Defaults applied, but preferences could not be saved on this device.";
});

retryPreview.addEventListener("click", () => {
  schedulePdfPreview();
});

retryConversation.addEventListener("click", () => {
  void refreshConversationState();
});

format.addEventListener("change", () => {
  syncSettingsVisibility();
  syncCustomColorVisibility();
  syncAppearanceUi();
  saveOptions();
});

for (const mode of formatModes.querySelectorAll<HTMLButtonElement>(".format-mode")) {
  mode.addEventListener("click", () => {
    format.value = mode.dataset.format === "markdown" ? "markdown" : "pdf";
    syncSettingsVisibility();
    syncCustomColorVisibility();
    syncAppearanceUi();
    saveOptions();
  });
}

for (const control of [template, textSize, spacing]) {
  control.addEventListener("change", () => {
    syncAppearanceUi();
    saveOptions();
  });
}

colorRole.addEventListener("change", syncCustomColorUi);

for (const key of customColorKeys) {
  const input = customColorInputs[key]!;
  input.addEventListener("input", () => {
    syncCustomColorUi();
    syncAppearanceUi();
  });
  input.addEventListener("change", () => {
    colorPreset!.value = "custom";
    syncCustomColorVisibility();
    syncAppearanceUi();
    saveOptions();
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  exportButton!.disabled = true;
  exportButtonLabel!.textContent = "Exporting…";
  status!.dataset.state = "loading";
  status.textContent = "Preparing export…";

  try {
    const request: ExportCurrentConversationRequest = {
      type: "export-current-conversation",
      format: format.value as ExportCurrentConversationRequest["format"],
      pdfOptions: readOptions(),
      ...(activeTabId !== undefined ? { tabId: activeTabId } : {})
    };
    const response = (await chrome.runtime.sendMessage(request)) as ExportResponse;
    status.dataset.state = response.status === "downloaded" ? "success" : "error";
    status.textContent = response.message;
  } catch {
    status.dataset.state = "error";
    status.textContent = "Export failed. Keep the AI chat open, then try again.";
  } finally {
    exportButton!.disabled = !conversationReady;
    exportButtonLabel!.textContent = "Export conversation";
  }
});

function renderTemplateCards(): void {
  templateCards!.replaceChildren(
    ...PDF_TEMPLATE_OPTIONS.map((option) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "template-card";
      card.dataset.template = option.value;
      card.setAttribute("aria-pressed", "false");
      card.setAttribute("aria-label", `${option.label}: ${option.description}`);

      const copy = document.createElement("span");
      copy.className = "template-card-copy";
      const label = document.createElement("strong");
      label.textContent = option.label;
      const description = document.createElement("small");
      description.textContent = option.bestFor;
      copy.append(label, description);

      card.append(copy);
      card.addEventListener("click", () => {
        template!.value = option.value;
        syncAppearanceUi();
        saveOptions();
      });
      return card;
    })
  );
}

function renderTextSizeCards(): void {
  textSizeCards!.replaceChildren(
    ...PDF_TEXT_SIZE_OPTIONS.map((option) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "text-size-card";
      card.dataset.size = option.value;
      card.setAttribute("aria-pressed", "false");
      card.setAttribute("aria-label", `${option.label}: ${option.description}`);

      const sample = document.createElement("span");
      sample.className = "size-sample";
      sample.textContent = option.sample;
      const label = document.createElement("strong");
      label.textContent = option.label;
      const description = document.createElement("small");
      description.textContent = option.description;
      card.append(sample, label, description);
      card.addEventListener("click", () => {
        textSize!.value = option.value;
        syncAppearanceUi();
        saveOptions();
      });
      return card;
    })
  );
}

function renderColorFamilyCards(): void {
  colorFamilyCards!.replaceChildren(
    ...PDF_COLOR_PRESET_OPTIONS.map((option) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "color-family-card";
      card.dataset.family = option.value;
      card.setAttribute("aria-pressed", "false");
      card.setAttribute("aria-label", `${option.label}: ${option.description}`);

      const swatches = document.createElement("span");
      swatches.className = "family-swatches";
      if (option.value === "custom") {
        for (const color of ["#1F78FF", "#70A995", "#DDB86D"]) {
          const swatch = document.createElement("span");
          swatch.style.backgroundColor = color;
          swatches.append(swatch);
        }
      } else {
        const palette = PDF_COLOR_PRESETS[option.value].light;
        for (const color of [palette.page, palette.userBubble, palette.assistantAccent]) {
          const swatch = document.createElement("span");
          swatch.style.backgroundColor = color;
          swatches.append(swatch);
        }
      }

      const label = document.createElement("strong");
      label.textContent = option.label;
      const description = document.createElement("small");
      description.textContent = option.value === "custom" ? "Edit every role" : "AA/AAA checked";
      card.append(swatches, label, description);
      card.addEventListener("click", () => {
        colorPreset!.value = option.value;
        if (option.value !== "custom") {
          applyCustomColors(PDF_COLOR_PRESETS[option.value].light);
        }
        syncCustomColorVisibility();
        syncAppearanceUi();
        saveOptions();
      });
      return card;
    })
  );
}

function syncAppearanceUi(): void {
  const options = readOptions();
  const selectedTemplate = PDF_TEMPLATE_OPTIONS.find((option) => option.value === options.template);

  previewTitle!.textContent = selectedTemplate?.label ?? "PDF template";
  previewBestFor!.textContent = conversationReady
    ? `Current conversation · page 1 preview · ${selectedTemplate?.bestFor ?? "Your saved style"}`
    : `Sample appearance · page 1 only · ${selectedTemplate?.bestFor ?? "Your saved style"}`;

  for (const card of templateCards!.querySelectorAll<HTMLButtonElement>(".template-card")) {
    card.setAttribute("aria-pressed", String(card.dataset.template === options.template));
  }
  for (const card of textSizeCards!.querySelectorAll<HTMLButtonElement>(".text-size-card")) {
    card.setAttribute("aria-pressed", String(card.dataset.size === options.textSize));
  }
  for (const card of colorFamilyCards!.querySelectorAll<HTMLButtonElement>(".color-family-card")) {
    card.setAttribute("aria-pressed", String(card.dataset.family === options.colorPreset));
  }

  schedulePdfPreview();
}

function populateOptions(
  select: HTMLSelectElement,
  options: ReadonlyArray<{ value: string; label: string; description?: string }>
): void {
  select.replaceChildren(
    ...options.map((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      if (option.description) {
        element.title = option.description;
      }
      return element;
    })
  );
}

function readOptions(): NormalizedPdfOptions {
  return normalizePdfOptions({
    template: template!.value,
    textSize: textSize!.value,
    spacing: spacing!.value,
    themeMode: "light",
    bubbleStyle: "brand",
    speakerColors: colorPreset!.value === "custom" ? "custom" : "template",
    colorPreset: colorPreset!.value,
    customColors: readCustomColors(),
    tableStyle: "soft",
    codeStyle: "panel"
  });
}

function applyOptions(options: PdfOptions): void {
  const normalized = normalizePdfOptions(options);
  template!.value = normalized.template;
  textSize!.value = normalized.textSize;
  spacing!.value = normalized.spacing;
  colorPreset!.value = normalized.speakerColors === "custom" ? "custom" : normalized.colorPreset;
  applyCustomColors(normalized.customColors);
}

function loadOptions(): PdfOptions {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizePdfOptions(JSON.parse(raw)) : DEFAULT_PDF_OPTIONS;
  } catch {
    preferenceLoadFailed = true;
    return DEFAULT_PDF_OPTIONS;
  }
}

function saveOptions(): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(readOptions()));
    saveState!.dataset.state = "saved";
    saveState!.lastChild!.textContent = "Saved locally";
    return true;
  } catch {
    showPreferenceError("Preferences could not be saved on this device.");
    return false;
  }
}

function syncSettingsVisibility(): void {
  const pdfVisible = format!.value === "pdf";
  for (const mode of formatModes!.querySelectorAll<HTMLButtonElement>(".format-mode")) {
    mode.setAttribute("aria-pressed", String(mode.dataset.format === format!.value));
  }
  ticketFormat!.textContent = pdfVisible ? "PDF" : "MARKDOWN";
  pdfWorkspace!.hidden = !pdfVisible;
  pdfWorkspace!.setAttribute("aria-hidden", String(!pdfVisible));
  markdownWorkspace!.hidden = pdfVisible;
  markdownWorkspace!.setAttribute("aria-hidden", String(pdfVisible));
  resetOptions!.hidden = !pdfVisible;
  openEditor!.hidden = !pdfVisible || editorMode;
  updateReadyStatus();
}

function syncCustomColorVisibility(): void {
  const visible = format!.value === "pdf" && colorPreset!.value === "custom";
  customColorsPanel!.hidden = !visible;
  customColorsPanel!.setAttribute("aria-hidden", String(!visible));
  syncCustomColorUi();
}

function renderColorSwatches(): void {
  colorSwatches!.replaceChildren(
    ...colorSwatchValues.map((color) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "color-swatch";
      swatch.style.backgroundColor = color;
      swatch.title = color;
      swatch.setAttribute("aria-label", `Use ${color}`);
      swatch.setAttribute("aria-pressed", "false");
      swatch.dataset.color = color;
      swatch.addEventListener("click", () => {
        const key = colorRole!.value as CustomColorKey;
        customColorInputs[key]!.value = color;
        colorPreset!.value = "custom";
        syncCustomColorVisibility();
        syncAppearanceUi();
        saveOptions();
      });
      return swatch;
    })
  );
}

function schedulePdfPreview(): void {
  const requestId = ++previewRequestId;
  previewLoading!.hidden = false;
  previewLoading!.dataset.state = "loading";
  previewLoadingText!.textContent = "Rendering sample page…";
  retryPreview!.hidden = true;
  if (previewRenderTimer !== undefined) {
    window.clearTimeout(previewRenderTimer);
  }
  previewRenderTimer = window.setTimeout(() => {
    void renderSamplePreview(requestId);
  }, 150);
}

async function renderSamplePreview(requestId: number): Promise<void> {
  try {
    const pdf = await renderPdf(previewConversation, readOptions());
    if (requestId !== previewRequestId) {
      return;
    }

    const loadingTask = getDocument({ data: pdf.slice() });
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);
    const viewport = page.getViewport({ scale: 1.6 });
    const context = previewDocument!.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("PDF preview canvas is unavailable.");
    }
    previewDocument!.width = Math.ceil(viewport.width);
    previewDocument!.height = Math.ceil(viewport.height);
    await page.render({ canvas: previewDocument!, canvasContext: context, viewport }).promise;
    await pdfDocument.destroy();
    previewLoading!.hidden = true;
  } catch {
    if (requestId !== previewRequestId) {
      return;
    }
    previewLoading!.dataset.state = "error";
    previewLoadingText!.textContent = "Sample preview failed. Appearance settings remain available.";
    retryPreview!.hidden = false;
  }
}

function parseSourceTabId(): number | undefined {
  const value = Number.parseInt(new URLSearchParams(window.location.search).get("sourceTabId") ?? "", 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

async function refreshConversationState(): Promise<void> {
  setConversationState("loading", "Checking active tab…", "Looking for supported conversation");
  retryConversation!.hidden = true;
  conversationReady = false;
  exportButton!.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "inspect-current-conversation",
      ...(activeTabId !== undefined ? { tabId: activeTabId } : {})
    }) as ConversationInspectionResponse;
    if (response.status === "ready") {
      activeTabId = response.tabId;
      conversationReady = true;
      previewConversation = createConversationPreview(response.conversation);
      syncAppearanceUi();
      setConversationState(
        "ready",
        response.title,
        `${response.provider} · ${response.messageCount} ${response.messageCount === 1 ? "message" : "messages"} · Ready to export`
      );
      exportButton!.disabled = false;
      updateReadyStatus();
      return;
    }

    activeTabId = response.tabId ?? activeTabId;
    setConversationState(response.status, response.provider ?? "Conversation unavailable", response.message);
    retryConversation!.hidden = response.status === "unsupported";
    updateReadyStatus();
  } catch {
    setConversationState(
      "unavailable",
      "Conversation unavailable",
      "Could not inspect this tab. Reload the chat, then retry."
    );
    retryConversation!.hidden = false;
    updateReadyStatus();
  }
}

function setConversationState(state: string, title: string, meta: string): void {
  conversationState!.dataset.state = state;
  conversationState!.setAttribute("aria-busy", String(state === "loading"));
  conversationTitle!.textContent = title;
  conversationMeta!.textContent = meta;
}

function updateReadyStatus(): void {
  if (!conversationReady) {
    return;
  }
  const exportFormat = format!.value === "pdf" ? "PDF" : "Markdown";
  status!.dataset.state = "ready";
  status!.textContent = `${exportFormat} export ready. Conversation stays on this device.`;
}

function showPreferenceError(message: string): void {
  saveState!.dataset.state = "error";
  saveState!.lastChild!.textContent = message;
}

function readCustomColors(): Partial<PdfCustomColors> {
  return Object.fromEntries(
    customColorKeys.map((key) => [key, customColorInputs[key]!.value])
  ) as Partial<PdfCustomColors>;
}

function applyCustomColors(colors: PdfCustomColors): void {
  for (const key of customColorKeys) {
    customColorInputs[key]!.value = colors[key];
  }
  syncCustomColorUi();
}

function syncCustomColorUi(): void {
  for (const key of customColorKeys) {
    const value = customColorInputs[key]!.value.toUpperCase();
    customColorValueLabels[key]!.textContent = value;
  }

  const key = colorRole!.value as CustomColorKey;
  activeColorLabel!.textContent = colorRoleLabels[key];
  const activeValue = customColorInputs[key]!.value.toUpperCase();
  for (const swatch of colorSwatches!.querySelectorAll<HTMLButtonElement>(".color-swatch")) {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === activeValue));
  }
  updateContrastStatus();
}

function updateContrastStatus(): void {
  const colors = readCustomColors() as PdfCustomColors;
  const body = contrastRatio(colors.text, colors.page);
  const bubble = contrastRatio(colors.userText, colors.userBubble);
  const assistant = contrastRatio(colors.assistantAccent, colors.page);
  const panel = contrastRatio(colors.text, colors.assistantSurface);
  const rule = contrastRatio(colors.rule, colors.page);
  const bubbleSameAsPage = colors.userBubble.toUpperCase() === colors.page.toUpperCase();
  const readable = body >= 4.5 && bubble >= 4.5 && assistant >= 4.5 && panel >= 4.5 && rule >= 3 && !bubbleSameAsPage;
  contrastStatus!.className = `contrast-status ${readable ? "is-good" : "is-warning"}`;
  contrastStatus!.textContent = readable
    ? `Readable palette · text ${body.toFixed(1)}:1 · bubble ${bubble.toFixed(1)}:1`
    : bubbleSameAsPage
      ? "Bubble and page are the same color. Choose a contrasting bubble surface."
      : "Low contrast in one or more roles. Choose a darker text or a lighter surface.";
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(value: string): number {
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset + 1, offset + 3), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
