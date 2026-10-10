import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, clip, endPath, rectangle, pushGraphicsState, popGraphicsState, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

import {
  providerDisplayName,
  type Conversation,
  type ConversationMessage,
  type MessageBlock,
  type MessageRole
} from "../core/conversation.js";
import {
  DEFAULT_PDF_OPTIONS,
  normalizePdfOptions,
  type NormalizedPdfOptions,
  type PdfOptions,
  type PdfTemplateId
} from "../shared/pdf-options.js";
import {
  applyPdfBubbleStyle,
  resolvePdfAppearanceMode,
  resolvePdfPalette
} from "../shared/pdf-appearance.js";

const A4: [number, number] = [595.28, 841.89];
const bundledFontBytes = new Map<string, Promise<Uint8Array>>();
const standardGlyphWidths = new WeakMap<PDFFont, Map<string, number>>();
const embeddedTextWidths = new WeakMap<PDFFont, Map<string, number>>();

interface PdfTheme {
  id: PdfTemplateId;
  page: string;
  text: string;
  strong: string;
  muted: string;
  userAccent: string;
  userText: string;
  assistantAccent: string;
  userSurface: string;
  assistantSurface: string;
  tableHeader: string;
  tableRow: string;
  codeSurface: string;
  rule: string;
  footer: string;
}

interface PdfLayout {
  margin: number;
  bodyWidth: number;
  bottomMargin: number;
}

interface PdfMetrics {
  bodySize: number;
  bodyLineHeight: number;
  headingSize: number;
  smallHeadingSize: number;
  labelSize: number;
  blockGap: number;
  messageGap: number;
}

interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

interface PdfCursor {
  page: PDFPage;
  y: number;
}

interface PdfContext {
  document: PDFDocument;
  cursor: PdfCursor;
  fonts: PdfFonts;
  theme: PdfTheme;
  options: NormalizedPdfOptions;
  layout: PdfLayout;
  metrics: PdfMetrics;
  providerName: string;
  currentRole: MessageRole | undefined;
}

interface MessagePalette {
  accent: RGB;
  labelBackground: RGB;
  body: RGB;
  heading: RGB;
  tableHeader: RGB;
  surface: RGB;
}

const themes: Record<PdfTemplateId, PdfTheme> = {
  reference: {
    id: "reference",
    page: "#EEEEEE",
    text: "#474747",
    strong: "#474747",
    muted: "#474747",
    userAccent: "#226689",
    userText: "#0E471C",
    assistantAccent: "#0E471C",
    userSurface: "#C1E7EA",
    assistantSurface: "#F5E5CB",
    tableHeader: "#C1E7EA",
    tableRow: "#F5E5CB",
    codeSurface: "#F5E5CB",
    rule: "#83D0DA",
    footer: "#226689"
  },
  "quiet-paper": {
    id: "quiet-paper",
    page: "#F8FAFC",
    text: "#172033",
    strong: "#0F172A",
    muted: "#3F4D63",
    userAccent: "#163A5F",
    userText: "#163A5F",
    assistantAccent: "#0F5C7A",
    userSurface: "#DDEAFE",
    assistantSurface: "#FFFFFF",
    tableHeader: "#DDEAFE",
    tableRow: "#F4F7FB",
    codeSurface: "#EEF3F8",
    rule: "#6E88A4",
    footer: "#0F5C7A"
  },
  "editorial-ledger": {
    id: "editorial-ledger",
    page: "#FFFBF5",
    text: "#2B2A27",
    strong: "#1F1E1B",
    muted: "#5A5147",
    userAccent: "#17324D",
    userText: "#17324D",
    assistantAccent: "#7C2D12",
    userSurface: "#E1EDF5",
    assistantSurface: "#F7F3EB",
    tableHeader: "#E1EDF5",
    tableRow: "#FCF8F1",
    codeSurface: "#F0E9DE",
    rule: "#8F7E6B",
    footer: "#7C2D12"
  },
  "midnight-index": {
    id: "midnight-index",
    page: "#0F172A",
    text: "#F8FAFC",
    strong: "#FFFFFF",
    muted: "#CBD5E1",
    userAccent: "#F8FAFC",
    userText: "#F8FAFC",
    assistantAccent: "#93C5FD",
    userSurface: "#1E3A8A",
    assistantSurface: "#111827",
    tableHeader: "#1E3A8A",
    tableRow: "#111B31",
    codeSurface: "#111827",
    rule: "#93C5FD",
    footer: "#93C5FD"
  },
  "soft-cards": {
    id: "soft-cards",
    page: "#F5F7FB",
    text: "#1F2937",
    strong: "#111827",
    muted: "#465466",
    userAccent: "#134E4A",
    userText: "#134E4A",
    assistantAccent: "#0F766E",
    userSurface: "#DFF7F1",
    assistantSurface: "#FFFFFF",
    tableHeader: "#DFF7F1",
    tableRow: "#F8FAFC",
    codeSurface: "#EDF2F5",
    rule: "#789B95",
    footer: "#0F766E"
  },
  "terminal-ledger": {
    id: "terminal-ledger",
    page: "#0B1220",
    text: "#F4F7FB",
    strong: "#FFFFFF",
    muted: "#B7C4D3",
    userAccent: "#D1FAE5",
    userText: "#D1FAE5",
    assistantAccent: "#A7F3D0",
    userSurface: "#083344",
    assistantSurface: "#111827",
    tableHeader: "#083344",
    tableRow: "#0F1A2A",
    codeSurface: "#111D2D",
    rule: "#A7F3D0",
    footer: "#A7F3D0"
  }
};

export async function renderPdf(
  conversation: Conversation,
  options: PdfOptions = DEFAULT_PDF_OPTIONS
): Promise<Uint8Array> {
  const normalizedOptions = normalizePdfOptions(options);
  const theme = resolveTheme(themes[normalizedOptions.template], normalizedOptions);
  const layout = createLayout(theme.id);
  const metrics = createMetrics(normalizedOptions);
  const document = await PDFDocument.create();
  const fonts = await embedFonts(document, conversation);
  const providerName = providerDisplayName(conversation.provider);
  const context: PdfContext = {
    document,
    cursor: { page: document.addPage(A4), y: 0 },
    fonts,
    theme,
    options: normalizedOptions,
    layout,
    metrics,
    providerName,
    currentRole: undefined
  };

  fillPage(context.cursor.page, theme.page);
  context.cursor.y = drawOpening(context, conversation.title, providerName);

  for (const message of conversation.messages) {
    context.currentRole = undefined;
    ensureRoom(context, 42, false);
    context.currentRole = message.role;
    drawMessageHeading(context, message);

    if (theme.id === "reference" && message.role === "user"
      && message.blocks.every((block) => block.type === "paragraph")) {
      drawParagraph(context, message.blocks.map((block) => block.type === "paragraph"
        ? block.inlineFormat === "markdown" ? readableInline(block.text) : block.text
        : "").join("\n\n"));
    } else {
      for (const block of message.blocks) {
        if (block.type === "visual") await drawVisual(context, block);
        else drawBlock(context, block);
      }
    }

    context.cursor.y -= metrics.messageGap;
  }

  drawFooters(context);
  document.setTitle(normalizePdfText(conversation.title));
  document.setAuthor("AI Chat Exporter");
  return document.save();
}

async function embedFonts(document: PDFDocument, conversation: Conversation): Promise<PdfFonts> {
  document.registerFontkit(fontkit);
  const regularBytes = await loadBundledFont("Inter-Regular.ttf");
  const characters = new Set(fontkit.create(regularBytes).characterSet);
  const mono = await document.embedFont(StandardFonts.Courier);
  const monoCharacters = new Set(mono.getCharacterSet());
  const supported = (text: string): boolean => Array.from(normalizePdfText(text)).every((character) =>
    /\s/.test(character) || characters.has(character.codePointAt(0)!)
  );
  const blockSupported = (block: MessageBlock): boolean => {
    if (block.type === "visual") return true;
    if (block.type === "table") {
      return block.headers.every(supported) && block.rows.every((row) => row.every(supported));
    }
    if (block.type === "code") return Array.from(normalizePdfText(block.code)).every((character) =>
      /\s/.test(character) || monoCharacters.has(character.codePointAt(0)!)
    );
    if (block.type === "math") return supported(block.tex);
    if (block.type === "image") return supported(block.alt);
    return supported(block.text);
  };
  if (supported(conversation.title) && conversation.messages.every((message) => message.blocks.every(blockSupported))) {
    // Full static fonts keep glyphs visible in every PDF viewer. Disable
    // ligatures so searchable text retains its original character sequence.
    const fontOptions = { subset: false, features: { liga: false, clig: false } };
    return {
      regular: await document.embedFont(regularBytes, fontOptions),
      bold: await document.embedFont(await loadBundledFont("Inter-Bold.ttf"), fontOptions),
      mono
    };
  }

  // This bundled font loses visible glyphs with fontkit subsetting even though
  // PDF text extraction succeeds. Keep the existing whole-conversation fallback
  // for unsupported glyphs, including mixed CJK and Latin conversations.
  // Localized Latin digits and ligatures use alternate glyph IDs absent from
  // pdf-lib's nominal Unicode map. Keep the original searchable characters.
  const unicode = await document.embedFont(await loadBundledFont("NotoSansSC.ttf"), {
    subset: false,
    features: { locl: false, liga: false, clig: false }
  });
  return { regular: unicode, bold: unicode, mono: unicode };
}

function resolveTheme(theme: PdfTheme, options: NormalizedPdfOptions): PdfTheme {
  const systemDark = prefersDarkSystemTheme();
  const mode = resolvePdfAppearanceMode(options, systemDark);
  const colors = resolvePdfPalette(options, systemDark);
  const themed = {
    ...theme,
    page: colors.page,
    text: colors.text,
    strong: colors.text,
    muted: colors.text,
    userAccent: colors.userAccent,
    userText: colors.userText,
    assistantAccent: colors.assistantAccent,
    userSurface: colors.userBubble,
    assistantSurface: colors.assistantSurface,
    tableHeader: colors.assistantSurface,
    tableRow: colors.assistantSurface,
    codeSurface: colors.assistantSurface,
    rule: colors.rule,
    footer: colors.assistantAccent
  };
  if (theme.id !== "reference") {
    return themed;
  }
  const bubble = applyPdfBubbleStyle(
    { userBubble: themed.userSurface, userText: themed.userText },
    options.bubbleStyle,
    mode
  );
  return {
    ...themed,
    userSurface: bubble.userBubble,
    userText: bubble.userText,
    codeSurface: mode === "dark" ? "#171717" : "#F7F7F8"
  };
}

function prefersDarkSystemTheme(): boolean {
  const matchMedia = (globalThis as typeof globalThis & {
    matchMedia?: (query: string) => { matches: boolean };
  }).matchMedia;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function loadBundledFont(filename: string): Promise<Uint8Array> {
  let fontBytes = bundledFontBytes.get(filename);
  if (!fontBytes) {
    const fontUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL(`assets/${filename}`)
      : new URL(`../assets/${filename}`, import.meta.url).href;
    fontBytes = fetch(fontUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("The bundled PDF font could not be loaded.");
        }
        return response.arrayBuffer();
      })
      .then((bytes) => new Uint8Array(bytes));
    bundledFontBytes.set(filename, fontBytes);
  }

  return fontBytes;
}

function createLayout(template: PdfTemplateId): PdfLayout {
  const margin = template === "reference" ? 36 : 48;
  return {
    margin,
    bodyWidth: A4[0] - margin * 2,
    bottomMargin: 56
  };
}

function createMetrics(options: NormalizedPdfOptions): PdfMetrics {
  const sizeScale = options.textSize === "small" ? 0.9 : options.textSize === "large" ? 1.12 : 1;
  const spacingScale = options.spacing === "compact" ? 0.78 : 1;
  const reference = options.template === "reference";
  const bodySize = (reference ? 11.5 : 10.5) * sizeScale;
  return {
    bodySize,
    bodyLineHeight: bodySize * (reference ? 1.58 : 1.46),
    headingSize: (reference ? 15 : 14) * sizeScale,
    smallHeadingSize: (reference ? 12.5 : 11.5) * sizeScale,
    labelSize: 8.8 * sizeScale,
    blockGap: 8 * spacingScale,
    messageGap: (reference ? 24 : 16) * spacingScale
  };
}

function drawOpening(context: PdfContext, title: string, providerName: string): number {
  const { page } = context.cursor;
  const { height } = page.getSize();
  const { margin, bodyWidth } = context.layout;
  const { regular, bold } = context.fonts;
  const theme = context.theme;

  if (theme.id === "reference") {
    let titleY = height - margin - 14;
    for (const line of wrapText(title, bold, 14, bodyWidth)) {
      page.drawText(line, { x: margin, y: titleY, size: 14, font: bold, color: hexColor(theme.text) });
      titleY -= 20;
    }
    return titleY - 20;
  }

  if (theme.id === "terminal-ledger") {
    page.drawText("AI CHAT EXPORTER", {
      x: margin,
      y: height - 48,
      size: 9,
      font: bold,
      color: hexColor(theme.userAccent)
    });
    page.drawText("AI CHAT EXPORTER", {
      x: margin,
      y: height - 87,
      size: 22,
      font: regular,
      color: hexColor(theme.text)
    });
    page.drawText(`${providerName} · ${normalizePdfText(title)}`, {
      x: margin,
      y: height - 114,
      size: 9,
      font: regular,
      color: hexColor(theme.muted)
    });
    return height - 162;
  }

  if (theme.id === "midnight-index") {
    page.drawText("AI CHAT EXPORTER", {
      x: margin,
      y: height - 48,
      size: 9,
      font: bold,
      color: hexColor(theme.userAccent)
    });
    page.drawText("AI CHAT EXPORTER", {
      x: margin,
      y: height - 87,
      size: 22,
      font: regular,
      color: hexColor(theme.text)
    });
    page.drawText(`${providerName} · ${normalizePdfText(title)}`, {
      x: margin,
      y: height - 114,
      size: 9,
      font: regular,
      color: hexColor(theme.muted)
    });
    return height - 162;
  }

    page.drawText("AI CHAT EXPORTER", {
    x: margin,
    y: height - 42,
    size: 8.5,
    font: bold,
    color: hexColor(theme.userAccent)
  });

  const titleSize = theme.id === "editorial-ledger" ? 23 : 22;
  let titleY = height - 84;
  for (const line of wrapText(title, bold, titleSize, bodyWidth)) {
    page.drawText(line, {
      x: margin,
      y: titleY,
      size: titleSize,
      font: bold,
      color: hexColor(theme.text)
    });
    titleY -= titleSize + 5;
  }

  page.drawText(`Exported locally from ${providerName}`, {
    x: margin,
    y: titleY - 2,
    size: 8.5,
    font: regular,
    color: hexColor(theme.muted)
  });
  drawRule(context, margin, titleY - 20, A4[0] - margin);
  return titleY - 48;
}

function drawMessageHeading(
  context: PdfContext,
  message: ConversationMessage,
  continued = false
): void {
  const { page, y } = context.cursor;
  const { margin, bodyWidth } = context.layout;
  const { regular, bold } = context.fonts;
  const palette = messagePalette(context, message);
  const isUser = message.role === "user";

  if (context.theme.id === "reference") {
    return;
  }

  if (context.theme.id === "terminal-ledger") {
    const label = isUser ? "YOU" : context.providerName.toUpperCase();
    page.drawText(continued ? `${label} · CONTINUED` : label, {
      x: margin + 14,
      y,
      size: context.metrics.labelSize,
      font: regular,
      color: palette.accent
    });
    context.cursor.y -= 24;
    return;
  }

  if (isUser) {
    const label = continued ? "YOU · CONTINUED" : "YOU";
    const labelWidth = textWidth(bold, label, context.metrics.labelSize);
    page.drawText(label, {
      x: A4[0] - margin - labelWidth,
      y,
      size: context.metrics.labelSize,
      font: bold,
      color: palette.accent
    });
    context.cursor.y -= 12;
    return;
  }

  const style = context.theme.id;
  const label = isUser ? "YOU" : context.providerName.toUpperCase();
  if (style === "soft-cards") {
    page.drawRectangle({
      x: margin,
      y: y - 4,
      width: bodyWidth,
      height: 18,
      color: palette.labelBackground
    });
  } else if (style === "quiet-paper") {
    page.drawRectangle({
      x: margin,
      y: y - 4,
      width: 4,
      height: 18,
      color: palette.accent
    });
  } else if (style === "editorial-ledger") {
    drawRule(context, margin, y - 9, A4[0] - margin);
  }

  page.drawText(continued ? `${label} · CONTINUED` : label, {
    x: margin + 14,
    y,
    size: context.metrics.labelSize,
    font: regular,
    color: palette.accent
  });
  context.cursor.y -= 24;
}

async function drawVisual(context: PdfContext, block: Extract<MessageBlock, { type: "visual" }>): Promise<void> {
  const image = await context.document.embedPng(block.dataUrl);
  const width = Math.min(context.layout.bodyWidth, block.width * 0.75);
  const height = width * image.height / image.width;
  const x = context.layout.margin + (context.layout.bodyWidth - width) / 2;
  const pageHeight = A4[1] - context.layout.margin - context.layout.bottomMargin;
  // Short components stay together. Tall mockups retain readable scale across
  // page slices instead of shrinking into a tiny thumbnail or losing the end.
  ensureRoom(context, height <= pageHeight ? height : 24, false);
  let offset = 0;
  while (offset < height) {
    ensureRoom(context, Math.min(24, height - offset), false);
    const slice = Math.min(height - offset, context.cursor.y - context.layout.bottomMargin);
    const bottom = context.cursor.y - slice;
    const page = context.cursor.page;
    page.pushOperators(pushGraphicsState(), rectangle(x, bottom, width, slice), clip(), endPath());
    page.drawImage(image, { x, y: context.cursor.y - height + offset, width, height });
    page.pushOperators(popGraphicsState());
    context.cursor.y = bottom;
    offset += slice;
  }
  context.cursor.y -= context.metrics.blockGap;
}

function drawBlock(context: PdfContext, block: Exclude<MessageBlock, { type: "visual" }>): void {
  if (block.type === "heading") {
    drawHeading(context, block);
    return;
  }

  if (block.type === "code") {
    drawCode(context, block.code);
    return;
  }

  if (block.type === "table") {
    drawTable(context, block.inlineFormat === "markdown" ? {
      ...block, headers: block.headers.map(readableInline), rows: block.rows.map((row) => row.map(readableInline))
    } : block);
    return;
  }

  const text = block.type === "paragraph"
    ? block.inlineFormat === "markdown" ? readableInline(block.text) : block.text
    : block.type === "math"
      ? `Math: ${block.tex}`
      : `Image: ${block.alt}`;
  drawParagraph(context, text);
}

function readableInline(text: string): string {
  return text.replace(/\[([^\]]+)\]\((https?:[^)]+|mailto:[^)]+)\)/g, "$1 ($2)")
    .replace(/`+\s?([^`]+?)\s?`+/g, "$1")
    .replace(/\\([\\`\[\]<>$#>+*-])/g, "$1");
}

function drawHeading(context: PdfContext, block: Extract<MessageBlock, { type: "heading" }>): void {
  const size = block.level <= 2 ? context.metrics.headingSize : context.metrics.smallHeadingSize;
  const inset = context.theme.id === "reference" ? 0 : 14;
  const lines = wrapText(block.text, context.fonts.bold, size, context.layout.bodyWidth - inset);
  for (const line of lines) {
    ensureRoom(context, size + 8);
    context.cursor.page.drawText(line, {
      x: context.layout.margin + inset,
      y: context.cursor.y - size,
      size,
      font: context.fonts.bold,
      color: hexColor(context.theme.strong)
    });
    if (context.fonts.bold === context.fonts.regular) {
      context.cursor.page.drawText(line, {
        x: context.layout.margin + inset + 0.28,
        y: context.cursor.y - size,
        size,
        font: context.fonts.bold,
        color: hexColor(context.theme.strong)
      });
    }
    context.cursor.y -= size + 5;
  }
  context.cursor.y -= context.metrics.blockGap;
}

function drawParagraph(context: PdfContext, text: string): void {
  const isUser = context.currentRole === "user" && context.theme.id !== "terminal-ledger";
  const reference = context.theme.id === "reference";
  const isQuote = /^\s*>/.test(text);
  const paragraphText = isQuote ? text.replace(/^\s*>\s?/, "") : text;
  const padding = isUser ? reference ? 13 : 8 : 0;
  const inset = reference ? 0 : 14;
  const maxBubbleWidth = context.layout.bodyWidth * (reference ? 0.76 : 0.72);
  const quoteInset = isQuote ? 14 : 0;
  const contentWidth = isUser
    ? maxBubbleWidth - padding * 2
    : context.layout.bodyWidth - inset - quoteInset;
  const lines = wrapInlineText(
    paragraphText,
    context.fonts.regular,
    context.fonts.bold,
    context.metrics.bodySize,
    contentWidth
  );
  const bubbleWidth = isUser
    ? Math.min(
      maxBubbleWidth,
      Math.max(
        120,
        Math.max(...lines.map((line) => inlineLineWidth(line, context.fonts.regular, context.fonts.bold, context.metrics.bodySize))) + padding * 2
      )
    )
    : 0;
  const lineHeight = context.metrics.bodyLineHeight;
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const minimumHeight = lineHeight + padding * 2;
    ensureRoom(context, minimumHeight);
    const availableHeight = context.cursor.y - context.layout.bottomMargin;
    const linesPerPage = Math.max(1, Math.floor((availableHeight - padding * 2) / lineHeight));
    const segment = lines.slice(lineIndex, lineIndex + linesPerPage);
    const contentHeight = segment.length * lineHeight + padding * 2;

    let x = context.layout.margin + inset;
    if (isUser) {
      x = A4[0] - context.layout.margin - bubbleWidth + padding;
      drawRoundedRectangle(context.cursor.page, {
        x: A4[0] - context.layout.margin - bubbleWidth,
        y: context.cursor.y - contentHeight + padding / 2,
        width: bubbleWidth,
        height: contentHeight,
        radius: Math.min(reference ? 20 : 14, contentHeight / 2),
        color: hexColor(context.theme.userSurface),
        borderColor: context.theme.userSurface.toLowerCase() === context.theme.page.toLowerCase()
          || context.options.bubbleStyle === "white-black"
          ? hexColor(context.theme.rule)
          : undefined
      });
    } else if (isQuote) {
      context.cursor.page.drawRectangle({
        x: context.layout.margin,
        y: context.cursor.y - contentHeight + 4,
        width: 3,
        height: contentHeight,
        color: hexColor(context.theme.rule)
      });
      x += quoteInset;
    }

    let lineY = context.cursor.y - padding - context.metrics.bodySize;
    for (const line of segment) {
      drawInlineText(
        context.cursor.page,
        line,
        x,
        lineY,
        context.metrics.bodySize,
        context.fonts.regular,
        context.fonts.bold,
        hexColor(isQuote ? context.theme.muted : isUser ? context.theme.userText : context.theme.text),
        hexColor(isUser ? context.theme.userText : context.theme.strong)
      );
      lineY -= lineHeight;
    }
    context.cursor.y -= contentHeight;
    lineIndex += segment.length;
    if (lineIndex < lines.length) {
      startContinuationPage(context);
    }
  }
  context.cursor.y -= context.metrics.blockGap;
}

function drawCode(context: PdfContext, code: string): void {
  const codeSize = Math.max(8, context.metrics.bodySize - 2);
  const codeLines = code
    .split(/\r?\n/)
    .flatMap((line) => wrapCodeLine(line, context.fonts.mono, codeSize, context.layout.bodyWidth - 38));
  const x = context.layout.margin + (context.theme.id === "reference" ? 0 : 10);
  const lineHeight = codeSize + 4;
  let lineIndex = 0;
  while (lineIndex < codeLines.length) {
    ensureRoom(context, lineHeight + 10);
    const availableHeight = context.cursor.y - context.layout.bottomMargin;
    const linesPerPage = Math.max(1, Math.floor((availableHeight - 10) / lineHeight));
    const segment = codeLines.slice(lineIndex, lineIndex + linesPerPage);
    const codeHeight = segment.length * lineHeight + 10;

    if (context.options.codeStyle === "panel") {
      context.cursor.page.drawRectangle({
        x,
        y: context.cursor.y - codeHeight + 4,
        width: context.layout.bodyWidth - (context.theme.id === "reference" ? 0 : 10),
        height: codeHeight,
        color: hexColor(context.theme.codeSurface)
      });
    } else {
      context.cursor.page.drawRectangle({
        x,
        y: context.cursor.y - codeHeight + 4,
        width: 3,
        height: codeHeight,
        color: hexColor(context.theme.userAccent)
      });
    }

    let lineY = context.cursor.y - codeSize - 1;
    for (const line of segment) {
      context.cursor.page.drawText(line || " ", {
        x: x + 8,
        y: lineY,
        size: codeSize,
        font: context.fonts.mono,
        color: hexColor(context.theme.text)
      });
      lineY -= lineHeight;
    }
    context.cursor.y -= codeHeight;
    lineIndex += segment.length;
    if (lineIndex < codeLines.length) {
      startContinuationPage(context);
    }
  }
  context.cursor.y -= context.metrics.blockGap;
}

function drawTable(context: PdfContext, table: Extract<MessageBlock, { type: "table" }>): void {
  const columnCount = table.rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    table.headers.length
  );
  if (columnCount === 0) {
    return;
  }

  const textSize = Math.max(7.3, (columnCount > 4 ? 7.5 : 8.5) * (context.metrics.bodySize / 10.5));
  const lineHeight = textSize + 3;
  const inset = context.theme.id === "reference" ? 0 : 14;
  const tableX = context.layout.margin + inset;
  const tableWidth = context.layout.bodyWidth - inset;
  const columnWidth = tableWidth / columnCount;
  const headerLines = tableCellLines(context, table.headers, columnCount, textSize, columnWidth);
  drawTableRow(context, headerLines, true, 0, {
    tableX, tableWidth, columnWidth, textSize, lineHeight
  });

  table.rows.forEach((cells, rowIndex) => {
    const cellLines = tableCellLines(context, cells, columnCount, textSize, columnWidth);
    drawTableRow(context, cellLines, false, rowIndex + 1, {
      tableX, tableWidth, columnWidth, textSize, lineHeight
    }, headerLines);
  });

  context.cursor.y -= context.metrics.blockGap;
}

interface TableMetrics {
  tableX: number;
  tableWidth: number;
  columnWidth: number;
  textSize: number;
  lineHeight: number;
}

function tableCellLines(
  context: PdfContext,
  cells: string[],
  columnCount: number,
  textSize: number,
  columnWidth: number
): string[][] {
  return Array.from({ length: columnCount }, (_, index) =>
    wrapText(cells[index] ?? "", context.fonts.bold, textSize, columnWidth - 10)
  );
}

function drawTableRow(
  context: PdfContext,
  cellLines: string[][],
  header: boolean,
  rowIndex: number,
  metrics: TableMetrics,
  repeatedHeader?: string[][]
): void {
  const totalLines = cellLines.reduce(
    (maximum, lines) => Math.max(maximum, lines.length),
    1
  );
  let lineIndex = 0;

  while (lineIndex < totalLines) {
    if (context.cursor.y - (metrics.lineHeight + 10) < context.layout.bottomMargin) {
      startContinuationPage(context);
      if (repeatedHeader) {
        drawRepeatedTableHeader(context, repeatedHeader, metrics);
      }
    }

    const availableHeight = context.cursor.y - context.layout.bottomMargin;
    const linesPerPage = Math.max(1, Math.floor((availableHeight - 10) / metrics.lineHeight));
    const endLine = Math.min(totalLines, lineIndex + linesPerPage);
    const fragmentLines = cellLines.map((lines) => lines.slice(lineIndex, endLine));
    drawTableRowFragment(context, fragmentLines, header, rowIndex, metrics);
    lineIndex = endLine;

    if (lineIndex < totalLines) {
      startContinuationPage(context);
      if (repeatedHeader) {
        drawRepeatedTableHeader(context, repeatedHeader, metrics);
      }
    }
  }
}

function drawRepeatedTableHeader(
  context: PdfContext,
  headerLines: string[][],
  metrics: TableMetrics
): void {
  const availableLines = Math.max(
    1,
    Math.floor((context.cursor.y - context.layout.bottomMargin - 10) / metrics.lineHeight)
  );
  const contextLineLimit = Math.max(1, Math.min(3, availableLines - 1));
  const contextLines = headerLines.map((lines) => lines.slice(0, contextLineLimit));
  drawTableRowFragment(context, contextLines, true, 0, metrics);
}

function drawTableRowFragment(
  context: PdfContext,
  cellLines: string[][],
  header: boolean,
  rowIndex: number,
  metrics: TableMetrics
): void {
  const fragmentLineCount = cellLines.reduce(
    (maximum, lines) => Math.max(maximum, lines.length),
    1
  );
  const rowHeight = fragmentLineCount * metrics.lineHeight + 10;
  const fill = tableFill(context, header, rowIndex);
  context.cursor.page.drawRectangle({
    x: metrics.tableX,
    y: context.cursor.y - rowHeight + 4,
    width: metrics.tableWidth,
    height: rowHeight,
    color: fill,
    borderColor: hexColor(context.theme.rule),
    borderWidth: 0.5
  });

  for (let column = 0; column < cellLines.length; column += 1) {
    const x = metrics.tableX + column * metrics.columnWidth;
    if (column > 0) {
      context.cursor.page.drawLine({
        start: { x, y: context.cursor.y - rowHeight + 4 },
        end: { x, y: context.cursor.y + 4 },
        thickness: 0.5,
        color: hexColor(context.theme.rule)
      });
    }

    let cellY = context.cursor.y - metrics.textSize - 1;
    for (const line of cellLines[column]) {
      context.cursor.page.drawText(line, {
        x: x + 5,
        y: cellY,
        size: metrics.textSize,
        font: header ? context.fonts.bold : context.fonts.regular,
        color: hexColor(context.theme.text)
      });
      if (header && context.fonts.bold === context.fonts.regular) {
        context.cursor.page.drawText(line, {
          x: x + 5.18,
          y: cellY,
          size: metrics.textSize,
          font: context.fonts.bold,
          color: hexColor(context.theme.strong)
        });
      }
      cellY -= metrics.lineHeight;
    }
  }
  context.cursor.y -= rowHeight;
}

function tableFill(context: PdfContext, header: boolean, rowIndex: number): RGB {
  if (context.options.tableStyle === "rules") {
    return hexColor(context.theme.page);
  }
  if (header && context.options.tableStyle === "accent") {
    return hexColor(context.theme.userSurface);
  }
  if (header) {
    return hexColor(context.theme.tableHeader);
  }
  return rowIndex % 2 === 0 ? hexColor(context.theme.tableRow) : hexColor(context.theme.page);
}

function ensureRoom(context: PdfContext, height: number, repeatRole = true): void {
  if (context.cursor.y - height >= context.layout.bottomMargin) {
    return;
  }

  startContinuationPage(context, repeatRole);
}

function startContinuationPage(context: PdfContext, repeatRole = true): void {
  const page = context.document.addPage(A4);
  fillPage(page, context.theme.page);
  context.cursor.page = page;
  context.cursor.y = A4[1] - context.layout.margin;
  if (context.theme.id === "reference") {
    return;
  }
      page.drawText("AI CHAT EXPORTER", {
    x: context.layout.margin,
    y: context.cursor.y,
    size: 8,
    font: context.fonts.bold,
    color: hexColor(context.theme.muted)
  });
  context.cursor.y -= 24;
  if (repeatRole && context.currentRole) {
    drawMessageHeading(context, {
      id: "continuation",
      role: context.currentRole,
      blocks: []
    }, true);
  }
}

function drawFooters(context: PdfContext): void {
  const pages = context.document.getPages();
  const totalPages = pages.length;
  for (const [index, page] of pages.entries()) {
    const { width } = page.getSize();
    const margin = context.layout.margin;
    if (context.theme.id === "reference") {
      const pageLabel = `${index + 1} / ${totalPages}`;
      page.drawText(pageLabel, {
        x: width - margin - textWidth(context.fonts.regular, pageLabel, 8),
        y: 18,
        size: 8,
        font: context.fonts.regular,
        color: hexColor(context.theme.muted)
      });
    } else {
      drawRuleOnPage(page, margin, 34, width - margin, context.theme.rule);
      page.drawText(`LOCAL EXPORT  /  ${index + 1}`, {
        x: margin,
        y: 18,
        size: 7.5,
        font: context.fonts.regular,
        color: hexColor(context.theme.muted)
      });
    }
  }
}

function messagePalette(context: PdfContext, message: ConversationMessage): MessagePalette {
  const isUser = message.role === "user";
  const theme = context.theme;
  let accent = isUser ? theme.userAccent : theme.assistantAccent;
  let surface = isUser ? theme.userSurface : theme.assistantSurface;

  if (context.options.speakerColors === "high-contrast") {
    const dark = isDarkTheme(theme.page);
    accent = isUser ? (dark ? "#F8FAFC" : "#0B63CE") : (dark ? "#F5F7FA" : "#101820");
    surface = isUser ? (dark ? theme.userSurface : "#E7F0FF") : theme.assistantSurface;
  } else if (context.options.speakerColors === "mono") {
    accent = isUser ? theme.text : theme.muted;
    surface = isUser ? "#F0F1F2" : theme.page;
  }

  return {
    accent: hexColor(accent),
    labelBackground: hexColor(surface),
    body: hexColor(theme.text),
    heading: hexColor(theme.strong),
    tableHeader: hexColor(theme.tableHeader),
    surface: hexColor(surface)
  };
}

function isDarkTheme(value: string): boolean {
  const hex = value.replace(/^#/, "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance < 0.25;
}

interface InlineRun {
  text: string;
  bold: boolean;
}

function wrapInlineText(text: string, font: PDFFont, bold: PDFFont, size: number, width: number): InlineRun[][] {
  if (/\n/.test(text)) {
    return text.split(/\r?\n/).flatMap((line) => wrapInlineText(line, font, bold, size, width));
  }
  const runs = parseInlineText(text);
  const lines: InlineRun[][] = [];
  let line: InlineRun[] = [];
  let lineWidth = 0;

  for (const run of runs) {
    const runFont = run.bold ? bold : font;
    for (const fragment of splitInlineRun(run, runFont, size, width)) {
      const fragmentWidth = textWidth(runFont, fragment.text, size);
      if (lineWidth + fragmentWidth > width && line.length > 0) {
        lines.push(line);
        const trimmed = fragment.text.replace(/^\s+/, "");
        line = trimmed ? [{ ...fragment, text: trimmed }] : [];
        lineWidth = trimmed ? textWidth(runFont, trimmed, size) : 0;
        continue;
      }

      const previous = line.at(-1);
      if (previous && previous.bold === fragment.bold) {
        previous.text += fragment.text;
      } else {
        line.push({ ...fragment });
      }
      lineWidth += fragmentWidth;
    }
  }

  if (line.length > 0) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [[{ text: "", bold: false }]];
}

function parseInlineText(text: string): InlineRun[] {
  return normalizePdfText(text)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => part.startsWith("**") && part.endsWith("**")
      ? { text: part.slice(2, -2), bold: true }
      : { text: part, bold: false });
}

function splitInlineRun(run: InlineRun, font: PDFFont, size: number, width: number): InlineRun[] {
  const words = run.text.match(/\S+\s*|\s+/g) ?? [];
  const fragments: InlineRun[] = [];

  for (const word of words) {
    if (textWidth(font, word, size) <= width) {
      fragments.push({ ...run, text: word });
      continue;
    }

    for (const piece of splitLongWord(word, font, size, width)) {
      fragments.push({ ...run, text: piece });
    }
  }

  return fragments;
}

function drawInlineText(
  page: PDFPage,
  runs: InlineRun[],
  x: number,
  y: number,
  size: number,
  regular: PDFFont,
  bold: PDFFont,
  textColor: RGB,
  boldColor: RGB = textColor
): void {
  let currentX = x;
  for (const run of runs) {
    const font = run.bold ? bold : regular;
    const color = run.bold ? boldColor : textColor;
    page.drawText(run.text, { x: currentX, y, size, font, color });
    if (run.bold && bold === regular) {
      page.drawText(run.text, { x: currentX + 0.35, y, size, font, color });
    }
    currentX += textWidth(font, run.text, size);
  }
}

function inlineLineWidth(line: InlineRun[], font: PDFFont, bold: PDFFont, size: number): number {
  return line.reduce((width, run) => width + textWidth(run.bold ? bold : font, run.text, size), 0);
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = normalizePdfText(text).replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(font, candidate, size) <= width) {
      line = candidate;
      continue;
    }

    if (line) {
      lines.push(line);
    }

    const pieces = splitLongWord(word, font, size, width);
    lines.push(...pieces.slice(0, -1));
    line = pieces.at(-1) ?? "";
  }

  if (line) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : [""];
}

function wrapCodeLine(text: string, font: PDFFont, size: number, width: number): string[] {
  return splitLongWord(normalizePdfText(text).replace(/\t/g, "  "), font, size, width);
}

function splitLongWord(word: string, font: PDFFont, size: number, width: number): string[] {
  if (textWidth(font, word, size) <= width) {
    return [word];
  }

  const characters = Array.from(word);
  const pieces: string[] = [];
  let start = 0;
  while (start < characters.length) {
    // Probe short prefixes before binary search. Measuring every growing
    // prefix repeatedly shapes the same CJK text and long code tokens.
    const remaining = characters.length - start;
    const prefix = (length: number): string => characters.slice(start, start + length).join("");
    let fitting = 1;
    let probe = Math.min(2, remaining);
    while (probe > fitting && textWidth(font, prefix(probe), size) <= width) {
      fitting = probe;
      probe = Math.min(probe * 2, remaining);
    }
    let upper = probe;
    while (upper - fitting > 1) {
      const middle = Math.floor((fitting + upper) / 2);
      if (textWidth(font, prefix(middle), size) <= width) fitting = middle;
      else upper = middle;
    }
    pieces.push(prefix(fitting));
    start += fitting;
  }
  return pieces;
}

function textWidth(font: PDFFont, text: string, size: number): number {
  if (font.name !== StandardFonts.Helvetica && font.name !== StandardFonts.HelveticaBold
    && font.name !== StandardFonts.Courier) {
    // Fontkit shapes each measured word. Reuse exact measurements during
    // wrapping, with a bounded cache for long conversations.
    if (text.length > 200) return font.widthOfTextAtSize(text, size);
    let widths = embeddedTextWidths.get(font);
    if (!widths) {
      widths = new Map();
      embeddedTextWidths.set(font, widths);
    }
    let width = widths.get(text);
    if (width === undefined) {
      width = font.widthOfTextAtSize(text, 1);
      if (widths.size >= 2_048) widths.clear();
      widths.set(text, width);
    }
    return width * size;
  }
  // pdf-lib measures kerning pairs but draws standard-font text without kerning.
  // Match actual PDF advance widths so wrapping and bold runs cannot overflow.
  let widths = standardGlyphWidths.get(font);
  if (!widths) {
    widths = new Map();
    standardGlyphWidths.set(font, widths);
  }
  let total = 0;
  for (const character of text) {
    let width = widths.get(character);
    if (width === undefined) {
      width = font.widthOfTextAtSize(character, 1);
      widths.set(character, width);
    }
    total += width;
  }
  return total * size;
}

function fillPage(page: PDFPage, fill: string): void {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width, height, color: hexColor(fill) });
}

function drawRoundedRectangle(
  page: PDFPage,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    color: RGB;
    borderColor?: RGB;
  }
): void {
  const { x, y, width, height, radius, color } = options;
  if (options.borderColor) {
    drawRoundedShape(page, {
      x: x - 0.7,
      y: y - 0.7,
      width: width + 1.4,
      height: height + 1.4,
      radius: radius + 0.7,
      color: options.borderColor
    });
  }
  drawRoundedShape(page, { x, y, width, height, radius, color });
}

function drawRoundedShape(
  page: PDFPage,
  options: { x: number; y: number; width: number; height: number; radius: number; color: RGB }
): void {
  const { x, y, width, height, radius, color } = options;
  const diameter = radius * 2;
  page.drawRectangle({ x: x + radius, y, width: width - diameter, height, color });
  page.drawRectangle({ x, y: y + radius, width, height: height - diameter, color });
  for (const point of [
    [x + radius, y + radius],
    [x + width - radius, y + radius],
    [x + radius, y + height - radius],
    [x + width - radius, y + height - radius]
  ]) {
    page.drawCircle({ x: point[0], y: point[1], size: radius, color });
  }
}

function drawRule(context: PdfContext, x: number, y: number, x2: number): void {
  drawRuleOnPage(context.cursor.page, x, y, x2, context.theme.rule);
}

function drawRuleOnPage(page: PDFPage, x: number, y: number, x2: number, stroke: string): void {
  page.drawLine({
    start: { x, y },
    end: { x: x2, y },
    thickness: 0.6,
    color: hexColor(stroke)
  });
}

function hexColor(hex: string): RGB {
  const value = hex.replace(/^#/, "");
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255
  );
}

export function normalizePdfText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[⭐★☆]+/g, (stars) => `${[...stars].filter((star) => star !== "☆").length}/5`)
    .replace(/🥇/g, "1")
    .replace(/🥈/g, "2")
    .replace(/🥉/g, "3")
    .replace(/\u00A0/g, " ");
}
