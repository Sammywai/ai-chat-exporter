import type { ConversationDraft, ConversationMessage } from "../core/conversation.js";

export function extractDeepSeekConversation(): ConversationDraft | null {
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
      let ancestor = blockElement.parentElement;
      let isNestedBlock = false;
      while (ancestor && ancestor !== element) {
        if (ancestor.tagName === "LI" || ancestor.tagName === "PRE") {
          isNestedBlock = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (isNestedBlock) continue;

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
    document.querySelectorAll<HTMLElement>("div.dad65929, div._4f9bf79, div.fbb737a4")
  )
    .map((element, index): ConversationMessage | null => {
      const assistantContent = Array.from(
        element.querySelectorAll<HTMLElement>(".ds-markdown")
      ).at(-1);
      const content = assistantContent ?? element.querySelector<HTMLElement>(".fbb737a4") ?? element;
      const blocks = extractMessageBlocks(content);
      if (blocks.length === 0) return null;

      return {
        id: element.getAttribute("data-message-id") ?? `deepseek-message-${index + 1}`,
        role: assistantContent ? "assistant" : "user",
        blocks
      };
    })
    .filter((message): message is ConversationMessage => message !== null);

  if (messages.length === 0) return null;

  return {
    provider: "deepseek",
    title: document.title.replace(/\s+-\s+DeepSeek\s*$/i, "").trim() || "DeepSeek conversation",
    messages
  };
}
