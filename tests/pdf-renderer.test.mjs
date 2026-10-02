import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getDocument as loadPdfDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { normalizePdfText, renderPdf } from "../dist/renderers/pdf.js";

const getDocument = (options) => loadPdfDocument({
  standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname,
  ...options
});

const bundledFonts = new Map(await Promise.all(
  ["Inter-Regular.ttf", "Inter-Bold.ttf", "NotoSansSC.ttf"].map(async (filename) => [
    `assets/${filename}`,
    await readFile(new URL(`../static/assets/${filename}`, import.meta.url))
  ])
));
let unicodeFontRequests = 0;
globalThis.chrome = {
  runtime: {
    getURL(path) {
      assert.ok(bundledFonts.has(path), `Unexpected external PDF font: ${path}`);
      if (path === "assets/NotoSansSC.ttf") unicodeFontRequests += 1;
      return `data:font/ttf;base64,${bundledFonts.get(path).toString("base64")}`;
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

test("embeds local Inter regular and bold without loading the large Unicode fallback", async () => {
  const beforeRequests = unicodeFontRequests;
  const pdf = await renderPdf({
    provider: "chatgpt",
    title: "Readable transcript",
    messages: [
      { id: "user", role: "user", blocks: [{ type: "paragraph", text: "Export our complete conversation." }] },
      { id: "assistant", role: "assistant", blocks: [
        { type: "heading", level: 2, text: "Clear headings" },
        { type: "paragraph", text: "Keep **important text** readable — including smart quotes and café. office efficient affinity" },
        { type: "code", language: "js", code: "const exported = true;" }
      ] }
    ]
  });
  assert.equal(unicodeFontRequests, beforeRequests);
  assert.ok(pdf.length > 100_000 && pdf.length < 600_000,
    `Expected complete Inter fonts without the large Unicode fallback: ${pdf.length} bytes`);

  const document = await getDocument({ data: pdf.slice() }).promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((item) => item.str).join(" ");
  assert.match(text, /important text/);
  assert.equal((text.match(/important text/g) ?? []).length, 1, "bold text must not be duplicated in extraction");
  assert.match(text, /smart quotes and café/);
  assert.match(text, /office efficient affinity/);
  await page.getOperatorList();
  const fontName = (value) => page.commonObjs.get(content.items.find((item) => item.str.includes(value)).fontName).name;
  assert.match(fontName("smart quotes"), /Inter-Regular/);
  assert.match(fontName("important text"), /Inter-Bold/);
  assert.match(fontName("exported ="), /Courier/);
  await document.destroy();
});

test("uses Inter for supported Greek and Cyrillic text with intact character sequences", async () => {
  const beforeRequests = unicodeFontRequests;
  const sample = "Ελληνικά — Привет — café — naïve";
  const pdf = await renderPdf({
    provider: "chatgpt",
    title: "Multilingual typography",
    messages: [{ id: "answer", role: "assistant", blocks: [{ type: "paragraph", text: sample }] }]
  });
  assert.equal(unicodeFontRequests, beforeRequests);
  const document = await getDocument({ data: pdf.slice() }).promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  assert.ok(content.items.some((item) => item.str === sample));
  await document.destroy();
});

test("reference layout uses quiet title, right user bubble, and plain assistant text", async () => {
  const pdf = await renderPdf({
    provider: "chatgpt",
    title: "Simple conversation",
    messages: [
      { id: "user", role: "user", blocks: [
        { type: "paragraph", text: "My question" },
        { type: "paragraph", text: "Another paragraph" }
      ] },
      { id: "assistant", role: "assistant", blocks: [
        { type: "heading", level: 2, text: "Readable heading" },
        { type: "paragraph", text: "Assistant answer" }
      ] }
    ]
  }, { template: "reference", themeMode: "dark" });
  const document = await getDocument({ data: pdf.slice() }).promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const items = content.items.filter((item) => "str" in item);
  const text = items.map((item) => item.str).join(" ");
  assert.doesNotMatch(text, /AI CHAT EXPORTER|Exported with|Exported locally|CONTINUED|YOU|ChatGPT/);
  assert.match(text, /Simple conversation/);
  assert.match(text, /1 \/ 1/);
  const x = (label) => items.find((item) => item.str === label)?.transform[4];
  assert.equal(x("Assistant answer"), 36);
  assert.equal(x("Readable heading"), 36);
  assert.ok(x("My question") > x("Assistant answer") + 200);
  assert.equal(x("My question"), x("Another paragraph"));
  await document.destroy();
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

test("embeds the reliable Unicode font and renders Chinese conversation content", async () => {
  const chinese = "先使用蓬松洗发水，再搭配轻盈的造型产品。";
  const pdf = await renderPdf({
    provider: "chatgpt",
    title: "中文对话测试",
    messages: [
      {
        id: "a-1",
        role: "assistant",
        blocks: [
          { type: "paragraph", text: chinese },
          { type: "paragraph", text: "Mixed-script text remains readable." },
          { type: "code", language: "python", code: 'print("中文")' }
        ]
      }
    ]
  });

  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  // The bundled font's subset appears searchable but drops glyphs visually.
  // A full embedded font is deliberately larger until a replacement passes raster QA.
  assert.ok(pdf.length > 100_000, "full font embedding must not regress to broken tiny subsets");

  const doc = await getDocument({ data: pdf.slice(), disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const text = await page.getTextContent();
  assert.match(text.items.map((item) => item.str).join(""), /先使用蓬松洗发水/);
  assert.match(text.items.map((item) => item.str).join(""), /Mixed-script text remains readable/);
  assert.match(text.items.map((item) => item.str).join(""), /print\("中文"\)/);
  await doc.destroy();
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
          { type: "paragraph", text: paragraphMarkers.map((marker, index) => index % 3 === 0
            ? `**${marker} readable content.**`
            : `${marker} readable content.`).join(" ") },
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
  let tableHeaderCount = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    extracted += ` ${pageText}`;
    assert.doesNotMatch(pageText, /AI CHAT EXPORTER|CONTINUED/);
    tableHeaderCount += (pageText.match(/Required context/g) ?? []).length;
    for (const item of textContent.items) {
      const y = item.transform[5];
      assert.ok(y >= 0 && y <= page.view[3], `text y=${y} outside page ${pageNumber}`);
      assert.ok(item.transform[4] + item.width <= page.view[2] - 35,
        `text exceeds right margin on page ${pageNumber}: ${item.str}`);
    }
  }
  await document.destroy();

  for (const marker of [...paragraphMarkers, ...codeMarkers, ...tableMarkers]) {
    assert.match(extracted, new RegExp(marker), `${marker} silently lost`);
  }
  assert.ok(tableHeaderCount >= 2, "table header context should repeat after a table page break");
});
