import assert from "node:assert/strict";
import test from "node:test";

import { extractChatGptConversation } from "../dist/adapters/chatgpt.js";

test("runs after Chrome serializes the injected extractor", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "Launch plan - ChatGPT",
    querySelectorAll() {
      return [message("assistant", "a-1", "Use the local-only path.")];
    }
  };

  try {
    const injectedExtractor = Function(`return (${extractChatGptConversation.toString()})`)();

    assert.deepEqual(await injectedExtractor(), {
      provider: "chatgpt",
      title: "Launch plan",
      messages: [
        {
          id: "a-1",
          role: "assistant",
          blocks: [{ type: "paragraph", text: "Use the local-only path." }]
        }
      ]
    });
  } finally {
    globalThis.document = originalDocument;
  }
});

function message(role, id, text) {
  return {
    innerText: text,
    querySelectorAll() {
      return [];
    },
    getAttribute(name) {
      if (name === "data-message-author-role") return role;
      if (name === "data-message-id") return id;
      return null;
    }
  };
}
