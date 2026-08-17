import assert from "node:assert/strict";
import test from "node:test";

import {
  isExportCurrentConversationRequest,
  isInspectCurrentConversationRequest
} from "../dist/shared/protocol.js";

test("accepts curated PDF options on export requests", () => {
  assert.equal(
    isExportCurrentConversationRequest({
      type: "export-current-conversation",
      format: "pdf",
      pdfOptions: { template: "reference", textSize: "large" }
    }),
    true
  );
});

test("rejects malformed PDF options instead of sending them to the renderer", () => {
  assert.equal(
    isExportCurrentConversationRequest({
      type: "export-current-conversation",
      format: "pdf",
      pdfOptions: "reference"
    }),
    false
  );
});

test("accepts inspection requests with an optional source tab", () => {
  assert.equal(isInspectCurrentConversationRequest({ type: "inspect-current-conversation" }), true);
  assert.equal(isInspectCurrentConversationRequest({ type: "inspect-current-conversation", tabId: 42 }), true);
  assert.equal(isInspectCurrentConversationRequest({ type: "inspect-current-conversation", tabId: "42" }), false);
});
