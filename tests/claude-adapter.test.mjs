import assert from "node:assert/strict";
import test from "node:test";

import { extractClaudeConversation } from "../dist/adapters/claude.js";

test("extracts Claude messages after Chrome serializes the injected adapter", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "VPS plan - Claude",
    querySelectorAll() {
      return [
        message("font-user-message", "u-1", "Help me set up the VPS."),
        message("font-claude-message", "a-1", "Use WSL2 and keep the dashboard private.")
      ];
    }
  };

  try {
    const injectedExtractor = Function(`return (${extractClaudeConversation.toString()})`)();

    assert.deepEqual(injectedExtractor(), {
      provider: "claude",
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

function message(className, id, text) {
  return {
    className,
    innerText: text,
    querySelectorAll() {
      return [];
    },
    getAttribute(name) {
      return name === "data-message-id" ? id : null;
    }
  };
}
