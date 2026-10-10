import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERSATION_LIMITS,
  ConversationLimitError,
  createConversation,
  createConversationPreview
} from "../dist/core/conversation.js";

test("creates a portable conversation without losing typed message blocks", () => {
  const conversation = createConversation({
    provider: "chatgpt",
    title: "Release notes",
    messages: [
      {
        id: "message-1",
        role: "user",
        blocks: [{ type: "paragraph", text: "Summarize this release." }]
      },
      {
        id: "message-2",
        role: "assistant",
        blocks: [
          { type: "paragraph", text: "Here is the summary." },
          { type: "code", language: "ts", code: "export const version = 1;" }
        ]
      }
    ]
  });

  assert.deepEqual(conversation, {
    provider: "chatgpt",
    title: "Release notes",
    messages: [
      {
        id: "message-1",
        role: "user",
        blocks: [{ type: "paragraph", text: "Summarize this release." }]
      },
      {
        id: "message-2",
        role: "assistant",
        blocks: [
          { type: "paragraph", text: "Here is the summary." },
          { type: "code", language: "ts", code: "export const version = 1;" }
        ]
      }
    ]
  });
});

test("rejects conversations that exceed the centralized content budget", () => {
  assert.throws(
    () => createConversation({
      provider: "chatgpt",
      title: "Oversized",
      messages: [{
        id: "message-1",
        role: "assistant",
        blocks: [{
          type: "paragraph",
          text: "x".repeat(CONVERSATION_LIMITS.charactersPerBlock + 1)
        }]
      }]
    }),
    ConversationLimitError
  );
});

test("rejects oversized table dimensions before PDF rendering", () => {
  assert.throws(
    () => createConversation({
      provider: "chatgpt",
      title: "Wide table",
      messages: [{
        id: "message-1",
        role: "assistant",
        blocks: [{
          type: "table",
          headers: Array.from({ length: CONVERSATION_LIMITS.tableColumns + 1 }, () => "Column"),
          rows: []
        }]
      }]
    }),
    ConversationLimitError
  );
});

test("creates a bounded preview without mutating the export conversation", () => {
  const conversation = createConversation({
    provider: "chatgpt",
    title: "Long preview",
    messages: Array.from({ length: 8 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      blocks: [{ type: "paragraph", text: "x".repeat(3_000) }]
    }))
  });

  const preview = createConversationPreview(conversation);
  assert.equal(preview.messages.length, 6);
  assert.equal(preview.messages[0].blocks[0].text.length, 2_000);
  assert.equal(conversation.messages.length, 8);
  assert.equal(conversation.messages[0].blocks[0].text.length, 3_000);
});

test("bounds visual dimensions and aggregate raster data before rendering", () => {
  const draft = (blocks) => ({ provider: "chatgpt", title: "Visual limits", messages: [{ id: "a", role: "assistant", blocks }] });
  const visual = { type: "visual", width: 640, height: 400, text: "Buttons and icons", dataUrl: "data:image/png;base64,AAAA" };
  assert.equal(createConversationPreview(createConversation(draft([visual]))).messages[0].blocks[0].dataUrl, visual.dataUrl);
  for (const invalid of [{ width: 0 }, { height: Infinity }, { width: 5000, height: 5000 }, { dataUrl: "https://example.com/image.png" }]) {
    assert.throws(() => createConversation(draft([{ ...visual, ...invalid }])), ConversationLimitError);
  }
  const large = { ...visual, dataUrl: `data:image/png;base64,${"A".repeat(7_200_000)}` };
  assert.throws(() => createConversation(draft(Array(9).fill(large))), ConversationLimitError);
});
