import type { ConversationDraft, ConversationMessage } from "../core/conversation.js";

export function extractClaudeConversation(): ConversationDraft | null {
  function textWithInlineEmphasis(element: HTMLElement): string {
    let text = element.innerText.trim();
    const boldElements = typeof element.querySelectorAll === "function"
      ? Array.from(element.querySelectorAll<HTMLElement>("strong,b"))
      : [];
    let searchFrom = 0;

    for (const boldElement of boldElements) {
      const boldText = boldElement.innerText.trim();
      const start = boldText ? text.indexOf(boldText, searchFrom) : -1;
      if (start === -1) continue;
      text = `${text.slice(0, start)}**${boldText}**${text.slice(start + boldText.length)}`;
      searchFrom = start + boldText.length + 4;
    }

    return text;
  }

  function extractMessageBlocks(element: HTMLElement): ConversationMessage["blocks"] {
    const blockElements = Array.from(
      element.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,pre")
    );
    const blocks: ConversationMessage["blocks"] = [];

    for (const blockElement of blockElements) {
      const text = textWithInlineEmphasis(blockElement);
      if (!text) continue;

      if (blockElement.tagName === "PRE") {
        const codeElement = blockElement.querySelector<HTMLElement>("code");
        const className = codeElement?.className ?? "";
        const language = className.match(/(?:^|\s)language-([^\s]+)/)?.[1];
        blocks.push({
          type: "code",
          ...(language ? { language } : {}),
          code: (codeElement?.textContent ?? text).trim()
        });
        continue;
      }

      const heading = blockElement.tagName.match(/^H([1-6])$/);
      if (heading) {
        blocks.push({ type: "heading", level: Number(heading[1]), text: text.replace(/\*\*/g, "") });
        continue;
      }

      blocks.push({
        type: "paragraph",
        text: blockElement.tagName === "LI" ? `- ${text}` : text
      });
    }

    if (blocks.length > 0) return blocks;

    return element.innerText
      .split(/\n\s*\n/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ type: "paragraph" as const, text }));
  }

  const messages = Array.from(
    document.querySelectorAll<HTMLElement>(".font-user-message, .font-claude-message")
  )
    .map((element, index): ConversationMessage | null => {
      const blocks = extractMessageBlocks(element);
      if (blocks.length === 0) return null;

      return {
        id: element.getAttribute("data-message-id") ?? `claude-message-${index + 1}`,
        role: element.className.includes("font-user-message") ? "user" : "assistant",
        blocks
      };
    })
    .filter((message): message is ConversationMessage => message !== null);

  if (messages.length === 0) return null;

  return {
    provider: "claude",
    title: document.title.replace(/\s+-\s+Claude\s*$/i, "").trim() || "Claude conversation",
    messages
  };
}
