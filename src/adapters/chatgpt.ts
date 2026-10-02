import type { ConversationDraft, ConversationMessage } from "../core/conversation.js";

export async function extractChatGptConversation(): Promise<ConversationDraft | null> {
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
      element.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,pre,table")
    );
    const blocks: ConversationMessage["blocks"] = [];

    for (const blockElement of blockElements) {
      let ancestor = blockElement.parentElement;
      let isNestedBlock = false;
      while (ancestor && ancestor !== element) {
        if (ancestor.tagName === "LI" || ancestor.tagName === "PRE" || ancestor.tagName === "TABLE") {
          isNestedBlock = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (isNestedBlock) {
        continue;
      }

      const text = textWithInlineEmphasis(blockElement);
      if (!text && blockElement.tagName !== "TABLE") {
        continue;
      }

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

      if (blockElement.tagName === "TABLE") {
        const tableRows = Array.from(blockElement.querySelectorAll<HTMLElement>("tr"))
          .map((row) => Array.from(row.querySelectorAll<HTMLElement>("th,td")))
          .map((cells) => cells.map((cell) => cell.innerText.trim()).filter(Boolean))
          .filter((cells) => cells.length > 0);
        if (tableRows.length > 0) {
          blocks.push({
            type: "table",
            headers: tableRows[0],
            rows: tableRows.slice(1)
          });
        }
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

    if (blocks.length > 0) {
      return blocks;
    }

    return element.innerText
      .split(/\n\s*\n/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ type: "paragraph" as const, text }));
  }

  function toMessage(element: HTMLElement, index: number): ConversationMessage | null {
      const role = element.getAttribute("data-message-author-role");
      const blocks = extractMessageBlocks(element);

      if ((role !== "user" && role !== "assistant") || blocks.length === 0) {
        return null;
      }

      return {
        id: element.getAttribute("data-message-id") ?? `chatgpt-message-${index + 1}`,
        role,
        blocks
      };
  }

  const capturedMessages = new Map<string, ConversationMessage>();
  const captureVisibleMessages = () => {
    const visibleMessages = Array.from(
      document.querySelectorAll<HTMLElement>("[data-message-author-role]")
    );

    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = toMessage(visibleMessages[index], index);
      if (message && !capturedMessages.has(message.id)) {
        capturedMessages.set(message.id, message);
      }
    }
  };

  captureVisibleMessages();

  if (typeof window !== "undefined") {
    const visibleMessages = Array.from(
      document.querySelectorAll<HTMLElement>("[data-message-author-role]")
    );
    const lastMessage = visibleMessages.at(-1);
    let scrollContainer: HTMLElement | null = null;
    let ancestor = lastMessage?.parentElement;

    while (ancestor && ancestor !== document.body) {
      const style = getComputedStyle(ancestor);
      if (ancestor.scrollHeight > ancestor.clientHeight && /auto|scroll/.test(style.overflowY)) {
        scrollContainer = ancestor;
        break;
      }
      ancestor = ancestor.parentElement;
    }

    scrollContainer ??= document.scrollingElement as HTMLElement | null;
    if (scrollContainer && scrollContainer.scrollTop > 0) {
      const originalScrollTop = scrollContainer.scrollTop;

      for (let step = 0; step < 400 && scrollContainer.scrollTop > 0; step += 1) {
        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - scrollContainer.clientHeight * 0.8);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
        captureVisibleMessages();
      }

      scrollContainer.scrollTop = originalScrollTop;
    }
  }

  const messages = Array.from(capturedMessages.values()).reverse();

  if (messages.length === 0) {
    return null;
  }

  return {
    provider: "chatgpt",
    title: document.title.replace(/\s+-\s+ChatGPT\s*$/i, "").trim() || "ChatGPT conversation",
    messages
  };
}
