import { captureConversation } from "../adapters/capture.js";
import type { Provider } from "../core/conversation.js";
import {
  createConversation,
  createConversationPreview,
  type ConversationDraft
} from "../core/conversation.js";
import { renderMarkdown } from "../renderers/markdown.js";
import { renderPdf } from "../renderers/pdf.js";
import {
  isInspectCurrentConversationRequest,
  isExportCurrentConversationRequest,
  type ConversationInspectionResponse,
  type ExportFormat,
  type ExportResponse
} from "../shared/protocol.js";
import type { PdfOptions } from "../shared/pdf-options.js";

const PDF_DOWNLOAD_LIMIT_BYTES = 64 * 1024 * 1024;

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  // Submit the tab-specific path first, but invoke open in this click's stack:
  // waiting for setOptions' response can discard the toolbar user gesture.
  const options = chrome.sidePanel.setOptions({
    tabId, path: `popup/index.html?mode=panel&sourceTabId=${tabId}`, enabled: true
  });
  const opened = chrome.sidePanel.open({ tabId });
  void Promise.all([options, opened]).then(() => {
    void chrome.action.setTitle({ tabId, title: "Export AI chat" });
  }).catch(() => {
    void chrome.action.setTitle({ tabId, title: "Could not open export panel. Reload the extension and retry." });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isInspectCurrentConversationRequest(message)) {
    void inspectCurrentConversation(message.tabId)
      .then(sendResponse)
      .catch(() => {
        sendResponse({
          status: "unavailable",
          message: "Conversation is unavailable. Reload the chat, then retry."
        });
      });
    return true;
  }

  if (!isExportCurrentConversationRequest(message)) {
    return;
  }

  void exportCurrentConversation(message.format, message.pdfOptions, message.tabId)
    .then(sendResponse)
    .catch(() => {
      sendResponse({
        status: "unavailable",
        message: "Export failed. Keep the AI chat open, then try again."
      });
    });
  return true;
});

async function inspectCurrentConversation(tabId?: number): Promise<ConversationInspectionResponse> {
  const tab = await resolveTab(tabId);
  const provider = providerForUrl(tab?.url);
  if (!tab?.id || !provider) {
    return {
      status: "unsupported",
      message: "Open a supported AI conversation to export it."
    };
  }

  try {
    const draft = await extractConversation(tab.id, provider, "preview");
    if (!draft || draft.messages.length === 0) {
      return {
        status: "empty",
        provider: provider.name,
        tabId: tab.id,
        message: `No visible ${provider.name} messages found. Open a conversation or wait for it to finish loading.`
      };
    }

    return {
      status: "ready",
      provider: provider.name,
      title: draft.title,
      messageCount: draft.messages.length,
      tabId: tab.id,
      // Only a bounded preview is sent to the popup, so the inspection message stays
      // small even for a very large conversation, and the size ceiling is not applied here.
      conversation: createConversationPreview(draft)
    };
  } catch {
    return {
      status: "unavailable",
      provider: provider.name,
      tabId: tab.id,
      message: `${provider.name} conversation is unavailable. Reload the chat, then retry.`
    };
  }
}

async function exportCurrentConversation(
  format: ExportFormat,
  pdfOptions?: PdfOptions,
  tabId?: number
): Promise<ExportResponse> {
  const tab = await resolveTab(tabId);
  const provider = providerForUrl(tab?.url);

  if (!tab?.id || !provider) {
    return {
      status: "unavailable",
      message: "Open a supported AI conversation before exporting."
    };
  }

  let draft;
  try {
    draft = await extractConversation(tab.id, provider, "complete");
  } catch {
    return {
      status: "unavailable",
      message: `${provider.name} conversation is unavailable. Reload the chat, then retry.`
    };
  }
  if (!draft || draft.messages.length === 0) {
    return {
      status: "unavailable",
      message: `No visible ${provider.name} messages were found on this page.`
    };
  }

  const filename = toFilename(draft.title);

  if (format === "markdown") {
    await chrome.downloads.download({
      url: `data:text/markdown;charset=utf-8,${encodeURIComponent(renderMarkdown(draft))}`,
      filename: `${filename}.md`,
      saveAs: true
    });

    return {
      status: "downloaded",
      message: "Markdown export is ready."
    };
  }

  // The content ceiling is a backstop for the expensive PDF renderer only; the
  // Markdown path above has no size constraint. A very large chat that cannot render
  // as a PDF can still be exported as Markdown.
  let conversation;
  try {
    conversation = createConversation(draft);
  } catch {
    return {
      status: "unavailable",
      message: "This conversation is too large to render as a PDF safely. Try Markdown, or split it into smaller conversations."
    };
  }

  const pdf = await renderPdf(conversation, pdfOptions);
  if (pdf.byteLength > PDF_DOWNLOAD_LIMIT_BYTES) {
    return {
      status: "unavailable",
      message: "The generated PDF is too large to download safely. Split the conversation, then retry."
    };
  }
  await chrome.downloads.download({
    url: `data:application/pdf;base64,${toBase64(pdf)}`,
    filename: `${filename}.pdf`,
    saveAs: true
  });

  return {
    status: "downloaded",
    message: "PDF export is ready."
  };
}

async function resolveTab(tabId?: number): Promise<ChromeTab | undefined> {
  if (tabId !== undefined) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return undefined;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractConversation(
  tabId: number,
  provider: ProviderTarget,
  mode: "preview" | "complete"
): Promise<ConversationDraft | null> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: captureConversation,
    args: [provider.provider, { mode }]
  });
  const result = injection?.result;
  if (!result || result.status === "empty") return null;
  if (result.status !== "captured") throw new Error(result.message);
  return result.conversation;
}

interface ProviderTarget { name: string; provider: Provider }

function providerForUrl(url: string | undefined): ProviderTarget | null {
  if (!url) {
    return null;
  }

  const hostname = new URL(url).hostname;
  if (hostname === "chatgpt.com" || hostname === "chat.openai.com") {
    return { name: "ChatGPT", provider: "chatgpt" };
  }

  if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
    return { name: "Claude", provider: "claude" };
  }

  if (hostname === "chat.deepseek.com") {
    return { name: "DeepSeek", provider: "deepseek" };
  }

  if (hostname === "gemini.google.com" || hostname.endsWith(".gemini.google.com")) {
    return { name: "Gemini", provider: "gemini" };
  }

  if (hostname === "copilot.microsoft.com" || hostname.endsWith(".copilot.microsoft.com")) {
    return { name: "Copilot", provider: "copilot" };
  }

  if (hostname === "perplexity.ai" || hostname.endsWith(".perplexity.ai")) {
    return { name: "Perplexity", provider: "perplexity" };
  }

  if (
    hostname === "grok.com" ||
    hostname.endsWith(".grok.com") ||
    (hostname === "x.com" && new URL(url).pathname.startsWith("/i/grok"))
  ) {
    return { name: "Grok", provider: "grok" };
  }

  return null;
}

function toFilename(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "ai-chat-export";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}
