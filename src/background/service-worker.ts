import { extractChatGptConversation } from "../adapters/chatgpt.js";
import { extractClaudeConversation } from "../adapters/claude.js";
import { extractDeepSeekConversation } from "../adapters/deepseek.js";
import { extractAdditionalConversation, type AdditionalProvider } from "../adapters/additional.js";
import {
  ConversationLimitError,
  createConversation,
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isInspectCurrentConversationRequest(message)) {
    void inspectCurrentConversation(message.tabId).then(sendResponse);
    return true;
  }

  if (!isExportCurrentConversationRequest(message)) {
    return;
  }

  void exportCurrentConversation(message.format, message.pdfOptions, message.tabId).then(sendResponse);
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
    const conversation = await extractConversation(tab.id, provider);
    if (!conversation || conversation.messages.length === 0) {
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
      title: conversation.title,
      messageCount: conversation.messages.length,
      tabId: tab.id,
      conversation
    };
  } catch (error) {
    return {
      status: "unavailable",
      provider: provider.name,
      tabId: tab.id,
      message: error instanceof ConversationLimitError
        ? error.message
        : `${provider.name} conversation is unavailable. Reload the chat, then retry.`
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

  let conversation;
  try {
    conversation = await extractConversation(tab.id, provider);
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof ConversationLimitError
        ? error.message
        : `${provider.name} conversation is unavailable. Reload the chat, then retry.`
    };
  }
  if (!conversation || conversation.messages.length === 0) {
    return {
      status: "unavailable",
      message: `No visible ${provider.name} messages were found on this page.`
    };
  }

  const filename = toFilename(conversation.title);

  if (format === "markdown") {
    await chrome.downloads.download({
      url: `data:text/markdown;charset=utf-8,${encodeURIComponent(renderMarkdown(conversation))}`,
      filename: `${filename}.md`,
      saveAs: true
    });

    return {
      status: "downloaded",
      message: "Markdown export is ready."
    };
  }

  const pdf = await renderPdf(conversation, pdfOptions);
  if (pdf.byteLength > 64 * 1024 * 1024) {
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
  provider: ProviderTarget
): Promise<ReturnType<typeof createConversation> | null> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: provider.extractor,
    ...(provider.args ? { args: provider.args } : {})
  });
  return injection?.result ? createConversation(injection.result) : null;
}

interface ProviderTarget {
  name: string;
  extractor: (...args: any[]) => ConversationDraft | null | Promise<ConversationDraft | null>;
  args?: unknown[];
}

function providerForUrl(url: string | undefined): ProviderTarget | null {
  if (!url) {
    return null;
  }

  const hostname = new URL(url).hostname;
  if (hostname === "chatgpt.com" || hostname === "chat.openai.com") {
    return { name: "ChatGPT", extractor: extractChatGptConversation };
  }

  if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
    return { name: "Claude", extractor: extractClaudeConversation };
  }

  if (hostname === "chat.deepseek.com") {
    return { name: "DeepSeek", extractor: extractDeepSeekConversation };
  }

  if (hostname === "gemini.google.com" || hostname.endsWith(".gemini.google.com")) {
    return additionalProviderTarget("Gemini", "gemini");
  }

  if (hostname === "copilot.microsoft.com" || hostname.endsWith(".copilot.microsoft.com")) {
    return additionalProviderTarget("Copilot", "copilot");
  }

  if (hostname === "perplexity.ai" || hostname.endsWith(".perplexity.ai")) {
    return additionalProviderTarget("Perplexity", "perplexity");
  }

  if (
    hostname === "grok.com" ||
    hostname.endsWith(".grok.com") ||
    (hostname === "x.com" && new URL(url).pathname.startsWith("/i/grok"))
  ) {
    return additionalProviderTarget("Grok", "grok");
  }

  return null;
}

function additionalProviderTarget(name: string, provider: AdditionalProvider): ProviderTarget {
  return {
    name,
    extractor: extractAdditionalConversation,
    args: [provider]
  };
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
