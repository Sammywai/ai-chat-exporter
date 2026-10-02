import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../dist/renderers/markdown.js";

test("renders a normalized ChatGPT conversation as a readable Markdown transcript", () => {
  const markdown = renderMarkdown({
    provider: "chatgpt",
    title: "Launch plan",
    messages: [
      {
        id: "u-1",
        role: "user",
        blocks: [{ type: "paragraph", text: "Build a local exporter." }]
      },
      {
        id: "a-1",
        role: "assistant",
        blocks: [{ type: "paragraph", text: "Start with Markdown." }]
      }
    ]
  });

  assert.equal(
    markdown,
    "# Launch plan\n\n> Exported locally from **ChatGPT**\n\n---\n\n## You\n\nBuild a local exporter.\n\n---\n\n## ChatGPT\n\nStart with Markdown.\n"
  );
});

test("keeps structured assistant blocks when rendering Markdown", () => {
  const markdown = renderMarkdown({
    provider: "chatgpt",
    title: "Development setup",
    messages: [
      {
        id: "a-1",
        role: "assistant",
        blocks: [
          { type: "heading", level: 2, text: "Check Node.js" },
          { type: "paragraph", text: "Open a terminal." },
          { type: "code", language: "powershell", code: "node --version" }
        ]
      }
    ]
  });

  assert.match(markdown, /### Check Node.js/);
  assert.match(markdown, /```powershell\nnode --version\n```/);
});

test("uses each provider's display name in the transcript", () => {
  const markdown = renderMarkdown({
    provider: "claude",
    title: "VPS setup",
    messages: [
      {
        id: "a-1",
        role: "assistant",
        blocks: [{ type: "paragraph", text: "Use WSL2." }]
      }
    ]
  });

  assert.match(markdown, /> Exported locally from \*\*Claude\*\*/);
  assert.match(markdown, /## Claude/);
});

test("keeps inline emphasis supplied by the chat platform", () => {
  const markdown = renderMarkdown({
    provider: "deepseek",
    title: "Eye surgery terms",
    messages: [
      {
        id: "a-1",
        role: "assistant",
        blocks: [{ type: "paragraph", text: "Choose **the procedure** after a full exam." }]
      }
    ]
  });

  assert.match(markdown, /Choose \*\*the procedure\*\* after a full exam\./);
});

test("renders table blocks as Markdown tables", () => {
  const markdown = renderMarkdown({
    provider: "chatgpt",
    title: "Products",
    messages: [
      {
        id: "a-1",
        role: "assistant",
        blocks: [
          {
            type: "table",
            headers: ["Product", "Best for"],
            rows: [["Volumetry", "Fine hair"]]
          }
        ]
      }
    ]
  });

  assert.match(markdown, /\| Product \| Best for \|/);
  assert.match(markdown, /\| Volumetry \| Fine hair \|/);
});

test("keeps untrusted chat markup inert in exported Markdown", () => {
  const markdown = renderMarkdown({
    provider: "chatgpt",
    title: "<img src=https://tracker.invalid/title>",
    messages: [{
      id: "a-1",
      role: "assistant",
      blocks: [
        {
          type: "paragraph",
          text: "![track](https://tracker.invalid/pixel) <script>alert(1)</script> [click](javascript:alert(1))"
        },
        {
          type: "code",
          language: "js",
          code: "before\n```\n<img src=https://tracker.invalid/code>\n```\nafter"
        },
        {
          type: "table",
          headers: ["Value"],
          rows: [["<img src=https://tracker.invalid/table>"]]
        },
        {
          type: "image",
          alt: "remote preview",
          sourceUrl: "https://tracker.invalid/image"
        }
      ]
    }]
  });

  assert.match(markdown, /# \\<img src=https:\/\/tracker\.invalid\/title\\>/);
  assert.match(markdown, /!\\\[track\\\]\(https:\/\/tracker\.invalid\/pixel\)/);
  assert.match(markdown, /\\<script\\>alert\(1\)\\<\/script\\>/);
  assert.match(markdown, /````js\nbefore\n```[\s\S]*\n````/);
  assert.match(markdown, /\| \\<img src=https:\/\/tracker\.invalid\/table\\> \|/);
  assert.match(markdown, /Image: remote preview/);
  assert.doesNotMatch(markdown, /https:\/\/tracker\.invalid\/image/);
});

test("drops unsafe code-fence language metadata", () => {
  const markdown = renderMarkdown({
    provider: "chatgpt",
    title: "Code",
    messages: [{
      id: "a-1",
      role: "assistant",
      blocks: [{ type: "code", language: "js onload=alert(1)", code: "safe" }]
    }]
  });

  assert.match(markdown, /```\nsafe\n```/);
  assert.doesNotMatch(markdown, /onload/);
});
