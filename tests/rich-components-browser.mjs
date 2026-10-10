import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { captureConversation } from '../dist/adapters/capture.js';
import { renderPdf } from '../dist/renderers/pdf.js';
import { createGptPdfOptions } from '../dist/shared/pdf-options.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fonts = new Map(await Promise.all(['Inter-Regular.ttf', 'Inter-Bold.ttf', 'NotoSansSC.ttf'].map(async filename => [
  `assets/${filename}`, await readFile(new URL(`../static/assets/${filename}`, import.meta.url))
])));
globalThis.chrome = { runtime: { getURL(path) {
  assert.ok(fonts.has(path), `Unexpected PDF asset: ${path}`);
  return `data:font/ttf;base64,${fonts.get(path).toString('base64')}`;
}}};
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
  : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const checks = [];
const timings = [];
const pixelDifferences = [];

function countColor(pixels, hex, tolerance = 4) {
  const rgb = hex.match(/\w\w/g).map(value => Number.parseInt(value, 16));
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (rgb.every((channel, index) => Math.abs(pixels[offset + index] - channel) <= tolerance)
      && pixels[offset + 3] > 240) count += 1;
  }
  return count;
}

async function imagePixels(dataUrl) {
  const image = await loadImage(dataUrl);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
}

async function compareSourcePixels(sourcePng, visual) {
  const source = await loadImage(sourcePng);
  const raster = await loadImage(visual.dataUrl);
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  const expected = context.getImageData(0, 0, source.width, source.height).data;
  context.clearRect(0, 0, source.width, source.height);
  context.drawImage(raster, 0, 0, source.width, source.height);
  const actual = context.getImageData(0, 0, source.width, source.height).data;
  let difference = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) difference += Math.abs(actual[offset + channel] - expected[offset + channel]);
  }
  return difference / (source.width * source.height * 3);
}

async function pdfPixels(bytes, prefix) {
  const document = await getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname
  }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pdfPage = await document.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: 1.5 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
      await writeFile(`output/${prefix}-${pageNumber}.png`, canvas.toBuffer('image/png'));
    }
    return pages;
  } finally { await document.destroy(); }
}

async function checkStreamedWords() {
  await page.setViewportSize({ width: 660, height: 900 });
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing:border-box; } body { margin:10px; font:20px Arial; }
    #streamed { width:100%; max-width:640px; padding:20px; background:white; color:#25223b; }
    h2 { color:#f42525; font-size:36px; } button { font:inherit; padding:12px; }
    [data-d-stream-word] { animation:d-word-fade-in .7s backwards; }
    @keyframes d-word-fade-in { from { opacity:0; } to { opacity:1; } }
  </style></head><body><article data-chatgpt-search-unit-key="streamed:assistant">
    <div data-dil-message-id="streamed-message"><div data-d-component="box" id="streamed">
      <h2><span data-d-stream-word>STREAMED WORDS</span></h2>
      <p><span data-d-stream-word>Visible paragraph words remain readable.</span></p>
      <button><span data-d-stream-word>Readable action</span></button>
    </div></div>
  </article></body></html>`);
  // Finish the existing source animation synchronously. A staged clone starts
  // its own backwards-filled fade unless capture disables motion before mount.
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
  const readableSource = await page.locator('#streamed').screenshot();
  await page.setViewportSize({ width: 199, height: 900 });
  const original = await page.evaluate(() => ({ html: document.body.innerHTML, scroll: window.scrollY,
    opacities: Array.from(document.querySelectorAll('[data-d-stream-word]')).map(node => getComputedStyle(node).opacity) }));
  assert.ok(original.opacities.every(opacity => opacity === '1'), 'Original streamed words are already visible');
  const result = await page.evaluate(async source => (0, eval)(`(${source})`)('chatgpt', { mode: 'preview' }), captureConversation.toString());
  assert.equal(result.status, 'captured', result.message);
  const visual = result.conversation.messages[0].blocks.find(block => block.type === 'visual');
  assert.ok(visual.width >= 640, 'Narrow source uses staged readable-width capture');
  const raster = await imagePixels(visual.dataUrl);
  assert.ok(countColor(raster.pixels, 'f42525') > 100, 'Streamed heading words remain visible in PNG');
  const meanPixelDifference = await compareSourcePixels(readableSource, visual);
  assert.ok(meanPixelDifference < 6, `Streamed words agree with visible source: ${meanPixelDifference.toFixed(2)}`);
  assert.deepEqual(await page.evaluate(() => ({ html: document.body.innerHTML, scroll: window.scrollY,
    opacities: Array.from(document.querySelectorAll('[data-d-stream-word]')).map(node => getComputedStyle(node).opacity) })), original,
  'Staged capture leaves source DOM, scroll and visible word opacity unchanged');
  pixelDifferences.push({ component: 'streamed-words', meanChannelDifference: Number(meanPixelDifference.toFixed(2)) });
  checks.push('Narrow streamed words: backwards fade-in clone remains visible without waiting; PNG/source agreement and source restoration');
  await page.setViewportSize({ width: 1200, height: 900 });
}

async function checkIntrinsicLabels() {
  const fontUrl = `data:font/ttf;base64,${fonts.get('assets/NotoSansSC.ttf').toString('base64')}`;
  const html = `<!doctype html><html><head><style>
    /* Model source/snapshot font metric differences without relying on a
       particular installed system font. The snapshot excludes page font CSS. */
    @font-face { font-family:LabelMetrics; src:url(${fontUrl}); size-adjust:95%; }
    * { box-sizing:border-box; } body { margin:10px; font-family:LabelMetrics,Arial,sans-serif; font-synthesis:style small-caps; }
    #labels { width:100%; max-width:390px; padding:29px; background:#fff8ee; }
    button { display:flex; align-items:center; justify-content:center; width:100%; height:58px; border:0; background:#ddfa84; font-family:inherit; }
    .action { margin:0; font-weight:700; font-size:16px; line-height:26px; color:#f42525; }
    nav { display:flex; margin-top:20px; gap:8px; } nav>div { flex:1; display:flex; flex-direction:column; align-items:center; height:32px; background:white; }
    nav p { margin:0; font-size:9px; line-height:9px; color:#03cfff; }
    .fixed { display:flex; margin-top:20px; gap:10px; } .fixed p { margin:0; font-size:16px; line-height:26px; }
    .class-width { width:16px; color:#8b008b; } .inline-width { color:#b23aee; }
  </style></head><body><article data-chatgpt-search-unit-key="labels:assistant">
    <div data-dil-message-id="labels-message"><div id="labels" data-d-component="box">
      <button><p class="action" data-d-component="text">儲存新範例</p></button>
      <nav>${['項目', '摘要', '圖表', '記錄', '設定'].map(label => `<div><p data-d-component="caption">${label}</p></div>`).join('')}</nav>
      <div class="fixed"><p class="class-width" data-d-component="text">固定</p><p class="inline-width" data-d-component="text" style="width:16px">固定</p></div>
    </div></div>
  </article></body></html>`;
  function colorHeight(raster, hex) {
    const rgb = hex.match(/\w\w/g).map(value => Number.parseInt(value, 16));
    let top = Infinity, bottom = -1;
    for (let y = 0; y < raster.height; y++) {
      for (let x = 0; x < raster.width; x++) {
        const offset = (y * raster.width + x) * 4;
        if (rgb.every((channel, index) => Math.abs(raster.pixels[offset + index] - channel) <= 10)
          && raster.pixels[offset + 3] > 240) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      }
    }
    return bottom - top + 1;
  }
  for (const viewport of [820, 199]) {
    await page.setViewportSize({ width:820, height:900 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const readableSource = await page.locator('#labels').screenshot();
    const metrics = await page.evaluate(() => ({ action: document.querySelector('.action').getBoundingClientRect().width,
      caption: document.querySelector('nav p').getBoundingClientRect().width,
      classWidth: document.querySelector('.class-width').computedStyleMap().get('width').toString() }));
    assert.ok(metrics.action < 80 && metrics.caption < 18, 'Source labels have tighter metrics than snapshot fallback');
    assert.equal(metrics.classWidth, '16px', 'Class-authored width is explicitly fixed');
    await page.setViewportSize({ width:viewport, height:900 });
    const original = await page.evaluate(() => ({ html:document.body.innerHTML, scroll:window.scrollY }));
    const result = await page.evaluate(async source => (0, eval)(`(${source})`)('chatgpt', { mode:'preview' }), captureConversation.toString());
    assert.equal(result.status, 'captured', result.message);
    const visual = result.conversation.messages[0].blocks.find(block => block.type === 'visual');
    assert.equal(visual.width, 390);
    const raster = await imagePixels(visual.dataUrl);
    assert.ok(colorHeight(raster, 'f42525') <= 32, `${viewport}: action label remains on one line`);
    assert.ok(colorHeight(raster, '03cfff') <= 18, `${viewport}: nav captions remain on one line`);
    assert.ok(colorHeight(raster, '8b008b') > 70, `${viewport}: class-authored width retains intended wrapping`);
    assert.ok(colorHeight(raster, 'b23aee') > 70, `${viewport}: inline width retains intended wrapping`);
    const meanPixelDifference = await compareSourcePixels(readableSource, visual);
    assert.ok(meanPixelDifference < 6, `${viewport}: label PNG/source agreement ${meanPixelDifference.toFixed(2)}`);
    pixelDifferences.push({ component:`intrinsic-labels-${viewport}`, meanChannelDifference:Number(meanPixelDifference.toFixed(2)) });
    assert.deepEqual(await page.evaluate(() => ({ html:document.body.innerHTML, scroll:window.scrollY })), original,
      `${viewport}: label capture leaves source DOM and scroll unchanged`);
  }
  checks.push('Intrinsic CJK labels: wide/narrow action and nav remain single-line across font metrics; fixed class/inline widths preserved, PNG/source agreement and source restoration');
  await page.setViewportSize({ width:1200, height:900 });
}

async function checkExistingComponents() {
  await mkdir('output', { recursive: true });
  let fullConversation;
  for (const mode of ['preview', 'complete']) {
    await page.goto(pathToFileURL(resolve('tests/fixtures/rich-components.html')).href);
    await page.evaluate(() => window.scrollTo(0, 120));
    const original = await page.evaluate(() => ({ scroll: window.scrollY, html: document.querySelector('#mockup').outerHTML }));
    const started = performance.now();
    const result = await page.evaluate(async ({ source, mode }) => (0, eval)(`(${source})`)('chatgpt', {
      mode, pollMs: 20, quietMs: 150, settleMs: 100, timeoutMs: 20000
    }), { source: captureConversation.toString(), mode });
    timings.push({ mode, elapsedMs: Math.round(performance.now() - started) });
    assert.equal(result.status, 'captured', result.message);
    assert.equal(result.boundariesReached, mode === 'complete');
    assert.equal(result.conversation.messages.length, 2);
    assert.equal(result.conversation.messages[0].blocks[0].text, 'Capture this synthetic layout example.');
    const blocks = result.conversation.messages[1].blocks;
    const visuals = blocks.filter(block => block.type === 'visual');
    assert.equal(visuals.length, 3, `${mode}: nested components must not duplicate visual roots`);
    assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'visual', 'heading', 'visual', 'heading', 'visual', 'paragraph']);
    assert.match(visuals[0].text, /unit![\s\S]*範例標記[\s\S]*今天檢查新元件[\s\S]*開啟範例[\s\S]*項目[\s\S]*摘要[\s\S]*圖表[\s\S]*記錄[\s\S]*設定/);
    assert.match(visuals[1].text, /Outlined symbols[\s\S]*TEST READY[\s\S]*Colored headings[\s\S]*Segmented status[\s\S]*測試完成，請查看新範例！[\s\S]*Sample message/);
    assert.match(visuals[2].text, /First: Setup[\s\S]*Active[\s\S]*Next: Capture[\s\S]*Then: Validate[\s\S]*Finally: Files and Checks/);
    assert.doesNotMatch(JSON.stringify(blocks), /Copy response|Good response|Regenerate/);
    assert.deepEqual(await page.evaluate(() => ({ scroll: window.scrollY, html: document.querySelector('#mockup').outerHTML })), original,
      `${mode}: source DOM and scroll restored`);
    for (const [index, visual] of visuals.entries()) {
      assert.match(visual.dataUrl, /^data:image\/png;base64,/);
      assert.ok(visual.width > 0 && visual.height > 0);
      const raster = await imagePixels(visual.dataUrl);
      assert.ok(raster.width > 100 && raster.height > 100, `${mode}/${index}: meaningful raster dimensions`);
      const colors = index === 0 ? ['fff8ee', '6243ef', 'ddfa84']
        : index === 1 ? ['eee8ff', 'ff9269', 'f0f5d9', 'e6f2fb', 'ddfa84']
          : ['0d0d0d', '01c75a', 'ececec'];
      for (const color of colors) assert.ok(countColor(raster.pixels, color) > 30, `${mode}/${index}: preserved #${color}`);
      if (mode === 'complete') {
        await writeFile(`output/qa-rich-component-${index + 1}.png`, Buffer.from(visual.dataUrl.split(',')[1], 'base64'));
        const source = await page.locator(`#${['mockup', 'cards', 'sequence'][index]}`).screenshot();
        await writeFile(`output/qa-rich-component-source-${index + 1}.png`, source);
        const meanPixelDifference = await compareSourcePixels(source, visual);
        pixelDifferences.push({ component: ['mockup', 'cards', 'sequence'][index], meanChannelDifference: Number(meanPixelDifference.toFixed(2)) });
        assert.ok(meanPixelDifference < 6, `Visual ${index}: source/raster mean channel difference ${meanPixelDifference.toFixed(2)}; layout must remain faithful`);
      }
    }
    checks.push(`${mode}: three PNG visual roots, nested buttons/CJK/icons/colors retained, source order, no response toolbar, source restored`);
    if (mode === 'complete') fullConversation = result.conversation;
  }
  await page.screenshot({ path: 'output/qa-rich-components-source.png', fullPage: true });
  const pdfStarted = performance.now();
  const pdf = await renderPdf(fullConversation, createGptPdfOptions('light'));
  timings.push({ phase: 'PDF generation', elapsedMs: Math.round(performance.now() - pdfStarted), bytes: pdf.length });
  await writeFile('output/qa-rich-components.pdf', pdf);
  const pdfPages = await pdfPixels(pdf, 'qa-rich-components-pdf');
  for (const color of ['fff8ee', '6243ef', 'ddfa84', 'eee8ff', 'ff9269', 'f0f5d9', 'e6f2fb', '01c75a']) {
    assert.ok(pdfPages.reduce((count, pixels) => count + countColor(pixels, color, color === '01c75a' ? 16 : 8), 0) > 30, `PDF retained #${color}`);
  }
  checks.push(`PDF: ${pdfPages.length} pages rasterized, mockup/card/icon/badge colors retained`);

  // Opening a native side panel can leave the chat only 199 CSS px wide.
  // Snapshot adaptive designs at a readable width without changing that chat.
  await page.setViewportSize({ width: 660, height: 900 });
  await page.goto(pathToFileURL(resolve('tests/fixtures/rich-components.html')).href);
  await page.addStyleTag({ content: 'main { width:100%; padding:10px; } .mockup { width:100%; max-width:390px; } .cards { grid-template-columns:repeat(2,minmax(0,1fr)); }' });
  const narrowIds = ['mockup', 'cards', 'sequence'];
  const readableSources = [];
  for (const id of narrowIds) readableSources.push(await page.locator(`#${id}`).screenshot());
  await page.setViewportSize({ width: 199, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 120));
  const narrowOriginal = await page.evaluate(() => ({
    html: document.body.innerHTML,
    scroll: window.scrollY,
    widths: ['mockup', 'cards', 'sequence'].map(id => document.getElementById(id).getBoundingClientRect().width)
  }));
  assert.ok(narrowOriginal.widths.every(width => width < 200), 'Synthetic source really is narrowed by its viewport');
  const narrowResult = await page.evaluate(async source => (0, eval)(`(${source})`)('chatgpt', {
    mode: 'complete', pollMs: 20, quietMs: 150, settleMs: 100, timeoutMs: 20000
  }), captureConversation.toString());
  assert.equal(narrowResult.status, 'captured', narrowResult.message);
  assert.deepEqual(await page.evaluate(() => ({
    html: document.body.innerHTML,
    scroll: window.scrollY,
    widths: ['mockup', 'cards', 'sequence'].map(id => document.getElementById(id).getBoundingClientRect().width)
  })), narrowOriginal, 'Narrow capture restores original source DOM, layout, and scroll');
  const narrowVisuals = narrowResult.conversation.messages[1].blocks.filter(block => block.type === 'visual');
  assert.equal(narrowVisuals.length, 3);
  assert.ok(narrowVisuals[0].width >= 385 && narrowVisuals[0].width <= 395, `Fixed mobile max-width remains 390px: ${narrowVisuals[0].width}`);
  assert.ok(narrowVisuals.slice(1).every(visual => visual.width >= 640), `Adaptive layouts remain readable: ${narrowVisuals.map(visual => visual.width)}`);
  for (const [index, visual] of narrowVisuals.entries()) {
    assert.match(visual.dataUrl, /^data:image\/png;base64,/);
    const meanPixelDifference = await compareSourcePixels(readableSources[index], visual);
    pixelDifferences.push({ component: `narrow-${narrowIds[index]}`, meanChannelDifference: Number(meanPixelDifference.toFixed(2)) });
    assert.ok(meanPixelDifference < 6, `Narrow ${narrowIds[index]} agrees with readable layout: ${meanPixelDifference.toFixed(2)}`);
  }
  const narrowPdf = await renderPdf(narrowResult.conversation, createGptPdfOptions('light'));
  const narrowPdfDocument = await getDocument({ data: narrowPdf.slice() }).promise;
  try { assert.ok(narrowPdfDocument.numPages <= 5, `Readable narrow-source export does not grow into word columns: ${narrowPdfDocument.numPages} pages`); }
  finally { await narrowPdfDocument.destroy(); }
  checks.push('199px source viewport: adaptive designs rendered at 640px, fixed mobile max-width390px retained; readable-source pixel agreement and source DOM/layout/scroll restored');
  await page.setViewportSize({ width: 1200, height: 900 });

  // Reviewed edge cases use only generated local content. In particular, SVG
  // fragment IDs and canvas bitmap state are not represented by textContent.
  await page.setContent(`<!doctype html><html><head><title>Visual edge cases</title><style>
    * { box-sizing:border-box; } body { margin:20px; color:#25223b; font:18px Arial; }
    article { margin-bottom:20px; } button { font:inherit; color:#25223b; background:#ddfa84; border:0; padding:12px; }
  </style></head><body>
    <article data-chatgpt-search-unit-key="divider-box:assistant">
      <div data-dil-message-id="divider-message"><div data-d-component="box" id="divider-box" style="width:320px;background:#0d0d0d"><div data-d-component="divider" style="height:1px;padding:8px 0;box-sizing:content-box;background:rgba(255,255,255,.05);background-clip:content-box"></div></div></div>
    </article>
    <article data-chatgpt-search-unit-key="root-box:assistant">
      <div data-dil-message-id="root-box" data-d-component="box" id="root-box" style="width:320px;padding:20px;background:#eee8ff;border-radius:12px"><h3>Root component</h3><button>Root action 保留</button></div>
      <button data-testid="copy-turn-action-button">Copy response</button>
    </article>
    <article data-chatgpt-search-unit-key="inline-box:assistant">
      <div data-dil-message-id="inline-message"><p>Before inline <span data-d-component="box" id="inline-box" style="display:inline-block;padding:8px;background:#e6f2fb"><button>Inline action 保留</button></span> after inline.</p></div>
      <button>Regenerate</button>
    </article>
    <article data-chatgpt-search-unit-key="canvas-box:assistant">
      <div data-dil-message-id="canvas-message"><div data-d-component="box" id="canvas-box" style="width:160px;height:120px;padding:10px;background:#fff2e5"><canvas width="140" height="100" style="display:block;width:140px;height:100px">Canvas fallback</canvas></div></div>
    </article>
    <article data-chatgpt-search-unit-key="svg-box:assistant">
      <div data-dil-message-id="svg-message"><div data-d-component="box" id="svg-box" style="width:160px;height:120px;padding:10px;background:#e6f2fb"><svg width="140" height="100" viewBox="0 0 140 100"><defs><rect id="retained-svg-shape" width="80" height="60" fill="#f42525"/></defs><use href="#retained-svg-shape" x="20" y="20"/></svg></div></div>
    </article>
    <article data-chatgpt-search-unit-key="transform-box:assistant">
      <div data-dil-message-id="transform-message"><div data-d-component="box" id="transform-box" style="width:160px;height:160px;padding:40px;background:#eee8ff"><div style="width:80px;height:80px;background:#f42525;transform:rotate(45deg)"></div></div></div>
    </article>
    <article data-chatgpt-search-unit-key="gradient-box:assistant">
      <div data-dil-message-id="gradient-message"><div data-d-component="box" id="gradient-box" style="width:160px;height:120px;padding:10px;background:white"><svg width="140" height="100"><defs><linearGradient id="retained-gradient"><stop offset="0" stop-color="#f42525"/><stop offset="0.5" stop-color="#f42525"/><stop offset="0.5" stop-color="#03cfff"/><stop offset="1" stop-color="#03cfff"/></linearGradient><clipPath id="retained-clip"><rect x="10" y="10" width="120" height="80"/></clipPath></defs><rect width="140" height="100" style="fill:url(#retained-gradient);clip-path:url(#retained-clip)"/></svg></div></div>
    </article>
    <article data-chatgpt-search-unit-key="border-box:assistant">
      <div data-dil-message-id="border-message"><div data-d-component="box" id="border-box" style="width:160px;height:120px;padding:10px;background:white"><div style="width:140px;height:100px;border-top:2px solid #03cfff;border-bottom:8px solid #f42525"></div></div></div>
    </article>
  </body></html>`);
  await page.evaluate(() => {
    const context = document.querySelector('canvas').getContext('2d');
    context.fillStyle = '#03cfff'; context.fillRect(0, 0, 140, 100);
    context.fillStyle = '#f42525'; context.fillRect(20, 20, 80, 60);
  });
  const edgeSource = await page.evaluate(() => document.body.innerHTML);
  const edgeResult = await page.evaluate(async source => (0, eval)(`(${source})`)('chatgpt', { mode: 'preview' }), captureConversation.toString());
  assert.equal(edgeResult.status, 'captured', edgeResult.message);
  assert.equal(edgeResult.conversation.messages.length, 8);
  assert.equal(await page.evaluate(() => document.body.innerHTML), edgeSource, 'Edge capture preserves source DOM');
  const edgeMessages = edgeResult.conversation.messages;
  assert.deepEqual(edgeMessages[1].blocks.map(block => block.type), ['visual'], 'DIL content root can itself be a visual box');
  assert.match(edgeMessages[1].blocks[0].text, /Root component[\s\S]*Root action 保留/);
  assert.deepEqual(edgeMessages[2].blocks.map(block => block.type), ['paragraph', 'visual', 'paragraph'], 'Inline component retains surrounding paragraph order');
  assert.equal(edgeMessages[2].blocks[0].text, 'Before inline');
  assert.match(edgeMessages[2].blocks[1].text, /Inline action 保留/);
  assert.equal(edgeMessages[2].blocks[2].text, 'after inline.');
  assert.doesNotMatch(JSON.stringify(edgeMessages), /Copy response|Regenerate/);
  for (const [index, id] of ['divider-box', 'root-box', 'inline-box', 'canvas-box', 'svg-box', 'transform-box', 'gradient-box', 'border-box'].entries()) {
    const visual = edgeMessages[index].blocks.find(block => block.type === 'visual');
    assert.ok(visual, `${id}: captured visual`);
    assert.match(visual.dataUrl, /^data:image\/png;base64,/);
    const raster = await imagePixels(visual.dataUrl);
    if (id === 'canvas-box') assert.ok(countColor(raster.pixels, '03cfff') > 1000, 'Canvas bitmap background remains visible');
    if (['canvas-box', 'svg-box', 'transform-box', 'gradient-box', 'border-box'].includes(id)) assert.ok(countColor(raster.pixels, 'f42525') > 1000, `${id}: red bitmap/fragment/transform/border pixels retained`);
    if (id === 'gradient-box') assert.ok(countColor(raster.pixels, '03cfff') > 1000, 'CSS local gradient retains both colors');
    const source = await page.locator(`#${id}`).screenshot();
    const meanPixelDifference = await compareSourcePixels(source, visual);
    pixelDifferences.push({ component: id, meanChannelDifference: Number(meanPixelDifference.toFixed(2)) });
    assert.ok(meanPixelDifference < 6, `${id}: source/raster mean channel difference ${meanPixelDifference.toFixed(2)}`);
  }
  checks.push('Reviewed edges: DIL root box/button, inline paragraph component, canvas bitmap, SVG defs/use/gradient/clip fragments, child transform, directional borders, padded content-box divider; PNG/source agreement, no toolbar');

  // Deliberately exceed one page: a readable-width visual must keep both ends,
  // instead of clipping its bottom or shrinking the whole design into one page.
  const tall = createCanvas(400, 3000);
  const context = tall.getContext('2d');
  context.fillStyle = '#eee8ff'; context.fillRect(0, 0, 400, 3000);
  for (const [color, y] of [['#03cfff', 0], ['#ff7803', 1420], ['#ef03b7', 2920]]) {
    context.fillStyle = color; context.fillRect(0, y, 400, 80);
  }
  const tallPdf = await renderPdf({ provider: 'chatgpt', title: 'Tall visual safety', messages: [{ id: 'tall', role: 'assistant', blocks: [
    { type: 'visual', width: 400, height: 3000, text: 'TOP MIDDLE BOTTOM', dataUrl: tall.toDataURL('image/png') }
  ] }] }, createGptPdfOptions('light'));
  await writeFile('output/qa-rich-components-tall.pdf', tallPdf);
  const tallPages = await pdfPixels(tallPdf, 'qa-rich-components-tall');
  assert.ok(tallPages.length > 1, 'Oversized visual keeps readable width across pages');
  assert.ok(countColor(tallPages[0], '03cfff', 8) > 100, 'Top sentinel remains on first page');
  assert.ok(tallPages.some(pixels => countColor(pixels, 'ff7803', 8) > 100), 'Middle sentinel preserved');
  assert.ok(countColor(tallPages.at(-1), 'ef03b7', 8) > 100, 'Bottom sentinel remains on final page');
  checks.push(`Oversized visual: ${tallPages.length} pages, top/middle/bottom preserved at readable width`);
  console.log(JSON.stringify({ passed: checks.length, checks, timings, pixelDifferences }, null, 2));
}

try {
  if (process.argv.includes('--labels-only')) {
    await checkIntrinsicLabels();
    console.log(JSON.stringify({ passed:checks.length, checks, pixelDifferences }, null, 2));
  } else {
    await checkStreamedWords();
    if (process.argv.includes('--streamed-only')) console.log(JSON.stringify({ passed: checks.length, checks, pixelDifferences }, null, 2));
    else { await checkIntrinsicLabels(); await checkExistingComponents(); }
  }
} finally { await browser.close(); }
