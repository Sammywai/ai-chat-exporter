import type { PdfOptions } from "./pdf-options.js";
import type { Conversation } from "../core/conversation.js";

export type ExportFormat = "pdf" | "markdown";

export interface ExportCurrentConversationRequest {
  type: "export-current-conversation";
  format: ExportFormat;
  pdfOptions?: PdfOptions;
  tabId?: number;
}

export interface InspectCurrentConversationRequest {
  type: "inspect-current-conversation";
  tabId?: number;
}

export interface ExportUnavailableResponse {
  status: "unavailable";
  message: string;
}

export interface ExportDownloadedResponse {
  status: "downloaded";
  message: string;
}

export type ExportResponse = ExportUnavailableResponse | ExportDownloadedResponse;

export type ConversationInspectionResponse =
  | {
    status: "ready";
    provider: string;
    title: string;
    messageCount: number;
    tabId: number;
    conversation: Conversation;
  }
  | {
    status: "empty" | "unavailable" | "unsupported";
    message: string;
    provider?: string;
    tabId?: number;
  };

export function isInspectCurrentConversationRequest(
  value: unknown
): value is InspectCurrentConversationRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<InspectCurrentConversationRequest>;
  return request.type === "inspect-current-conversation" &&
    (request.tabId === undefined || Number.isInteger(request.tabId));
}

export function isExportCurrentConversationRequest(
  value: unknown
): value is ExportCurrentConversationRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<ExportCurrentConversationRequest>;
  return (
    request.type === "export-current-conversation" &&
    (request.format === "pdf" || request.format === "markdown") &&
    (request.tabId === undefined || Number.isInteger(request.tabId)) &&
    (request.pdfOptions === undefined || (
      typeof request.pdfOptions === "object" && request.pdfOptions !== null
    ))
  );
}
