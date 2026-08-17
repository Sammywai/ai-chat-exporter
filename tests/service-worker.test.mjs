import assert from "node:assert/strict";
import test from "node:test";

test("returns the active ChatGPT conversation to an export request", async () => {
  const originalChrome = globalThis.chrome;
  let messageListener;
  let downloadOptions;
  const conversation = {
    provider: "chatgpt",
    title: "Launch plan",
    messages: [
      {
        id: "u-1",
        role: "user",
        blocks: [{ type: "paragraph", text: "Build it." }]
      }
    ]
  };

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    tabs: {
      query: async () => [{ id: 7, url: "https://chatgpt.com/c/launch-plan" }]
    },
    scripting: {
      executeScript: async (request) => {
        assert.equal(request.target.tabId, 7);
        return [{ result: conversation }];
      }
    },
    downloads: {
      download: async (options) => {
        downloadOptions = options;
        return 1;
      }
    }
  };

  try {
    await import(`../dist/background/service-worker.js?chatgpt-export-${Date.now()}`);
    const response = await new Promise((resolve) => {
      const keepChannelOpen = messageListener(
        { type: "export-current-conversation", format: "markdown" },
        {},
        resolve
      );
      assert.equal(keepChannelOpen, true);
    });

    assert.deepEqual(response, {
      status: "downloaded",
      message: "Markdown export is ready."
    });
    assert.deepEqual(downloadOptions, {
      url: "data:text/markdown;charset=utf-8,%23%20Launch%20plan%0A%0A%3E%20Exported%20locally%20from%20**ChatGPT**%0A%0A---%0A%0A%23%23%20You%0A%0ABuild%20it.%0A",
      filename: "Launch plan.md",
      saveAs: true
    });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("accepts Claude and DeepSeek conversations", async () => {
  const originalChrome = globalThis.chrome;
  let messageListener;
  let activeUrl = "https://claude.ai/chat/example";
  const usedExtractors = [];

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    tabs: {
      query: async () => [{ id: 7, url: activeUrl }]
    },
    scripting: {
      executeScript: async (request) => {
        usedExtractors.push(request.func.toString());
        return [{
          result: {
            provider: activeUrl.includes("claude") ? "claude" : "deepseek",
            title: "VPS plan",
            messages: [{ id: "a-1", role: "assistant", blocks: [{ type: "paragraph", text: "Use WSL2." }] }]
          }
        }];
      }
    },
    downloads: {
      download: async () => 1
    }
  };

  try {
    await import(`../dist/background/service-worker.js?claude-deepseek-${Date.now()}`);

    for (const url of ["https://claude.ai/chat/example", "https://chat.deepseek.com/a/chat"] ) {
      activeUrl = url;
      const response = await new Promise((resolve) => {
        messageListener({ type: "export-current-conversation", format: "markdown" }, {}, resolve);
      });
      assert.deepEqual(response, { status: "downloaded", message: "Markdown export is ready." });
    }

    assert.match(usedExtractors[0], /claude/);
    assert.match(usedExtractors[1], /deepseek/);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("routes Gemini, Copilot, Perplexity, and Grok hosts to the generic extractor", async () => {
  const originalChrome = globalThis.chrome;
  let messageListener;
  let activeUrl = "https://gemini.google.com/app";
  const requests = [];

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    tabs: {
      query: async () => [{ id: 7, url: activeUrl }]
    },
    scripting: {
      executeScript: async (request) => {
        requests.push(request);
        return [{
          result: {
            provider: request.args[0],
            title: "Cross-platform test",
            messages: [{ id: "a-1", role: "assistant", blocks: [{ type: "paragraph", text: "Answer." }] }]
          }
        }];
      }
    },
    downloads: {
      download: async () => 1
    }
  };

  try {
    await import(`../dist/background/service-worker.js?additional-providers-${Date.now()}`);
    const cases = [
      ["https://gemini.google.com/app", "gemini"],
      ["https://copilot.microsoft.com/chats", "copilot"],
      ["https://www.perplexity.ai/search/test", "perplexity"],
      ["https://grok.com/", "grok"],
      ["https://x.com/i/grok", "grok"]
    ];

    for (const [url, provider] of cases) {
      activeUrl = url;
      await new Promise((resolve) => {
        messageListener({ type: "export-current-conversation", format: "markdown" }, {}, resolve);
      });
      assert.deepEqual(requests.at(-1).args, [provider]);
      assert.match(requests.at(-1).func.toString(), /extractAdditionalConversation/);
    }
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("uses the conversation topic, including Chinese, as the download filename", async () => {
  const originalChrome = globalThis.chrome;
  let messageListener;
  let downloadOptions;
  globalThis.chrome = {
    runtime: { onMessage: { addListener(listener) { messageListener = listener; } } },
    tabs: { query: async () => [{ id: 7, url: "https://chat.deepseek.com/a/chat" }] },
    scripting: {
      executeScript: async () => [{
        result: {
          provider: "deepseek",
          title: "近视雷射手術名詞解釋",
          messages: [{ id: "a-1", role: "assistant", blocks: [{ type: "paragraph", text: "Answer." }] }]
        }
      }]
    },
    downloads: { download: async (options) => { downloadOptions = options; return 1; } }
  };

  try {
    await import(`../dist/background/service-worker.js?filename-${Date.now()}`);
    await new Promise((resolve) => {
      messageListener({ type: "export-current-conversation", format: "markdown" }, {}, resolve);
    });
    assert.equal(downloadOptions.filename, "近视雷射手術名詞解釋.md");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("reports supported-tab readiness and preserves source tab for the full editor", async () => {
  const originalChrome = globalThis.chrome;
  let messageListener;
  const sourceTab = { id: 42, url: "https://chatgpt.com/c/source-chat" };
  globalThis.chrome = {
    runtime: { onMessage: { addListener(listener) { messageListener = listener; } } },
    tabs: {
      query: async () => [{ id: 99, url: "chrome-extension://popup/editor.html" }],
      get: async (tabId) => {
        assert.equal(tabId, 42);
        return sourceTab;
      }
    },
    scripting: {
      executeScript: async (request) => {
        assert.equal(request.target.tabId, 42);
        return [{
          result: {
            provider: "chatgpt",
            title: "Source conversation",
            messages: [
              { id: "u-1", role: "user", blocks: [{ type: "paragraph", text: "Question" }] },
              { id: "a-1", role: "assistant", blocks: [{ type: "paragraph", text: "Answer" }] }
            ]
          }
        }];
      }
    },
    downloads: { download: async () => 1 }
  };

  try {
    await import(`../dist/background/service-worker.js?source-tab-${Date.now()}`);
    const response = await new Promise((resolve) => {
      messageListener({ type: "inspect-current-conversation", tabId: 42 }, {}, resolve);
    });
    assert.deepEqual(response, {
      status: "ready",
      provider: "ChatGPT",
      title: "Source conversation",
      messageCount: 2,
      tabId: 42,
      conversation: {
        provider: "chatgpt",
        title: "Source conversation",
        messages: [
          { id: "u-1", role: "user", blocks: [{ type: "paragraph", text: "Question" }] },
          { id: "a-1", role: "assistant", blocks: [{ type: "paragraph", text: "Answer" }] }
        ]
      }
    });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("distinguishes unsupported, empty, and unavailable conversation states", async () => {
  const originalChrome = globalThis.chrome;
  let messageListener;
  let activeUrl = "https://example.com/";
  let extraction = null;
  let extractionError = false;
  globalThis.chrome = {
    runtime: { onMessage: { addListener(listener) { messageListener = listener; } } },
    tabs: { query: async () => [{ id: 7, url: activeUrl }] },
    scripting: {
      executeScript: async () => {
        if (extractionError) throw new Error("blocked");
        return [{ result: extraction }];
      }
    },
    downloads: { download: async () => 1 }
  };

  try {
    await import(`../dist/background/service-worker.js?conversation-states-${Date.now()}`);
    const inspect = () => new Promise((resolve) => {
      messageListener({ type: "inspect-current-conversation" }, {}, resolve);
    });
    assert.deepEqual(await inspect(), {
      status: "unsupported",
      message: "Open a supported AI conversation to export it."
    });

    activeUrl = "https://claude.ai/chat/empty";
    assert.deepEqual(await inspect(), {
      status: "empty",
      provider: "Claude",
      tabId: 7,
      message: "No visible Claude messages found. Open a conversation or wait for it to finish loading."
    });

    extraction = {
      provider: "claude",
      title: "Oversized",
      messages: [{
        id: "a-1",
        role: "assistant",
        blocks: [{ type: "paragraph", text: "x".repeat(50_001) }]
      }]
    };
    assert.deepEqual(await inspect(), {
      status: "unavailable",
      provider: "Claude",
      tabId: 7,
      message: "This conversation is too large to export safely. Split it into smaller conversations, then retry."
    });

    extractionError = true;
    assert.deepEqual(await inspect(), {
      status: "unavailable",
      provider: "Claude",
      tabId: 7,
      message: "Claude conversation is unavailable. Reload the chat, then retry."
    });
  } finally {
    globalThis.chrome = originalChrome;
  }
});
