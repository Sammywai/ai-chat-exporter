import assert from "node:assert/strict";
import test from "node:test";

import { extractChatGptConversation } from "../dist/adapters/chatgpt.js";

test("extracts visible ChatGPT user and assistant messages into the shared model", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "Launch plan - ChatGPT",
    querySelectorAll() {
      return [
        message("user", "u-1", "Build a public chat exporter."),
        message("assistant", "a-1", "Start with a local-only extension.")
      ];
    }
  };

  try {
    assert.deepEqual(await extractChatGptConversation(), {
      provider: "chatgpt",
      title: "Launch plan",
      messages: [
        {
          id: "u-1",
          role: "user",
          blocks: [{ type: "paragraph", text: "Build a public chat exporter." }]
        },
        {
          id: "a-1",
          role: "assistant",
          blocks: [{ type: "paragraph", text: "Start with a local-only extension." }]
        }
      ]
    });
  } finally {
    globalThis.document = originalDocument;
  }
});

test("preserves headings, paragraphs, list items, and code blocks from an assistant answer", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "Development setup - ChatGPT",
    querySelectorAll() {
      return [
        message("assistant", "a-1", "Fallback text", [
          block("H2", "Check Node.js"),
          block("P", "Open a terminal."),
          codeBlock("powershell", "node --version"),
          block("LI", "Run the checks after changing the configuration.")
        ])
      ];
    }
  };

  try {
    assert.deepEqual(await extractChatGptConversation(), {
      provider: "chatgpt",
      title: "Development setup",
      messages: [
        {
          id: "a-1",
          role: "assistant",
          blocks: [
            { type: "heading", level: 2, text: "Check Node.js" },
            { type: "paragraph", text: "Open a terminal." },
            { type: "code", language: "powershell", code: "node --version" },
            {
              type: "paragraph",
              text: "- Run the checks after changing the configuration."
            }
          ]
        }
      ]
    });
  } finally {
    globalThis.document = originalDocument;
  }
});

test("preserves tables and avoids duplicating a paragraph inside a list item", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "Product comparison - ChatGPT",
    querySelectorAll() {
      const listItem = block("LI", "Use a clarifying shampoo weekly.");
      const nestedParagraph = { ...block("P", "Use a clarifying shampoo weekly."), parentElement: listItem };
      return [
        message("assistant", "a-1", "Fallback text", [
          listItem,
          nestedParagraph,
          tableBlock(
            ["Product", "Best for"],
            [["Volumetry", "Fine hair"], ["Volume Dust", "Texture"]]
          )
        ])
      ];
    }
  };

  try {
    assert.deepEqual(await extractChatGptConversation(), {
      provider: "chatgpt",
      title: "Product comparison",
      messages: [
        {
          id: "a-1",
          role: "assistant",
          blocks: [
            { type: "paragraph", text: "- Use a clarifying shampoo weekly." },
            {
              type: "table",
              headers: ["Product", "Best for"],
              rows: [["Volumetry", "Fine hair"], ["Volume Dust", "Texture"]]
            }
          ]
        }
      ]
    });
  } finally {
    globalThis.document = originalDocument;
  }
});

test("captures older ChatGPT turns from a virtualized scroll container", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const body = {};
  const scroller = {
    tagName: "DIV",
    parentElement: body,
    scrollTop: 80,
    scrollHeight: 1_000,
    clientHeight: 100
  };
  const older = message("user", "u-1", "The first question.");
  const newer = message("assistant", "a-1", "The most recent answer.");
  newer.parentElement = scroller;

  globalThis.window = {
    setTimeout(resolve) {
      resolve();
      return 1;
    }
  };
  globalThis.getComputedStyle = () => ({ overflowY: "auto" });
  globalThis.document = {
    body,
    scrollingElement: scroller,
    title: "Virtualized chat - ChatGPT",
    querySelectorAll() {
      return scroller.scrollTop === 0 ? [older, newer] : [newer];
    }
  };

  try {
    const conversation = await extractChatGptConversation();

    assert.deepEqual(conversation?.messages.map((message) => message.id), ["u-1", "a-1"]);
    assert.equal(scroller.scrollTop, 80);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

function message(role, id, text, blocks = []) {
  return {
    innerText: text,
    parentElement: undefined,
    querySelectorAll() {
      return blocks;
    },
    getAttribute(name) {
      if (name === "data-message-author-role") return role;
      if (name === "data-message-id") return id;
      return null;
    }
  };
}

function block(tagName, text) {
  return {
    tagName,
    innerText: text,
    textContent: text,
    querySelector() {
      return null;
    }
  };
}

function tableBlock(headers, rows) {
  return {
    ...block("TABLE", ""),
    querySelectorAll(selector) {
      if (selector !== "tr") return [];
      return [
        tableRow(headers.map((text) => tableCell("TH", text))),
        ...rows.map((row) => tableRow(row.map((text) => tableCell("TD", text))))
      ];
    }
  };
}

function tableRow(cells) {
  return {
    querySelectorAll(selector) {
      return selector === "th,td" ? cells : [];
    }
  };
}

function tableCell(tagName, innerText) {
  return { tagName, innerText };
}

function codeBlock(language, code) {
  return {
    ...block("PRE", code),
    querySelector(selector) {
      if (selector !== "code") return null;
      return {
        className: `language-${language}`,
        textContent: code
      };
    }
  };
}
