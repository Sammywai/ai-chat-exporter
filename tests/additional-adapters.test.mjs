import assert from "node:assert/strict";
import test from "node:test";

import { extractAdditionalConversation } from "../dist/adapters/additional.js";

for (const provider of ["gemini", "copilot", "perplexity", "grok"]) {
  test(`extracts ${provider} user and assistant messages`, () => {
    const originalDocument = globalThis.document;
    globalThis.document = {
      title: `Cross-platform test - ${provider[0].toUpperCase()}${provider.slice(1)}`,
      querySelectorAll() {
        return [
          message("user", "My question for the assistant."),
          message("assistant", "The assistant's final answer.")
        ];
      }
    };

    try {
      assert.deepEqual(extractAdditionalConversation(provider), {
        provider,
        title: "Cross-platform test",
        messages: [
          {
            id: "user-message",
            role: "user",
            blocks: [{ type: "paragraph", text: "My question for the assistant." }]
          },
          {
            id: "assistant-message",
            role: "assistant",
            blocks: [{ type: "paragraph", text: "The assistant's final answer." }]
          }
        ]
      });
    } finally {
      globalThis.document = originalDocument;
    }
  });
}

test("serializes the generic adapter for Chrome injection", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "Injected test - Gemini",
    querySelectorAll() {
      return [message("user", "Question")];
    }
  };

  try {
    const injectedExtractor = Function(`return (${extractAdditionalConversation.toString()})`)();
    assert.equal(injectedExtractor("gemini")?.messages[0]?.blocks[0]?.text, "Question");
  } finally {
    globalThis.document = originalDocument;
  }
});

function message(role, text) {
  return {
    innerText: text,
    parentElement: undefined,
    tagName: "DIV",
    getAttribute(name) {
      if (name === "data-role") return role;
      if (name === "data-message-id") return `${role}-message`;
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}
