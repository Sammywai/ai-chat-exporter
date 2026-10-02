import type { ConversationDraft, ConversationMessage, MessageBlock, Provider } from "../core/conversation.js";

export interface CaptureOptions {
  mode: "preview" | "complete";
  jobId?: string;
  timeoutMs?: number;
  pollMs?: number;
  quietMs?: number;
  settleMs?: number;
  requireOwner?: boolean;
}

export type CaptureResult =
  | { status: "captured"; conversation: ConversationDraft; boundariesReached: boolean }
  | { status: "empty" | "failed" | "cancelled" | "busy"; message: string };

// Chrome serializes this function. Keep all runtime helpers inside it.
export async function captureConversation(provider: Provider, options: CaptureOptions): Promise<CaptureResult> {
  const configs = {
    chatgpt: { name: "ChatGPT", selector: "[data-message-author-role], li[data-message-role], [data-chatgpt-search-unit-key$=':user'], [data-chatgpt-search-unit-key$=':assistant']" },
    gemini: { name: "Gemini", selector: "user-query, model-response" },
    claude: { name: "Claude", selector: ".font-user-message, .font-claude-message" },
    deepseek: { name: "DeepSeek", selector: "div.dad65929, div._4f9bf79, div.fbb737a4" },
    copilot: { name: "Copilot", selector: "[data-message-author-role], [data-role='user'], [data-role='assistant'], [data-testid*='message'], [data-testid*='turn'], cib-chat-turn" },
    perplexity: { name: "Perplexity", selector: "[data-message-author-role], [data-role='user'], [data-role='assistant'], [data-testid*='message'], [data-testid*='answer']" },
    grok: { name: "Grok", selector: "[data-message-author-role], [data-role='user'], [data-role='assistant'], [data-testid*='message']" }
  };
  const config = configs[provider];
  const state = window as typeof window & { __aiChatCapture?: { id: string; cancelled: boolean }; __aiChatCancelledJobId?: string };
  const jobId = options.jobId ?? "capture";
  const started = Date.now();
  const originalUrl = location.href;
  const pollMs = Math.max(10, options.pollMs ?? 40);
  const quietMs = Math.max(pollMs * 2, options.quietMs ?? 2_000);
  const timeoutMs = options.timeoutMs ?? 600_000;
  const messages: ConversationMessage[] = [];
  const byId = new Map<string, ConversationMessage>();
  const nodeIds = new WeakMap<HTMLElement, { id: string; signature: string }>();
  let previous: Array<{ signature: string; id: string; position: number }> = [];
  let nextId = 1;
  let lastCapturedSignature = "";
  let scroller: HTMLElement | null = null;
  let originalTop = 0;
  let originalBehavior = "";
  let originalBehaviorPriority = "";
  let originalSnap = "";
  let originalSnapPriority = "";
  let reverseScroll = false;
  let lastProgressAt = 0;
  let lastProgressPhase = "";
  let lastProgressCount = -1;
  let lastOwnerAck = started;
  let hadInitialMessages = false;

  function scrollEnd(): number {
    return scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
  }

  // A column-reverse viewport uses [-extent, 0]. Keep the scan and geometry
  // in chronological top-to-bottom coordinates; restoration uses the raw value.
  function scrollPosition(): number {
    return scroller ? scroller.scrollTop + (reverseScroll ? scrollEnd() : 0) : 0;
  }

  function scrollTo(position: number): void {
    if (scroller) scroller.scrollTop = position - (reverseScroll ? scrollEnd() : 0);
  }

  function check(): void {
    if (state.__aiChatCapture?.id === jobId && state.__aiChatCapture.cancelled) throw new Error("cancelled");
    if (location.href !== originalUrl) throw new Error("Conversation changed during scanning. Return to the original chat and retry.");
    if (Date.now() - started > timeoutMs) throw new Error("Scan timed out before both ends settled. No incomplete file was saved. Keep the chat loaded and retry.");
    if (options.requireOwner && Date.now() - lastOwnerAck > 5_000) throw new Error("Export workspace closed or became unavailable. Scan stopped; no file was saved.");
  }

  function progress(phase: string): void {
    const now = Date.now();
    if (phase === lastProgressPhase && messages.length === lastProgressCount && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    lastProgressPhase = phase;
    lastProgressCount = messages.length;
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      void chrome.runtime.sendMessage({ type: "capture-progress", jobId, phase, messageCount: messages.length }).then((response) => {
        if (response && typeof response === "object" && "alive" in response && response.alive === true) lastOwnerAck = Date.now();
      }).catch(() => {});
    }
  }

  function roleFor(element: HTMLElement): ConversationMessage["role"] | null {
    const explicit = element.getAttribute("data-message-author-role") ?? element.getAttribute("data-message-role") ?? element.getAttribute("data-role");
    if (explicit === "user" || explicit === "assistant" || explicit === "system") return explicit;
    if (provider === "chatgpt") {
      const keyedRole = element.getAttribute("data-chatgpt-search-unit-key")?.match(/:(user|assistant)$/)?.[1];
      if (keyedRole === "user" || keyedRole === "assistant") return keyedRole;
    }
    const identity = `${element.tagName} ${element.className} ${element.getAttribute("data-testid") ?? ""}`.toLowerCase();
    if (provider === "deepseek") return element.querySelector(".ds-markdown") ? "assistant" : "user";
    if (/user-query|font-user-message|user|question|prompt|request/.test(identity)) return "user";
    if (/model-response|font-claude-message|assistant|answer|response|model|bot/.test(identity)) return "assistant";
    return null;
  }

  function elements(): HTMLElement[] {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(config.selector));
    // Provider selectors may match wrappers and their content. Extract each turn once.
    const matched = new Set(candidates);
    return candidates.filter((element) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        if (matched.has(ancestor)) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }

  function inline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\\/g, "\\\\").replace(/([`\[\]<>$])/g, "\\$1").replace(/^(\s{0,3})(#{1,6}|>|[-+*]|\d+[.)])(?=\s)/gm, "$1\\$2");
    if (!(node instanceof HTMLElement)) return "";
    if (node.matches("button,script,style,svg,[aria-hidden='true']")) return "";
    const tex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent;
    if (node.matches(".katex, .katex-display, [data-math]") && tex) return `$${tex.replace(/([\[\]<>$])/g, "\\$1")}$`;
    if (node.tagName === "BR") return "\n";
    if (node.tagName === "CODE") {
      const code = node.textContent ?? "";
      const longest = Array.from(code.matchAll(/`+/g)).reduce((max, match) => Math.max(max, match[0].length), 0);
      const fence = "`".repeat(longest + 1);
      return `${fence} ${code} ${fence}`;
    }
    const text = Array.from(node.childNodes).map(inline).join("");
    if (node.matches("strong,b")) return `**${text}**`;
    if (node.matches("em,i")) return `*${text}*`;
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) return `[${text}](${href.replace(/[()\s<>\\]/g, (character) => character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character))})`;
    }
    return text;
  }

  function blocksFor(element: HTMLElement, role: ConversationMessage["role"]): MessageBlock[] {
    const selector = provider === "gemini"
      ? (role === "user" ? ".query-text" : ".model-response-text, .markdown")
      : provider === "deepseek" ? ".ds-markdown, .fbb737a4"
      : ".markdown, .prose, [class*='markdown']";
    const content = element.querySelector<HTMLElement>(selector) ?? element;
    let clone = content.cloneNode(true) as HTMLElement;
    if (provider === "chatgpt" && role === "user") {
      // Some ChatGPT layouts render the prompt itself as a button. Preserve
      // only that explicit content marker; ordinary action buttons still go.
      if (clone.matches("button[data-user-message-bubble]")) {
        const wrapper = document.createElement("div");
        wrapper.append(...clone.childNodes);
        clone = wrapper;
      }
      clone.querySelectorAll("button[data-user-message-bubble]").forEach(button => button.replaceWith(...button.childNodes));
    }
    clone.querySelectorAll("button,script,style,svg,[aria-hidden='true'],.sr-only,.code-block-decoration,[data-testid='copy-turn-action-button']").forEach((node) => node.remove());
    const blocks: MessageBlock[] = [];
    // A recursive walk preserves text outside paragraphs and skips descendants of
    // atomic blocks, preventing duplicate list, table and math output.
    function visit(node: Node): void {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? "").trim();
        if (text) blocks.push({ type: "paragraph", text });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === "PRE") {
        const code = node.querySelector("code");
        const language = code?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1];
        blocks.push({ type: "code", code: (code?.textContent ?? node.textContent ?? "").replace(/\n$/, ""), ...(language ? { language } : {}) });
        return;
      }
      if (node.tagName === "TABLE") {
        const rows = Array.from(node.querySelectorAll("tr")).map((row) =>
          Array.from(row.querySelectorAll("th,td")).map((cell) => inline(cell).trim())
        ).filter((row) => row.length > 0);
        if (rows.length) blocks.push({ type: "table", headers: rows[0], rows: rows.slice(1), inlineFormat: "markdown" });
        return;
      }
      if (node.matches(".katex-display, [data-math-display]")) {
        const tex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent ?? node.getAttribute("data-math-display");
        if (tex) { blocks.push({ type: "math", tex, display: true }); return; }
      }
      if (node.tagName === "IMG") {
        const src = node.getAttribute("src") ?? "";
        if (/^(https?:|data:image\/)/i.test(src)) blocks.push({ type: "image", alt: node.getAttribute("alt") ?? "Image", sourceUrl: src });
        return;
      }
      const heading = node.tagName.match(/^H([1-6])$/);
      if (heading || node.matches("p,li,blockquote")) {
        // Leave compound content to the walker so code/tables are not flattened.
        if (!node.querySelector("pre,table,.katex-display,img")) {
          const text = inline(node).trim();
          if (text) blocks.push(heading
            ? { type: "heading", level: Number(heading[1]), text: (node.textContent ?? "").trim() }
            : { type: "paragraph", text: `${node.tagName === "LI" ? "- " : node.tagName === "BLOCKQUOTE" ? "> " : ""}${text}`, inlineFormat: "markdown" });
          return;
        }
      }
      const children = Array.from(node.childNodes);
      // Inline-only divs are common in user prompts and Gemini responses.
      if (!node.querySelector("h1,h2,h3,h4,h5,h6,p,li,pre,table,div,img,.katex-display") && children.length) {
        const text = inline(node).trim();
        if (text) blocks.push({ type: "paragraph", text, inlineFormat: "markdown" });
        return;
      }
      children.forEach(visit);
    }
    visit(clone);
    return blocks;
  }

  function stableId(element: HTMLElement, role: string): string | null {
    const messageId = element.getAttribute("data-message-id");
    if (messageId) return messageId;
    const turn = element.closest<HTMLElement>("[data-turn-key], [data-turn-id], [data-testid^='conversation-turn-'], .conversation-container, [id^='turn-']");
    const turnId = turn?.getAttribute("data-turn-key") ?? turn?.getAttribute("data-turn-id") ?? turn?.getAttribute("data-testid") ?? turn?.id;
    return turnId ? `${turnId}:${role}` : element.getAttribute("data-chatgpt-search-unit-key") || (element.id ? `${element.id}:${role}` : null);
  }

  function snapshot(): Array<{ message: ConversationMessage; signature: string; stable: boolean; position: number }> {
    const raw = elements().flatMap((element) => {
      const role = roleFor(element);
      if (!role) return [];
      const blocks = blocksFor(element, role);
      if (!blocks.length) return [];
      const signature = JSON.stringify([role, blocks]);
      const stable = stableId(element, role);
      const knownNode = nodeIds.get(element);
      const id = stable ?? (knownNode?.signature === signature ? knownNode.id : "");
      const position = Math.round(element.getBoundingClientRect().top + scrollPosition());
      return [{ element, message: { id, role, blocks }, signature, stable: stable !== null, position }];
    });
    // Stitch overlapping windows by sequence, not by text-set membership.
    // Repeated prompts and identical answers must remain distinct turns.
    let offset = 0;
    let bestOverlap = 0;
    const signatureCounts = new Map<string, number>();
    previous.forEach((item) => signatureCounts.set(item.signature, (signatureCounts.get(item.signature) ?? 0) + 1));
    for (let start = 0; start < previous.length; start++) {
      let overlap = 0;
      while (start + overlap < previous.length && overlap < raw.length &&
        previous[start + overlap].signature === raw[overlap].signature &&
        // Identical repeated windows require geometry to disambiguate.
        (previous[start + overlap].position === raw[overlap].position ||
          signatureCounts.get(raw[overlap].signature) === 1) &&
        (!raw[overlap].message.id || raw[overlap].message.id === previous[start + overlap].id)) overlap++;
      if (overlap > bestOverlap) { offset = start; bestOverlap = overlap; }
    }
    for (let index = 0; index < raw.length; index++) {
      const item = raw[index];
      if (!item.message.id) item.message.id = index < bestOverlap ? previous[offset + index].id : `${provider}-captured-${nextId++}`;
      nodeIds.set(item.element, { id: item.message.id, signature: item.signature });
    }
    const identifiers = new Set<string>();
    for (const item of raw) {
      if (identifiers.has(item.message.id)) throw new Error("Duplicate message identifiers found. Cannot confirm message order; no incomplete file was saved.");
      identifiers.add(item.message.id);
    }
    return raw;
  }

  function capture(): void {
    const current = snapshot();
    if (!current.length) return;
    if (messages.length && current.length && previous.length &&
      !current.some((item) => byId.has(item.message.id))) {
      throw new Error("Message windows no longer overlap. Cannot confirm message order; no incomplete file was saved. Retry with the chat fully loaded.");
    }
    let insertion = messages.length;
    const nextKnownMessages: Array<ConversationMessage | undefined> = [];
    let nextKnownMessage: ConversationMessage | undefined;
    for (let index = current.length - 1; index >= 0; index--) {
      nextKnownMessages[index] = nextKnownMessage;
      nextKnownMessage = byId.get(current[index].message.id) ?? nextKnownMessage;
    }
    for (let index = 0; index < current.length; index++) {
      const { message } = current[index];
      const existing = byId.get(message.id);
      if (existing) {
        existing.blocks = message.blocks;
        insertion = messages.indexOf(existing) + 1;
      } else {
        const nextKnown = nextKnownMessages[index];
        if (nextKnown) insertion = messages.indexOf(nextKnown);
        messages.splice(insertion, 0, message);
        byId.set(message.id, message);
        insertion++;
      }
    }
    previous = current.map((item) => ({ id: item.message.id, signature: item.signature, position: item.position }));
    if (messages.length > 10_000) throw new Error("Chat exceeds 10,000 captured messages. No incomplete file was saved.");
    lastCapturedSignature = visibleSignature();
  }

  function visibleSignature(): string {
    return elements().map((element) => `${stableId(element, roleFor(element) ?? "") ?? ""}:${Math.round(element.getBoundingClientRect().top + scrollPosition())}:${element.textContent ?? ""}`).join("\u0000");
  }

  function loading(): boolean {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-testid='stop-button'], [data-testid='stop-response-button'], [data-test-id='stop-response-button'], button[aria-label*='Stop generating'], button[aria-label*='Stop response'], .loading-history, [aria-busy='true'][data-chat-loading]"))
      .some((element) => element.getClientRects().length > 0);
  }

  function mountedArea(turns: HTMLElement[]): { root: HTMLElement; origin: number; top: number; bottom: number; paddingTop: number; paddingBottom: number } | null {
    if (!scroller) return null;
    const origin = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top + scroller.clientTop;
    // ChatGPT keeps composer clearance outside its explicit conversation root.
    // Its scrollHeight still includes any declared, unmounted virtual history;
    // never infer transcript completeness from an arbitrary blank spacer.
    const conversationRoot = provider === "chatgpt"
      ? turns.at(-1)?.closest<HTMLElement>("[data-thread-find-target='conversation'][data-chatgpt-conversation-selection-target='true']") : null;
    let root = scroller;
    if (conversationRoot && scroller.contains(conversationRoot) && conversationRoot.clientHeight > 0 &&
      turns.every((turn) => conversationRoot.contains(turn))) {
      root = conversationRoot;
      // The root can flex-fill a short chat. Its declared virtual canvas is the
      // transcript extent, including blank space reserved for unmounted turns.
      const canvases = Array.from(conversationRoot.children).filter((child): child is HTMLElement => {
        if (!(child instanceof HTMLElement) || child.tagName !== "DIV" || !/^\d+(?:\.\d+)?px$/.test(child.style.height) ||
          parseFloat(child.style.height) <= 0) return false;
        const style = getComputedStyle(child);
        return style.position === "relative" && style.flexShrink === "0";
      });
      if (canvases.length === 1 && canvases[0].clientHeight > 0 && turns.every((turn) => canvases[0].contains(turn))) {
        const canvas = canvases[0];
        const unknownSiblingExtent = Array.from(conversationRoot.children).some((child) => {
          if (child === canvas) return false;
          const siblingStyle = getComputedStyle(child);
          if (siblingStyle.display === "none") return false;
          return child.getBoundingClientRect().height > 0 || child.scrollHeight > 0 ||
            (parseFloat(siblingStyle.marginTop) || 0) > 0 || (parseFloat(siblingStyle.marginBottom) || 0) > 0;
        });
        if (!unknownSiblingExtent) root = canvas;
      }
    }
    const style = getComputedStyle(root);
    const top = root === scroller ? 0 : root.getBoundingClientRect().top + root.clientTop - origin + scrollPosition();
    return { root, origin, top, bottom: top + root.scrollHeight,
      paddingTop: parseFloat(style.paddingTop) || 0, paddingBottom: parseFloat(style.paddingBottom) || 0 };
  }

  function mountedBox(turn: HTMLElement, root: HTMLElement): HTMLElement {
    const box = turn.closest<HTMLElement>("[data-turn-key], [data-turn-id], [data-testid^='conversation-turn-'], .conversation-container, article");
    return box && root.contains(box) ? box : turn;
  }

  // Full-DOM chats can be checked at both boundaries without walking every
  // viewport. Virtual windows leave uncovered geometry and take the normal path.
  function mountedAcrossScrollArea(): boolean {
    if (!scroller) return false;
    const turns = elements();
    if (!turns.length) return false;
    const area = mountedArea(turns);
    if (!area) return false;
    const boxes = turns.map((turn) => mountedBox(turn, area.root));
    const commonParent = boxes[boxes.length - 1].parentElement;
    const commonStyle = commonParent && commonParent !== area.root && area.root.contains(commonParent) && boxes.every((turn) => commonParent.contains(turn))
      ? getComputedStyle(commonParent) : null;
    const parentPadding = parseFloat(commonStyle?.paddingBottom ?? "0") || 0;
    const bottomPadding = area.paddingBottom + parentPadding;
    let coveredUntil = area.top;
    let previousMargin = area.paddingTop + (parseFloat(commonStyle?.paddingTop ?? "0") || 0);
    for (const element of boxes) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const top = rect.top - area.origin + scrollPosition();
      const bottom = rect.bottom - area.origin + scrollPosition();
      // Account only for declared spacing, never a missing viewport of turns.
      if (top > coveredUntil + previousMargin + (parseFloat(style.marginTop) || 0) + 1 || bottom < coveredUntil) return false;
      coveredUntil = bottom;
      previousMargin = parseFloat(style.marginBottom) || 0;
    }
    return coveredUntil >= area.bottom - bottomPadding - previousMargin - 1;
  }

  function mountedViewportCovered(): boolean {
    if (!scroller) return false;
    const turns = elements();
    if (!turns.length) return false;
    const area = mountedArea(turns);
    if (!area) return false;
    const viewportTop = Math.max(area.origin, area.origin + area.top - scrollPosition());
    const viewportBottom = Math.min(area.origin + scroller.clientHeight, area.origin + area.bottom - scrollPosition());
    if (viewportBottom <= viewportTop) return false;
    const middle = (viewportTop + viewportBottom) / 2;
    // Allow normal chat padding while requiring content in both halves of the
    // viewport. A delayed window cannot be advanced out of view repeatedly.
    return turns[0].getBoundingClientRect().top <= middle &&
      turns[turns.length - 1].getBoundingClientRect().bottom >= middle;
  }

  function mountedEndCovered(): boolean {
    if (!scroller) return false;
    const turns = elements();
    const turn = turns.at(-1);
    if (!turn) return messages.length === 0;
    const area = mountedArea(turns);
    if (!area) return false;
    const box = mountedBox(turn, area.root);
    const parentPadding = box.parentElement && box.parentElement !== area.root && area.root === scroller && area.root.contains(box.parentElement)
      ? parseFloat(getComputedStyle(box.parentElement).paddingBottom) || 0 : 0;
    const bottomSpacing = parentPadding + area.paddingBottom +
      (parseFloat(getComputedStyle(box).marginBottom) || 0);
    return box.getBoundingClientRect().bottom - area.origin + scrollPosition() >= area.bottom - bottomSpacing - 1;
  }

  function mountedStartCovered(): boolean {
    if (!scroller) return false;
    const turns = elements();
    const turn = turns[0];
    if (!turn) return !hadInitialMessages;
    const area = mountedArea(turns);
    if (!area) return false;
    const box = mountedBox(turn, area.root);
    const parentPadding = box.parentElement && box.parentElement !== area.root && area.root === scroller && area.root.contains(box.parentElement)
      ? parseFloat(getComputedStyle(box.parentElement).paddingTop) || 0 : 0;
    const topSpacing = parentPadding + area.paddingTop +
      (parseFloat(getComputedStyle(box).marginTop) || 0);
    return box.getBoundingClientRect().top - area.origin + scrollPosition() <= area.top + topSpacing + 1;
  }

  async function settle(boundary: boolean, phase: string, collect: boolean, beforeScroll?: string): Promise<void> {
    let last = "";
    let quietSince = Date.now();
    const waitingSince = Date.now();
    for (;;) {
      check();
      await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
      check();
      const visible = visibleSignature();
      const area = mountedArea(elements());
      const windowReady = boundary ? (collect ? mountedEndCovered() : scrollPosition() > 1 || mountedStartCovered()) :
        beforeScroll === undefined || visible !== beforeScroll || mountedViewportCovered();
      const signature = `${scrollPosition()}:${scroller?.scrollHeight}:${area?.top}:${area?.bottom}:${area?.paddingTop}:${area?.paddingBottom}:${windowReady}:${visible}`;
      if (signature !== last || loading()) quietSince = Date.now();
      last = signature;
      // Rendered virtual windows may arrive asynchronously after a scroll.
      // Changed DOM can settle promptly; unchanged windows retain a 600 ms
      // fallback so delayed rendering cannot be outrun by repeated scrolling.
      const renderChanged = beforeScroll === undefined || visible !== beforeScroll;
      const minimumWait = Math.max(options.settleMs ?? 120, !boundary && !renderChanged ? 600 : 0);
      // A stale virtual window must never be advanced past the viewport. Keep
      // waiting for its asynchronous replacement rather than resetting its
      // render timer with another scroll and losing overlap.
      // A viewport can still overlap a stale window at the final scroll point.
      // Require the actual last extent before claiming a complete capture.
      if (windowReady && Date.now() - quietSince >= (boundary ? quietMs : Math.max(80, pollMs * 2)) &&
        Date.now() - waitingSince >= minimumWait) {
        if (collect && visible !== lastCapturedSignature) capture();
        progress(phase);
        return;
      }
      progress(phase);
    }
  }

  function conversation(): ConversationDraft {
    return {
      provider,
      title: document.title.replace(new RegExp(`\\s+[-–|]\\s+${config.name}\\s*$`, "i"), "").trim() || `${config.name} conversation`,
      messages
    };
  }

  if (options.mode === "preview") {
    capture();
    return messages.length ? { status: "captured", conversation: conversation(), boundariesReached: false }
      : { status: "empty", message: `No visible ${config.name} messages found. Open a conversation and wait for it to load.` };
  }
  if (state.__aiChatCancelledJobId === jobId) {
    delete state.__aiChatCancelledJobId;
    return { status: "cancelled", message: "Export cancelled. No file was saved." };
  }
  if (options.requireOwner && (typeof chrome === "undefined" || !chrome.runtime?.sendMessage)) {
    return { status: "failed", message: "Export workspace connection is unavailable. Reopen the extension and retry." };
  }
  if (state.__aiChatCapture) return { status: "busy", message: "This chat is already being scanned. Cancel or finish that export first." };
  state.__aiChatCapture = { id: jobId, cancelled: false };
  try {
    const lastElement = elements().at(-1);
    hadInitialMessages = lastElement !== undefined;
    let ancestor = lastElement?.parentElement;
    while (ancestor) {
      if (ancestor.clientHeight > 0 && ancestor.scrollHeight > ancestor.clientHeight && /auto|scroll/.test(getComputedStyle(ancestor).overflowY)) {
        scroller = ancestor;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    scroller ??= document.scrollingElement as HTMLElement | null;
    if (!scroller || scroller.clientHeight <= 0) throw new Error("Chat scroll area is unavailable. Expand the chat tab and retry.");
    originalTop = scroller.scrollTop;
    originalBehavior = scroller.style.getPropertyValue("scroll-behavior");
    originalBehaviorPriority = scroller.style.getPropertyPriority("scroll-behavior");
    originalSnap = scroller.style.getPropertyValue("scroll-snap-type");
    originalSnapPriority = scroller.style.getPropertyPriority("scroll-snap-type");
    const scrollStyle = getComputedStyle(scroller);
    reverseScroll = /^(inline-)?flex$/.test(scrollStyle.display) && scrollStyle.flexDirection === "column-reverse";
    scroller.style.setProperty("scroll-behavior", "auto", "important");
    // Native snap targets can clamp a requested scroll before either boundary.
    scroller.style.setProperty("scroll-snap-type", "none", "important");
    progress("Finding first message");
    // No messages have been captured yet, so jumping to the start cannot lose
    // overlap. Lazy prepends can move the scroll position; settle and repeat.
    do {
      check();
      const before = scrollPosition();
      const beforeScroll = before > 1 ? visibleSignature() : undefined;
      scrollTo(0);
      if (before > 1 && scrollPosition() >= before) throw new Error("Chat scrolling stopped before reaching the beginning. No incomplete file was saved.");
      await settle(true, "Waiting for older messages", false, beforeScroll);
    } while (scrollPosition() > 1);
    capture();
    if (mountedAcrossScrollArea()) {
      scrollTo(scrollEnd());
      // The normal end check below still waits for updates and captures again;
      // the geometry check only skips unnecessary intermediate scroll steps.
    }
    for (;;) {
      check();
      const before = scrollPosition();
      const end = scrollEnd();
      if (before >= end - 1) {
        await settle(true, "Checking last message", true);
        if (scrollPosition() >= scrollEnd() - 1) break;
      } else {
        const beforeScroll = visibleSignature();
        scrollTo(Math.min(end, before + Math.max(1, scroller.clientHeight * 0.6)));
        await settle(false, "Scanning messages", true, beforeScroll);
        // Layout can shrink while settling and clamp us at its new endpoint.
        // The boundary pass still verifies that the last message is mounted.
        if (scrollPosition() <= before && scrollPosition() < scrollEnd() - 1) throw new Error("Chat scrolling stopped before reaching the end. No incomplete file was saved.");
      }
    }
    return messages.length ? { status: "captured", conversation: conversation(), boundariesReached: true }
      : { status: "empty", message: `No ${config.name} messages found. This page layout may be unsupported.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversation scan failed.";
    return message === "cancelled" ? { status: "cancelled", message: "Export cancelled. No file was saved." }
      : { status: "failed", message };
  } finally {
    if (scroller) {
      if (location.href === originalUrl) scroller.scrollTop = originalTop;
      if (originalBehavior) scroller.style.setProperty("scroll-behavior", originalBehavior, originalBehaviorPriority);
      else scroller.style.removeProperty("scroll-behavior");
      if (originalSnap) scroller.style.setProperty("scroll-snap-type", originalSnap, originalSnapPriority);
      else scroller.style.removeProperty("scroll-snap-type");
    }
    if (state.__aiChatCapture?.id === jobId) delete state.__aiChatCapture;
    if (state.__aiChatCancelledJobId === jobId) delete state.__aiChatCancelledJobId;
  }
}

export function cancelCapture(jobId: string): void {
  const state = window as typeof window & { __aiChatCapture?: { id: string; cancelled: boolean }; __aiChatCancelledJobId?: string };
  if (state.__aiChatCapture?.id === jobId) state.__aiChatCapture.cancelled = true;
  else state.__aiChatCancelledJobId = jobId;
}
