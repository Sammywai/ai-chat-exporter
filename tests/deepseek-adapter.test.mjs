import assert from "node:assert/strict";
import test from "node:test";

import { extractDeepSeekConversation } from "../dist/adapters/deepseek.js";

test("extracts DeepSeek user and assistant message containers", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "VPS plan - DeepSeek",
    querySelectorAll() {
      return [
        message("u-1", textContainer("Help me set up the VPS."), null),
        message("a-1", null, textContainer("Use WSL2 and keep the dashboard private."))
      ];
    }
  };

  try {
    const injectedExtractor = Function(`return (${extractDeepSeekConversation.toString()})`)();

    assert.deepEqual(injectedExtractor(), {
      provider: "deepseek",
      title: "VPS plan",
      messages: [
        {
          id: "u-1",
          role: "user",
          blocks: [{ type: "paragraph", text: "Help me set up the VPS." }]
        },
        {
          id: "a-1",
          role: "assistant",
          blocks: [{ type: "paragraph", text: "Use WSL2 and keep the dashboard private." }]
        }
      ]
    });
  } finally {
    globalThis.document = originalDocument;
  }
});

test("captures desktop user bubbles and does not repeat text nested inside a list item", () => {
  const originalDocument = globalThis.document;
  const listItem = block("LI", "Install the SSH server.");
  const nestedParagraph = { ...block("P", "Install the SSH server."), parentElement: listItem };
  const user = message("u-1", textContainer("Install the SSH server.", [listItem, nestedParagraph]), null);
  const assistant = message("a-1", null, textContainer("Then run the connection command."));
  globalThis.document = {
    title: "Desktop chat - DeepSeek",
    querySelectorAll(selector) {
      return selector.includes("div.fbb737a4") ? [user, assistant] : [assistant];
    }
  };

  try {
    assert.deepEqual(extractDeepSeekConversation(), {
      provider: "deepseek",
      title: "Desktop chat",
      messages: [
        {
          id: "u-1",
          role: "user",
          blocks: [{ type: "paragraph", text: "- Install the SSH server." }]
        },
        {
          id: "a-1",
          role: "assistant",
          blocks: [{ type: "paragraph", text: "Then run the connection command." }]
        }
      ]
    });
  } finally {
    globalThis.document = originalDocument;
  }
});

test("preserves inline bold text for PDF and Markdown rendering", () => {
  const originalDocument = globalThis.document;
  const assistant = message(
    "a-1",
    null,
    textContainer("4.0 is the newer design.", [block("P", "4.0 is the newer design.", [boldText("4.0")])])
  );
  globalThis.document = {
    title: "Eye surgery - DeepSeek",
    querySelectorAll() {
      return [assistant];
    }
  };

  try {
    assert.deepEqual(extractDeepSeekConversation()?.messages[0]?.blocks, [
      { type: "paragraph", text: "**4.0** is the newer design." }
    ]);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("exports the final answer instead of DeepSeek's preceding reasoning panel", () => {
  const originalDocument = globalThis.document;
  const assistant = message("a-1", null, [
    textContainer("We need to reason through the user's question first."),
    textContainer("The final answer is to compare the available procedures with your doctor.")
  ]);
  globalThis.document = {
    title: "Eye surgery - DeepSeek",
    querySelectorAll() {
      return [assistant];
    }
  };

  try {
    assert.deepEqual(extractDeepSeekConversation()?.messages[0]?.blocks, [
      {
        type: "paragraph",
        text: "The final answer is to compare the available procedures with your doctor."
      }
    ]);
  } finally {
    globalThis.document = originalDocument;
  }
});

function message(id, userContent, assistantContent) {
  const assistantPanels = Array.isArray(assistantContent)
    ? assistantContent
    : assistantContent ? [assistantContent] : [];

  return {
    getAttribute(name) {
      return name === "data-message-id" ? id : null;
    },
    querySelector(selector) {
      if (selector === ".fbb737a4") return userContent;
      if (selector === ".ds-markdown") return assistantPanels[0] ?? null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === ".ds-markdown" ? assistantPanels : [];
    }
  };
}

function textContainer(text, blocks = []) {
  return {
    innerText: text,
    querySelectorAll() {
      return blocks;
    }
  };
}

function block(tagName, innerText, boldElements = []) {
  return {
    tagName,
    innerText,
    textContent: innerText,
    querySelectorAll(selector) {
      return selector === "strong,b" ? boldElements : [];
    },
    querySelector() {
      return null;
    }
  };
}

function boldText(innerText) {
  return { innerText };
}
