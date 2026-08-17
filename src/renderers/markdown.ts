import {
  providerDisplayName,
  type Conversation,
  type ConversationMessage
} from "../core/conversation.js";

export function renderMarkdown(conversation: Conversation): string {
  const provider = providerDisplayName(conversation.provider);
  const sections = conversation.messages.map((message) => renderMessage(message, provider));

  return [`# ${escapeMarkdownText(conversation.title)}`, `> Exported locally from **${provider}**`, ...sections].join(
    "\n\n"
  ) + "\n";
}

function renderMessage(message: ConversationMessage, provider: string): string {
  const heading = message.role === "user" ? "You" : provider;
  const content = message.blocks.map(renderBlock).join("\n\n");

  return `---\n\n## ${heading}\n\n${content}`;
}

function renderBlock(block: ConversationMessage["blocks"][number]): string {
  if (block.type === "heading") {
    return `${"#".repeat(Math.min(block.level + 1, 6))} ${escapeMarkdownText(block.text)}`;
  }

  if (block.type === "code") {
    return renderCodeBlock(block.code, block.language);
  }

  if (block.type === "table") {
    const escapeCell = (cell: string) => escapeMarkdownText(cell)
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " / ");
    const headers = block.headers.map(escapeCell);
    const rows = block.rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
    return [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows
    ].join("\n");
  }

  if (block.type === "math") {
    return renderCodeBlock(block.tex, "math");
  }

  if (block.type === "image") {
    return `Image: ${escapeMarkdownText(block.alt)}`;
  }

  return escapeMarkdownText(block.text);
}

function renderCodeBlock(code: string, language?: string): string {
  const longestBacktickRun = Array.from(code.matchAll(/`+/g)).reduce(
    (maximum, match) => Math.max(maximum, match[0].length),
    0
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  const safeLanguage = language && /^[a-z0-9_+-]{1,32}$/i.test(language) ? language : "";
  return `${fence}${safeLanguage}\n${code}\n${fence}`;
}

function escapeMarkdownText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([`\[\]<>$])/g, "\\$1")
    .replace(/^(\s{0,3})(#{1,6}|>|[-+*]|\d+[.)])(?=\s)/gm, "$1\\$2");
}
