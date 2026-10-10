export type Provider =
  | "chatgpt"
  | "claude"
  | "deepseek"
  | "gemini"
  | "copilot"
  | "perplexity"
  | "grok";

export type MessageRole = "user" | "assistant" | "system";

export type MessageBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string; inlineFormat?: "markdown" }
  | { type: "table"; headers: string[]; rows: string[][]; inlineFormat?: "markdown" }
  | { type: "code"; language?: string; code: string }
  | { type: "math"; tex: string; display: boolean }
  | { type: "visual"; dataUrl: string; width: number; height: number; text: string }
  | { type: "image"; alt: string; sourceUrl: string };

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  blocks: MessageBlock[];
}

export interface ConversationDraft {
  provider: Provider;
  title: string;
  messages: ConversationMessage[];
}

export interface Conversation extends ConversationDraft {}

export const CONVERSATION_LIMITS = {
  messages: 10_000,
  blocksPerMessage: 1_000,
  charactersPerBlock: 1_000_000,
  totalCharacters: 20_000_000,
  tableRows: 10_000,
  tableColumns: 50,
  tableCells: 100_000
} as const;

export class ConversationLimitError extends Error {
  constructor() {
    super("This conversation is too large to export safely. Split it into smaller conversations, then retry.");
    this.name = "ConversationLimitError";
  }
}

export function createConversation(draft: ConversationDraft): Conversation {
  assertConversationWithinLimits(draft);
  return {
    provider: draft.provider,
    title: draft.title,
    messages: draft.messages
  };
}

export function createConversationPreview(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.slice(0, 6).map((message) => ({
      ...message,
      blocks: message.blocks.slice(0, 12).map(toPreviewBlock)
    }))
  };
}

function assertConversationWithinLimits(conversation: ConversationDraft): void {
  if (conversation.messages.length > CONVERSATION_LIMITS.messages) {
    throw new ConversationLimitError();
  }

  let totalCharacters = conversation.title.length;
  let totalVisualBytes = 0;
  for (const message of conversation.messages) {
    if (message.blocks.length > CONVERSATION_LIMITS.blocksPerMessage) {
      throw new ConversationLimitError();
    }

    totalCharacters += message.id.length;
    for (const block of message.blocks) {
      if (block.type === "visual") {
        totalVisualBytes += block.dataUrl.length;
        if (totalVisualBytes > 64_000_000) throw new ConversationLimitError();
      }
      if (block.type === "visual" && (!/^data:image\/png;base64,/.test(block.dataUrl)
        || !Number.isFinite(block.width) || !Number.isFinite(block.height)
        || block.width <= 0 || block.height <= 0 || block.width * block.height > 16_000_000
        || block.dataUrl.length > 8_000_000)) {
        throw new ConversationLimitError();
      }
      const blockCharacters = countBlockCharacters(block);
      if (blockCharacters > CONVERSATION_LIMITS.charactersPerBlock) {
        throw new ConversationLimitError();
      }
      totalCharacters += blockCharacters;
      if (totalCharacters > CONVERSATION_LIMITS.totalCharacters) {
        throw new ConversationLimitError();
      }
    }
  }
}

function countBlockCharacters(block: MessageBlock): number {
  // Raster data has its own bound; keep the existing transcript text budget.
  if (block.type === "visual") return block.text.length;
  if (block.type === "table") {
    if (block.rows.length > CONVERSATION_LIMITS.tableRows) {
      throw new ConversationLimitError();
    }

    let cells = block.headers.length;
    let characters = block.headers.reduce((total, cell) => total + cell.length, 0);
    if (block.headers.length > CONVERSATION_LIMITS.tableColumns) {
      throw new ConversationLimitError();
    }

    for (const row of block.rows) {
      if (row.length > CONVERSATION_LIMITS.tableColumns) {
        throw new ConversationLimitError();
      }
      cells += row.length;
      characters += row.reduce((total, cell) => total + cell.length, 0);
      if (cells > CONVERSATION_LIMITS.tableCells) {
        throw new ConversationLimitError();
      }
    }
    return characters;
  }

  if (block.type === "code") {
    return block.code.length + (block.language?.length ?? 0);
  }

  if (block.type === "math") {
    return block.tex.length;
  }

  if (block.type === "image") {
    return block.alt.length + block.sourceUrl.length;
  }

  return block.text.length;
}

function toPreviewBlock(block: MessageBlock): MessageBlock {
  if (block.type === "visual") return { ...block, text: truncate(block.text, 2_000) };
  if (block.type === "table") {
    return {
      type: "table",
      ...(block.inlineFormat ? { inlineFormat: block.inlineFormat } : {}),
      headers: block.headers.slice(0, 6).map((cell) => truncate(cell, 500)),
      rows: block.rows.slice(0, 10).map((row) =>
        row.slice(0, 6).map((cell) => truncate(cell, 500))
      )
    };
  }

  if (block.type === "code") {
    return { ...block, code: truncate(block.code, 4_000) };
  }

  if (block.type === "math") {
    return { ...block, tex: truncate(block.tex, 2_000) };
  }

  if (block.type === "image") {
    return { ...block, alt: truncate(block.alt, 500), sourceUrl: "" };
  }

  return { ...block, text: truncate(block.text, 2_000) };
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

export function providerDisplayName(provider: Provider): string {
  if (provider === "chatgpt") {
    return "ChatGPT";
  }

  if (provider === "claude") {
    return "Claude";
  }

  if (provider === "deepseek") {
    return "DeepSeek";
  }

  if (provider === "gemini") {
    return "Gemini";
  }

  if (provider === "copilot") {
    return "Copilot";
  }

  if (provider === "perplexity") {
    return "Perplexity";
  }

  return "Grok";
}
