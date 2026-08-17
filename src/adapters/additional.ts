import type { ConversationDraft, ConversationMessage } from "../core/conversation.js";

export type AdditionalProvider = "gemini" | "copilot" | "perplexity" | "grok";

export function extractAdditionalConversation(provider: AdditionalProvider): ConversationDraft | null {
  const config = {
    gemini: { selector: "user-query, model-response", titleSuffix: "Gemini" },
    copilot: {
      selector: "[data-message-author-role], [data-role='user'], [data-role='assistant'], [data-testid*='message'], [data-testid*='turn'], cib-chat-turn",
      titleSuffix: "Copilot"
    },
    perplexity: {
      selector: "[data-message-author-role], [data-role='user'], [data-role='assistant'], [data-testid*='message'], [data-testid*='answer']",
      titleSuffix: "Perplexity"
    },
    grok: {
      selector: "[data-message-author-role], [data-role='user'], [data-role='assistant'], [data-testid='message'], [data-testid*='message']",
      titleSuffix: "Grok"
    }
  }[provider];

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
      if (isNestedBlock) continue;

      const text = textWithInlineEmphasis(blockElement);
      if (!text && blockElement.tagName !== "TABLE") continue;

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
        const rows = Array.from(blockElement.querySelectorAll<HTMLElement>("tr"))
          .map((row) => Array.from(row.querySelectorAll<HTMLElement>("th,td")))
          .map((cells) => cells.map((cell) => cell.innerText.trim()).filter(Boolean))
          .filter((cells) => cells.length > 0);
        if (rows.length > 0) {
          blocks.push({ type: "table", headers: rows[0], rows: rows.slice(1) });
        }
        continue;
      }

      const heading = blockElement.tagName.match(/^H([1-6])$/);
      if (heading) {
        blocks.push({ type: "heading", level: Number(heading[1]), text: text.replace(/\*\*/g, "") });
        continue;
      }

      blocks.push({ type: "paragraph", text: blockElement.tagName === "LI" ? `- ${text}` : text });
    }

    if (blocks.length > 0) return blocks;

    return element.innerText
      .split(/\n\s*\n/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ type: "paragraph" as const, text }));
  }

  function getRole(element: HTMLElement): ConversationMessage["role"] | null {
    const explicitRole = [
      element.getAttribute("data-message-author-role"),
      element.getAttribute("data-role"),
      element.getAttribute("role")
    ].find((value) => value === "user" || value === "assistant");
    if (explicitRole === "user" || explicitRole === "assistant") return explicitRole;

    const identity = [
      element.tagName,
      typeof element.className === "string" ? element.className : "",
      element.getAttribute("data-testid") ?? ""
    ].join(" ").toLowerCase();
    if (provider === "gemini") {
      if (identity.includes("user-query")) return "user";
      if (identity.includes("model-response")) return "assistant";
    }
    if (/user|question|prompt|request/.test(identity)) return "user";
    if (/assistant|answer|response|model|bot/.test(identity)) return "assistant";
    return null;
  }

  function getContent(element: HTMLElement, role: ConversationMessage["role"]): HTMLElement {
    const contentSelectors = role === "user"
      ? ".query-text, [data-testid*='query'], [class*='user-message'], [class*='prompt']"
      : ".model-response-text, [data-testid*='answer'], [data-testid*='response'], .markdown, [class*='prose'], [class*='response']";
    const candidates = Array.from(element.querySelectorAll<HTMLElement>(contentSelectors));
    return candidates.at(-1) ?? element;
  }

  const messages = Array.from(document.querySelectorAll<HTMLElement>(config.selector))
    .map((element, index): ConversationMessage | null => {
      const role = getRole(element);
      if (!role) return null;
      const blocks = extractMessageBlocks(getContent(element, role));
      if (blocks.length === 0) return null;
      return {
        id: element.getAttribute("data-message-id") ?? `additional-message-${index + 1}`,
        role,
        blocks
      };
    })
    .filter((message): message is ConversationMessage => message !== null);

  if (messages.length === 0) return null;

  return {
    provider,
    title: document.title.replace(new RegExp(`\\s+-\\s+${config.titleSuffix}\\s*$`, "i"), "").trim()
      || `${config.titleSuffix} conversation`,
    messages
  };
}
