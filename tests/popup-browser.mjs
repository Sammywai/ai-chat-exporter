import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Use a fresh profile and locally routed synthetic chats. chrome.action.openPopup
// opens the actual toolbar popup; an ordinary extension tab is not a substitute.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const executable = process.env.PLAYWRIGHT_EXECUTABLE;
if (!executable) throw new Error('Set PLAYWRIGHT_EXECUTABLE to Chromium supporting unpacked extensions.');
const temp = await mkdtemp(join(tmpdir(), 'ai-exporter-native-popup-'));
const extensionPath = join(temp, 'extension');
let context;
let browserSession;
const checks = [];
try {
  await cp(resolve('dist'), extensionPath, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.action.default_popup, 'popup/index.html', 'Build the toolbar-popup production manifest first.');
  assert.equal(manifest.side_panel, undefined);
  assert.ok(!manifest.permissions.includes('sidePanel'));
  // Host grants belong only to this disposable test copy. They do not qualify
  // the activeTab grant obtained by a human clicking the production toolbar.
  manifest.host_permissions = ['https://chatgpt.com/*', 'https://gemini.google.com/*'];
  await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
  const downloadDirectory = join(temp, 'downloads');
  await mkdir(downloadDirectory);
  const profile = join(temp, 'profile');
  await mkdir(join(profile, 'Default'), { recursive: true });
  await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloadDirectory } }));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: executable,
    headless: process.env.PLAYWRIGHT_HEADED !== '1',
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: 1440, height: 1000 }
  });
  const fixture = await readFile(resolve('tests/fixtures/virtual-chat.html'), 'utf8');
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^https:\/\/(chatgpt\.com|gemini\.google\.com)\//.test(url)) return route.fulfill({ contentType: 'text/html', body: fixture });
    if (/^https?:/.test(url)) return route.abort('blockedbyclient');
    return route.continue();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  browserSession = await context.browser().newBrowserCDPSession();
  await browserSession.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory, eventsEnabled: true });
  const source = await context.newPage();
  const sourceUrl = 'https://chatgpt.com/c/native-popup-fixture?provider=chatgpt&count=12';
  await source.goto(sourceUrl);
  const sourceTabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, sourceUrl);
  const sourceWindowId = await worker.evaluate(async tabId => (await chrome.tabs.get(tabId)).windowId, sourceTabId);
  const originalScroll = await source.locator('#chat').evaluate(element => element.scrollTop);
  const ordinaryTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(({ id, url }) => ({ id, url })).sort((a, b) => a.id - b.id));
  const openPopup = async () => {
    await source.bringToFront();
    await worker.evaluate(async windowId => chrome.action.openPopup({ windowId }), sourceWindowId);
    const contexts = await worker.evaluate(async () => chrome.runtime.getContexts({ contextTypes: ['POPUP'] }));
    const native = contexts.find(item => item.documentUrl === `chrome-extension://${extensionId}/popup/index.html`);
    assert.ok(native, 'Native POPUP document was not created; an ordinary extension tab is insufficient.');
    let target;
    for (let attempt = 0; attempt < 40 && !target; attempt++) {
      target = (await browserSession.send('Target.getTargets')).targetInfos.find(item => item.url === native.documentUrl);
      if (!target) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target, 'Native popup opened, but its document target is unavailable for export verification.');
    const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let nextCommand = 1;
    const pending = new Map();
    const receive = event => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    };
    browserSession.on('Target.receivedMessageFromTarget', receive);
    const command = (method, params) => new Promise((resolveCommand, reject) => {
      const id = nextCommand++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native popup command timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve: resolveCommand, reject, timer });
      void browserSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => {
        clearTimeout(timer); pending.delete(id); reject(error);
      });
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, label, timeoutMs = 60000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Native popup did not reach ${label}: ${await evaluate('document.getElementById("status")?.textContent')}`);
    };
    const close = async () => {
      await browserSession.send('Target.closeTarget', { targetId: target.targetId });
      browserSession.off('Target.receivedMessageFromTarget', receive);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Native popup closed.'));
      }
      pending.clear();
    };
    await waitFor('Boolean(document.getElementById("export-button") && !document.getElementById("export-button").disabled)', 'ready state');
    assert.equal(await evaluate('location.search'), '', 'Toolbar popup resolves the active tab without a sourceTabId query.');
    assert.equal(await evaluate('document.body.classList.contains("popup-mode")'), true);
    return { command, evaluate, waitFor, close };
  };
  let popup = await openPopup();
  assert.equal(source.url(), sourceUrl);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({})).map(({ id, url }) => ({ id, url })).sort((a, b) => a.id - b.id)), ordinaryTabs);
  assert.ok(await worker.evaluate(async tabId => (await chrome.tabs.get(tabId)).active, sourceTabId), 'Opening the popup must keep the source tab active.');
  assert.equal(await popup.evaluate('document.getElementById("preview-details")?.open'), false, 'Native popup preview starts collapsed.');
  const dimensions = await popup.evaluate('({ width: innerWidth, height: innerHeight, fits: document.documentElement.scrollWidth <= innerWidth })');
  assert.equal(dimensions.width, 380);
  assert.ok(dimensions.height > 0 && dimensions.height <= 600, JSON.stringify(dimensions));
  assert.equal(dimensions.fits, true);
  checks.push('Real POPUP context opens with no query; resolves active source tab; 380px native width, height at most 600px; source remains active and unchanged; no ordinary tab created');
  console.error('Native popup ready; source and dimensions verified.');
  await mkdir(resolve('output/playwright'), { recursive: true });
  for (const format of ['markdown', 'pdf']) {
    const priorDownloads = await worker.evaluate(async () => (await chrome.downloads.search({})).map(item => item.id));
    await popup.evaluate(`document.querySelector('[data-format="${format}"]').click()`);
    await popup.waitFor('!document.getElementById("export-button").disabled', `${format} controls`);
    await popup.evaluate('document.getElementById("export-button").click()');
    await popup.waitFor('document.getElementById("status")?.textContent.startsWith("Saved")', `${format} download completion`);
    console.error(`Native popup ${format} download complete.`);
    const suffix = format === 'pdf' ? '.pdf' : '.md';
    const downloads = await worker.evaluate(async ids => (await chrome.downloads.search({})).filter(item => !ids.includes(item.id)), priorDownloads);
    assert.equal(downloads.length, 1, JSON.stringify(downloads));
    assert.equal(downloads[0].state, 'complete');
    assert.ok(downloads[0].filename.startsWith(downloadDirectory + '/'), `Keep test downloads inside disposable directory: ${JSON.stringify(downloads[0])}`);
    const file = await readFile(downloads[0].filename);
    if (format === 'markdown') {
      const text = file.toString('utf8');
      assert.deepEqual(Array.from(text.matchAll(/\bMessage\s+(\d+)\b/g), match => Number(match[1])), Array.from({ length: 12 }, (_, index) => index));
    } else {
      assert.equal(file.subarray(0, 5).toString(), '%PDF-');
      const pdf = await getDocument({ data: new Uint8Array(file), disableWorker: true, standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)) }).promise;
      let text = '';
      for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => item.str).join(' ') + ' ';
      assert.deepEqual(Array.from(text.matchAll(/\bMessage\s+(\d+)\b/g), match => Number(match[1])), Array.from({ length: 12 }, (_, index) => index));
      await pdf.destroy();
    }
    await writeFile(resolve(`output/playwright/qa-native-popup${suffix}`), file);
    assert.equal(source.url(), sourceUrl);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({})).map(({ id, url }) => ({ id, url })).sort((a, b) => a.id - b.id)), ordinaryTabs);
    assert.equal(await source.locator('#chat').evaluate(element => element.scrollTop), originalScroll);
    assert.equal(await popup.evaluate('document.getElementById("preview-details")?.open'), false, 'Saving must not expand the preview automatically.');
    checks.push(`Native popup exports ${format}, confirms actual download, retains all 12 ordered anchors, restores source scroll, creates no ordinary tab`);
  }
  await popup.evaluate('document.getElementById("preview-details").open = true');
  await popup.waitFor('document.getElementById("preview-document").width > 300 && document.getElementById("preview-loading").hidden', 'rendered PDF preview');
  const preview = await popup.evaluate('({ fits: document.documentElement.scrollWidth <= innerWidth, paperWidth: document.querySelector(".paper").getBoundingClientRect().width, canvasWidth: document.getElementById("preview-document").getBoundingClientRect().width, height: innerHeight })');
  assert.equal(preview.fits, true);
  assert.ok(preview.canvasWidth <= 380 && preview.canvasWidth <= preview.paperWidth, JSON.stringify(preview));
  assert.ok(preview.height <= 600);
  checks.push('Actual PDF preview renders inside 380px popup without horizontal overflow; expanded height stays within native 600px limit');
  let screenshotLimitation;
  try {
    const screenshot = await popup.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(resolve('output/playwright/qa-native-popup.png'), Buffer.from(screenshot.data, 'base64'));
  } catch (error) {
    screenshotLimitation = error.message;
  }
  await popup.close();

  await source.goto('https://chatgpt.com/c/close-popup-fixture?count=80');
  const closingScroll = await source.locator('#chat').evaluate(element => element.scrollTop);
  popup = await openPopup();
  await popup.evaluate('document.querySelector("[data-format=markdown]").click(); document.getElementById("export-button").click()');
  await popup.waitFor('document.getElementById("status")?.textContent.startsWith("Scanning messages")', 'active scan');
  await popup.close();
  const deadline = Date.now() + 10000;
  let locked = true;
  while (locked && Date.now() < deadline) {
    locked = await worker.evaluate(async tabId => {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: () => Boolean(window.__aiChatCapture) });
      return injection.result;
    }, sourceTabId);
    if (locked) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(locked, false, 'Closing native popup must release source capture lock.');
  assert.equal(await source.locator('#chat').evaluate(element => element.scrollTop), closingScroll, 'Closing native popup restores source scroll.');
  popup = await openPopup();
  assert.equal(await popup.evaluate('document.getElementById("status").textContent'), 'Ready to save the whole conversation.');
  await popup.close();
  checks.push('Closing real popup during 80-message scan releases source lock and restores scroll; reopened toolbar popup is ready');
  console.log(JSON.stringify({ passed: checks.length, browserVersion: context.browser().version(), headless: process.env.PLAYWRIGHT_HEADED !== '1', checks, screenshotLimitation, limitation: 'Synthetic source and temporary test-only host grants. Native action.openPopup and POPUP document exercised; real toolbar activeTab grant, focus loss from a native Save As dialog, and live accounts remain unverified.' }, null, 2));
} finally {
  await browserSession?.detach().catch(() => {});
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
