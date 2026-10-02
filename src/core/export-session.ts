import { captureConversation, cancelCapture, type CaptureResult } from "../adapters/capture.js";
import { createConversation, type ConversationDraft, type Provider } from "./conversation.js";
import { renderMarkdown } from "../renderers/markdown.js";
import type { PdfOptions } from "../shared/pdf-options.js";
import type { ExportFormat } from "../shared/protocol.js";

export function providerFromUrl(url: string | undefined): Provider | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname;
  if (host === "chatgpt.com" || host === "chat.openai.com") return "chatgpt";
  if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
  if (host === "chat.deepseek.com") return "deepseek";
  if (host === "gemini.google.com" || host.endsWith(".gemini.google.com")) return "gemini";
  if (host === "copilot.microsoft.com" || host.endsWith(".copilot.microsoft.com")) return "copilot";
  if (host === "perplexity.ai" || host.endsWith(".perplexity.ai")) return "perplexity";
  if (host === "grok.com" || host.endsWith(".grok.com") || (host === "x.com" && parsed.pathname.startsWith("/i/grok"))) return "grok";
  return null;
}

export async function inspectTab(tabId: number): Promise<CaptureResult> {
  const tab = await chrome.tabs.get(tabId);
  const provider = providerFromUrl(tab.url);
  if (!provider) return { status: "failed", message: "Open a supported AI conversation." };
  const deadline = Date.now() + 8_000;
  for (;;) {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId }, func: captureConversation, args: [provider, { mode: "preview" }]
    });
    const result = injection?.result ?? { status: "failed" as const, message: "Chat could not be read. Reload it and retry." };
    const inspectedTab = await chrome.tabs.get(tabId);
    if (inspectedTab.url !== tab.url) return { status: "failed", message: "Chat changed while loading. Rescan the current conversation." };
    // Chat applications can briefly show an empty DOM while a conversation
    // hydrates. Retry only empty frames; permissions and extraction failures
    // remain immediate errors. Preview never scrolls or locks the chat.
    if (result.status !== "empty" || Date.now() >= deadline) return result;
    await new Promise<void>(resolve => setTimeout(resolve, 250));
    const currentTab = await chrome.tabs.get(tabId);
    if (currentTab.url !== tab.url) return { status: "failed", message: "Chat changed while loading. Rescan the current conversation." };
  }
}

export function downloadFilename(title: string): string {
  return title.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160).replace(/[. ]+$/g, "") || "ai-chat-export";
}

// Owned by the full extension page, not the transient popup or MV3 worker.
// Captured data stays in memory until this workspace closes or rescans.
export class ExportSession {
  captured: ConversationDraft | null = null;
  private jobId: string | null = null;
  private cancelled = false;
  private running = false;
  private stopRendering: (() => void) | undefined;

  constructor(readonly tabId: number, private readonly progress: (phase: string, count: number) => void) {}

  clear(): void { if (!this.running) this.captured = null; }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.stopRendering?.();
    if (this.jobId) await chrome.scripting.executeScript({ target: { tabId: this.tabId }, func: cancelCapture, args: [this.jobId] });
  }

  async export(format: ExportFormat, options?: PdfOptions): Promise<{ filename: string; count: number }> {
    if (this.running) throw new Error("An export is already running in this workspace.");
    this.running = true;
    this.cancelled = false;
    this.jobId = crypto.randomUUID();
    const listener = (message: unknown, sender: ChromeMessageSender, sendResponse?: (response: unknown) => void): void => {
      const event = message as { type?: string; jobId?: string; phase?: string; messageCount?: number } | null;
      if (event?.type === "capture-progress" && event.jobId === this.jobId && sender.tab?.id === this.tabId &&
        typeof event.phase === "string" && typeof event.messageCount === "number") {
        sendResponse?.({ alive: true });
        this.progress(event.phase, event.messageCount);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    try {
      if (!this.captured) {
        const tab = await chrome.tabs.get(this.tabId);
        if (this.cancelled) throw new Error("Export cancelled. No file was saved.");
        const provider = providerFromUrl(tab.url);
        if (!provider) throw new Error("Source tab is no longer a supported chat. Reopen the extension from your conversation.");
        this.progress("Finding first message", 0);
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId: this.tabId }, func: captureConversation,
          args: [provider, { mode: "complete", jobId: this.jobId, requireOwner: true }]
        });
        const result = injection?.result;
        if (!result) throw new Error("Source tab closed or reloaded during scanning. Reopen the chat and retry.");
        if (result.status !== "captured") throw new Error(result.message);
        if (!result.boundariesReached) throw new Error("Both ends of the chat were not reached. No incomplete file was saved.");
        this.captured = result.conversation;
      }
      if (this.cancelled) throw new Error("Export cancelled. No file was saved.");
      const count = this.captured.messages.length;
      this.progress(format === "pdf" ? "Rendering PDF" : "Preparing Markdown", count);
      let blob: Blob;
      if (format === "markdown") {
        blob = new Blob([renderMarkdown(this.captured)], { type: "text/markdown;charset=utf-8" });
      } else {
        let conversation;
        try { conversation = createConversation(this.captured); }
        catch { throw new Error("Chat captured, but too large for PDF. Choose Markdown to save the captured conversation without rescanning."); }
        const pdf = await this.renderPdf(conversation, options);
        if (pdf.byteLength > 64 * 1024 * 1024) throw new Error("PDF exceeds 64 MB. Choose Markdown to save the captured conversation without rescanning.");
        blob = new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
      }
      if (this.cancelled) throw new Error("Export cancelled. No file was saved.");
      const filename = `${downloadFilename(this.captured.title)}.${format === "pdf" ? "pdf" : "md"}`;
      this.progress("Choose where to save", count);
      await saveDownload(blob, filename, () => this.progress("Saving file", count));
      return { filename, count };
    } finally {
      chrome.runtime.onMessage.removeListener(listener);
      this.jobId = null;
      this.running = false;
    }
  }

  private renderPdf(conversation: ConversationDraft, options?: PdfOptions): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(chrome.runtime.getURL("renderers/pdf-export-worker.js"), { type: "module" });
      const finish = (): void => {
        clearTimeout(timer);
        worker.terminate();
        this.stopRendering = undefined;
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error("PDF rendering timed out. Choose Markdown to save the captured conversation without rescanning."));
      }, 180_000);
      this.stopRendering = () => {
        finish();
        reject(new Error("Export cancelled. Captured chat retained in this workspace."));
      };
      worker.onmessage = (event: MessageEvent<{ pdf?: ArrayBuffer; error?: string }>) => {
        finish();
        if (event.data.pdf) resolve(new Uint8Array(event.data.pdf));
        else reject(new Error(event.data.error ?? "PDF rendering failed. Try Markdown."));
      };
      worker.onerror = () => { finish(); reject(new Error("PDF renderer unavailable. Choose Markdown to save the captured conversation.")); };
      worker.postMessage({ conversation, options });
    });
  }
}

export async function saveDownload(blob: Blob, filename: string, saving: () => void): Promise<void> {
  const url = URL.createObjectURL(blob);
  let downloadId: number | undefined;
  const completed = new Map<number, ChromeDownloadDelta>();
  let notify: ((delta: ChromeDownloadDelta) => void) | undefined;
  const listener = (delta: ChromeDownloadDelta): void => {
    if (delta.state?.current === "complete" || delta.state?.current === "interrupted") {
      completed.set(delta.id, delta);
      if (delta.id === downloadId) notify?.(delta);
    }
  };
  chrome.downloads.onChanged.addListener(listener);
  try {
    downloadId = await chrome.downloads.download({ url, filename, saveAs: true });
    saving();
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (delta: ChromeDownloadDelta): void => {
        if (!delta.state || (delta.state.current !== "complete" && delta.state.current !== "interrupted")) return;
        clearTimeout(timer);
        if (delta.state.current === "complete") resolve();
        else reject(new Error("Download cancelled or interrupted. Captured chat is still available; retry saving."));
      };
      notify = finish;
      timer = setTimeout(() => reject(new Error("Download completion not confirmed. Check Chrome Downloads before retrying.")), 120_000);
      const early = completed.get(downloadId!);
      if (early) { finish(early); return; }
      void chrome.downloads.search({ id: downloadId! }).then(([item]) => {
        if (item) finish({ id: item.id, state: { current: item.state } });
      }, (error) => { clearTimeout(timer); reject(error); });
    });
  } finally {
    chrome.downloads.onChanged.removeListener(listener);
    URL.revokeObjectURL(url);
  }
}
