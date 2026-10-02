import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const notoFont = await readFile(
  new URL("../static/assets/NotoSansSC.ttf", import.meta.url)
);

test("downloads the active ChatGPT conversation as a PDF", async () => {
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
    action: { onClicked: { addListener() {} } },
    runtime: {
      getURL() {
        return `data:font/otf;base64,${notoFont.toString("base64")}`;
      },
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
      executeScript: async () => [{ result: captured(conversation) }]
    },
    downloads: {
      download: async (options) => {
        downloadOptions = options;
        return 1;
      }
    }
  };

  try {
    await import(`../dist/background/service-worker.js?${Date.now()}`);
    const response = await new Promise((resolve) => {
      messageListener({ type: "export-current-conversation", format: "pdf" }, {}, resolve);
    });

    assert.deepEqual(response, {
      status: "downloaded",
      message: "PDF export is ready."
    });
    assert.equal(downloadOptions.filename, "Launch plan.pdf");
    assert.equal(downloadOptions.saveAs, true);
    assert.match(downloadOptions.url, /^data:application\/pdf;base64,/);
    const encodedPdf = downloadOptions.url.split(",", 2)[1];
    assert.equal(Buffer.from(encodedPdf, "base64").subarray(0, 5).toString(), "%PDF-");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("answers an export instead of hanging when the download is rejected", async () => {
  const originalChrome = globalThis.chrome;
  let messageListener;
  const conversation = {
    provider: "chatgpt",
    title: "Launch plan",
    messages: [{ id: "u-1", role: "user", blocks: [{ type: "paragraph", text: "Build it." }] }]
  };

  globalThis.chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: {
      getURL() {
        return `data:font/otf;base64,${notoFont.toString("base64")}`;
      },
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
      executeScript: async () => [{ result: captured(conversation) }]
    },
    downloads: {
      download: async () => {
        throw new Error("download rejected");
      }
    }
  };

  try {
    await import(`../dist/background/service-worker.js?download-reject-${Date.now()}`);
    const response = await new Promise((resolve) => {
      messageListener({ type: "export-current-conversation", format: "pdf" }, {}, resolve);
    });
    assert.deepEqual(response, {
      status: "unavailable",
      message: "Export failed. Keep the AI chat open, then try again."
    });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

function captured(conversation) {
  return { status: "captured", boundariesReached: true, conversation };
}
