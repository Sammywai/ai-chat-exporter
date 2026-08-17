import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { normalizePdfText, renderPdf } from "../dist/renderers/pdf.js";

const notoFont = await readFile(
  new URL("../static/assets/NotoSansSC.ttf", import.meta.url)
);
globalThis.chrome = {
  runtime: {
    getURL() {
      return `data:font/otf;base64,${notoFont.toString("base64")}`;
    }
  }
};

test("renders a normalized ChatGPT conversation as a PDF document", async () => {
  const pdf = await renderPdf({
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
        blocks: [{ type: "paragraph", text: "Start with a PDF transcript." }]
      }
    ]
  });

  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 500);
});

test("renders the reference chat template with curated appearance options", async () => {
  const pdf = await renderPdf(
    {
      provider: "chatgpt",
      title: "Reference layout",
      messages: [
        {
          id: "u-1",
          role: "user",
          blocks: [{ type: "paragraph", text: "Show the clean chat style." }]
        },
        {
          id: "a-1",
          role: "assistant",
          blocks: [
            { type: "heading", level: 2, text: "A readable answer" },
            { type: "paragraph", text: "> Keep the hierarchy clear." },
            { type: "table", headers: ["Item", "Value"], rows: [["Text", "Large"]] }
          ]
        }
      ]
    },
    {
      template: "reference",
      textSize: "large",
      spacing: "comfortable",
      speakerColors: "high-contrast",
      tableStyle: "soft",
      codeStyle: "panel"
    }
  );

  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 500);
});

test("renders the terminal template with distinct geometry from quiet paper", async () => {
  const conversation = {
    provider: "chatgpt",
    title: "Template comparison",
    messages: [
      {
        id: "u-1",
        role: "user",
        blocks: [{ type: "paragraph", text: "Show this page in each template." }]
      },
      {
        id: "a-1",
        role: "assistant",
        blocks: [
          { type: "heading", level: 2, text: "Distinct composition" },
          { type: "paragraph", text: "The preview should visibly match the selected template." },
          { type: "code", language: "shell", code: "export --format pdf" }
        ]
      }
    ]
  };
  const signatures = new Map();

  for (const template of ["quiet-paper", "terminal-ledger"]) {
    const pdf = await renderPdf(conversation, {
      template,
      themeMode: "light",
      colorPreset: "light",
      speakerColors: "template"
    });
    const pdfDocument = await getDocument({ data: pdf.slice() }).promise;
    const page = await pdfDocument.getPage(1);
    const text = await page.getTextContent();
    signatures.set(template, JSON.stringify(text.items.map((item) => ({
      text: item.str,
      transform: item.transform,
      width: item.width,
      height: item.height
    }))));
    await pdfDocument.destroy();
  }

  assert.notEqual(signatures.get("quiet-paper"), signatures.get("terminal-ledger"));
});

test("renders V5 as the classic bubble-free archive style", async () => {
  const pdf = await renderPdf({
    provider: "chatgpt",
    title: "Classic archive proof",
    messages: [
      { id: "u-1", role: "user", blocks: [{ type: "paragraph", text: "Left-aligned question" }] },
      { id: "a-1", role: "assistant", blocks: [{ type: "paragraph", text: "Left-aligned answer" }] }
    ]
  }, {
    template: "terminal-ledger",
    themeMode: "light",
    colorPreset: "light",
    speakerColors: "template"
  });
  const pdfDocument = await getDocument({ data: pdf.slice() }).promise;
  const page = await pdfDocument.getPage(1);
  const text = await page.getTextContent();
  const items = text.items.filter((item) => "str" in item);
  const x = (value) => items.find((item) => item.str === value)?.transform[4];

  assert.ok(items.filter((item) => item.str === "AI CHAT EXPORTER").length >= 2);
  assert.equal(x("YOU"), x("CHATGPT"));
  assert.equal(x("Left-aligned question"), x("Left-aligned answer"));
  await pdfDocument.destroy();
});

test("renders custom brand colors and bubble modes", async () => {
  const pdf = await renderPdf(
    {
      provider: "chatgpt",
      title: "Custom colors",
      messages: [
        {
          id: "u-1",
          role: "user",
          blocks: [{ type: "paragraph", text: "Use the chosen palette." }]
        },
        {
          id: "a-1",
          role: "assistant",
          blocks: [{ type: "paragraph", text: "The export should remain readable." }]
        }
      ]
    },
    {
      template: "reference",
      themeMode: "dark",
      bubbleStyle: "white-black",
      speakerColors: "custom",
      customColors: {
        page: "#0E471C",
        text: "#EEEEEE",
        userBubble: "#FFFFFF",
        userText: "#000000",
        userAccent: "#C1E7EA",
        assistantAccent: "#CFF483",
        assistantSurface: "#474747",
        rule: "#83D0DA"
      }
    }
  );

  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 500);
});

test("renders each color family in light and dark modes", async () => {
  const families = ["blue", "green", "purple", "warm", "black", "light"];
  for (const family of families) {
    for (const themeMode of ["light", "dark"]) {
      const pdf = await renderPdf(
        {
          provider: "chatgpt",
          title: `${family} ${themeMode}`,
          messages: [
            {
              id: "u-1",
              role: "user",
              blocks: [{ type: "paragraph", text: "Preview this readable family." }]
            },
            {
              id: "a-1",
              role: "assistant",
              blocks: [{ type: "paragraph", text: "Keep labels and alignment visible." }]
            }
          ]
        },
        {
          template: "reference",
          themeMode,
          bubbleStyle: "brand",
          colorPreset: family,
          speakerColors: "template"
        }
      );

      assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
      assert.ok(pdf.length > 500);
    }
  }
});

test("renders a white Light page with a visible same-color bubble boundary", async () => {
  const pdf = await renderPdf(
    {
      provider: "chatgpt",
      title: "White page boundary",
      messages: [
        {
          id: "u-1",
          role: "user",
          blocks: [{ type: "paragraph", text: "Keep my bubble distinct from the white page." }]
        },
        {
          id: "a-1",
          role: "assistant",
          blocks: [{ type: "paragraph", text: "Use a quiet rule so the text stays easy to read." }]
        }
      ]
    },
    {
      template: "reference",
      themeMode: "light",
      colorPreset: "light",
      bubbleStyle: "brand"
    }
  );

  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 500);
});

test("normalizes whitespace and typography without turning paragraph breaks into question marks", () => {
  assert.equal(
    normalizePdfText("第一行\n\nUse PowerShell — it’s ready."),
    "第一行\n\nUse PowerShell — it’s ready."
  );
});

test("converts unsupported rating and ranking emoji into readable PDF text", () => {
  assert.equal(
    normalizePdfText("🥇 Best choice ⭐⭐⭐⭐⭐; 🥈 next ⭐⭐⭐⭐; 🥉 third"),
    "1 Best choice 5/5; 2 next 4/5; 3 third"
  );
});

test("embeds a Unicode font for Chinese conversation content", async () => {
  const pdf = await renderPdf({
    provider: "chatgpt",
    title: "中文对话测试",
    messages: [
      {
        id: "a-1",
        role: "assistant",
        blocks: [{ type: "paragraph", text: "先使用蓬松洗发水，再搭配轻盈的造型产品。" }]
      }
    ]
  });

  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 1_000_000);
});

test("paginates long paragraphs, code, and table rows without clipping or content loss", async () => {
  const marker = (prefix, index) => `${prefix}_${String.fromCharCode(
    65 + Math.floor(index / (26 * 26)),
    65 + Math.floor(index / 26) % 26,
    65 + index % 26
  )}`;
  const paragraphMarkers = Array.from({ length: 180 }, (_, index) => marker("PARA", index));
  const codeMarkers = Array.from({ length: 150 }, (_, index) => marker("CODE", index));
  const tableMarkers = Array.from({ length: 180 }, (_, index) => marker("CELL", index));
  const pdf = await renderPdf({
    provider: "chatgpt",
    title: "Long content boundary regression",
    messages: [
      {
        id: "a-long",
        role: "assistant",
        blocks: [
          { type: "paragraph", text: paragraphMarkers.map((marker) => `${marker} readable content.`).join(" ") },
          { type: "code", language: "text", code: codeMarkers.map((marker) => `${marker} = preserved`).join("\n") },
          {
            type: "table",
            headers: ["Required context", "Value"],
            rows: [["Oversized row", tableMarkers.map((marker) => `${marker} retained`).join(" ")]]
          }
        ]
      }
    ]
  });

  const document = await getDocument({ data: pdf.slice(), disableWorker: true }).promise;
  assert.ok(document.numPages >= 4);
  let extracted = "";
  let continuationCount = 0;
  let tableHeaderCount = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    extracted += ` ${pageText}`;
    continuationCount += (pageText.match(/CONTINUED/g) ?? []).length;
    tableHeaderCount += (pageText.match(/Required context/g) ?? []).length;
    for (const item of textContent.items) {
      const y = item.transform[5];
      assert.ok(y >= 0 && y <= page.view[3], `text y=${y} outside page ${pageNumber}`);
    }
  }
  await document.destroy();

  for (const marker of [...paragraphMarkers, ...codeMarkers, ...tableMarkers]) {
    assert.match(extracted, new RegExp(marker), `${marker} silently lost`);
  }
  assert.ok(continuationCount >= document.numPages - 2, "role context should repeat after content page breaks");
  assert.ok(tableHeaderCount >= 2, "table header context should repeat after a table page break");
});
