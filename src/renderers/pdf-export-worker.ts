import { renderPdf } from "./pdf.js";
import type { Conversation } from "../core/conversation.js";
import type { PdfOptions } from "../shared/pdf-options.js";

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ conversation: Conversation; options?: PdfOptions }>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

worker.onmessage = (event) => {
  void renderPdf(event.data.conversation, event.data.options).then((pdf) => {
    const buffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    worker.postMessage({ pdf: buffer }, [buffer]);
  }, () => {
    worker.postMessage({ error: "PDF rendering failed. Choose Markdown to save the captured conversation without rescanning." });
  });
};
