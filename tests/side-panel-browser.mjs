import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Only a fresh profile and locally routed synthetic chat are used. The test-only
// extension iframe supplies a trusted button gesture without a toolbar UI driver.
// It submits the production setOptions/open calls synchronously, not an API mock.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const executable = process.env.PLAYWRIGHT_EXECUTABLE;
if (!executable) throw new Error('Set PLAYWRIGHT_EXECUTABLE to Chromium supporting unpacked extensions.');
const temp = await mkdtemp(join(tmpdir(), 'ai-exporter-native-panel-'));
const extensionPath = join(temp, 'extension');
let context;
let browserSession;
const checks = [];
try {
  await cp(resolve('dist'), extensionPath, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('sidePanel'), 'Build the native-panel production manifest first.');
  assert.equal(manifest.action.default_popup, undefined, 'Toolbar action must not retain a transient popup.');
  // Host grants and iframe resources belong only to this disposable test copy.
  manifest.host_permissions = ['https://chatgpt.com/*', 'https://gemini.google.com/*'];
  manifest.web_accessible_resources = [{ resources: ['qa/panel-driver.html', 'qa/panel-driver.js'], matches: manifest.host_permissions }];
  await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
  await mkdir(join(extensionPath, 'qa'), { recursive: true });
  await writeFile(join(extensionPath, 'qa/panel-driver.html'), '<!doctype html><html><body><button id="open">Open native export panel</button><output id="result">Ready</output><script src="panel-driver.js"></script></body></html>');
  await writeFile(join(extensionPath, 'qa/panel-driver.js'), `
const tabId = Number(new URL(location.href).searchParams.get('sourceTabId'));
document.getElementById('open').addEventListener('click', event => {
  document.getElementById('result').textContent = event.isTrusted ? 'Opening' : 'Untrusted click';
  if (!event.isTrusted) return;
  const options = chrome.sidePanel.setOptions({tabId, path: 'popup/index.html?mode=panel&sourceTabId=' + tabId, enabled: true});
  const opened = chrome.sidePanel.open({tabId});
  Promise.all([options, opened])
    .then(() => {document.getElementById('result').textContent = 'Opened'})
    .catch(error => {document.getElementById('result').textContent = 'Error: ' + error.message});
});`);
  const downloadDirectory = join(temp, 'downloads');
  await mkdir(downloadDirectory);
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
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
  const sourceUrl = 'https://chatgpt.com/c/native-panel-fixture?provider=chatgpt&count=12';
  await source.goto(sourceUrl);
  const sourceTabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, sourceUrl);
  const originalScroll = await source.locator('#chat').evaluate(element => element.scrollTop);
  const ordinaryTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(({ id, url }) => ({ id, url })).sort((a, b) => a.id - b.id));
  const iframe = await source.evaluateHandle(url => {
    const frame = document.createElement('iframe');
    frame.id = 'native-panel-driver';
    frame.src = url;
    frame.style.cssText = 'position:fixed;right:8px;bottom:8px;width:280px;height:64px;z-index:9999;background:white';
    document.body.append(frame);
    return frame;
  }, `chrome-extension://${extensionId}/qa/panel-driver.html?sourceTabId=${sourceTabId}`);
  const driver = source.frameLocator('#native-panel-driver');
  await driver.locator('#open').click();
  await driver.locator('#result').filter({ hasText: /Opened|Error:/ }).waitFor({ timeout: 15000 });
  assert.equal(await driver.locator('#result').textContent(), 'Opened', 'Native setOptions/open rejected the trusted gesture.');
  const contexts = await worker.evaluate(async () => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
  const native = contexts.find(item => item.documentUrl?.includes(`mode=panel&sourceTabId=${sourceTabId}`));
  assert.ok(native, 'Native SIDE_PANEL document was not created; an ordinary extension tab is insufficient.');
  assert.equal(source.url(), sourceUrl);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({})).map(({ id, url }) => ({ id, url })).sort((a, b) => a.id - b.id)), ordinaryTabs);
  assert.ok(await worker.evaluate(async tabId => (await chrome.tabs.get(tabId)).active, sourceTabId), 'Opening the panel must keep the source tab active.');
  checks.push('Trusted extension-page gesture opens real SIDE_PANEL context; source tab remains active and unchanged; no ordinary tab created');
  await iframe.dispose();

  // Chromium sometimes does not expose side-panel WebContents as Playwright
  // Pages. Attach its actual DevTools target rather than opening a stand-in tab.
  let target;
  for (let attempt = 0; attempt < 40 && !target; attempt++) {
    target = (await browserSession.send('Target.getTargets')).targetInfos.find(item => item.url === native.documentUrl);
    if (!target) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(target, 'Native panel opened, but its document target is unavailable for export verification.');
  const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let nextCommand = 1;
  const pending = new Map();
  browserSession.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const command = (method, params) => new Promise((resolveCommand, reject) => {
    const id = nextCommand++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native panel command timed out: ${method}`)); }, 15000);
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
    throw new Error(`Native panel did not reach ${label}: ${await evaluate('document.getElementById("status")?.textContent')}`);
  };
  await waitFor('Boolean(document.getElementById("export-button") && !document.getElementById("export-button").disabled)', 'ready state');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("mode")'), 'panel');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("sourceTabId")'), String(sourceTabId));
  assert.equal(await evaluate('document.getElementById("preview-details")?.open'), false, 'Native panel preview starts collapsed.');
  await mkdir(resolve('output/playwright'), { recursive: true });
  for (const format of ['markdown', 'pdf']) {
    await evaluate(`document.querySelector('[data-format="${format}"]').click()`);
    await waitFor('!document.getElementById("export-button").disabled', `${format} controls`);
    await evaluate('document.getElementById("export-button").click()');
    await waitFor('document.getElementById("status")?.textContent.startsWith("Saved")', `${format} download completion`);
    const suffix = format === 'pdf' ? '.pdf' : '.md';
    const downloads = await worker.evaluate(async suffix => (await chrome.downloads.search({})).filter(item => item.filename.endsWith(suffix)), suffix);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].state, 'complete');
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
    await writeFile(resolve(`output/playwright/qa-native-panel${suffix}`), file);
    assert.equal(source.url(), sourceUrl);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.tabs.query({})).map(({ id, url }) => ({ id, url })).sort((a, b) => a.id - b.id)), ordinaryTabs);
    assert.equal(await source.locator('#chat').evaluate(element => element.scrollTop), originalScroll);
    assert.equal(await evaluate('document.getElementById("preview-details")?.open'), false, 'Saving must not expand the preview automatically.');
    checks.push(`Native panel exports ${format}, confirms actual download, retains all 12 ordered anchors, restores source scroll, creates no ordinary tab`);
  }
  let screenshotLimitation;
  try {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(resolve('output/playwright/qa-native-panel.png'), Buffer.from(screenshot.data, 'base64'));
  } catch (error) {
    screenshotLimitation = error.message;
  }
  console.log(JSON.stringify({ passed: checks.length, browserVersion: context.browser().version(), headless: process.env.PLAYWRIGHT_HEADED !== '1', checks, screenshotLimitation, limitation: 'Synthetic source and test-only host grants. Native side-panel API and document exercised through trusted extension iframe click; real toolbar activeTab grant and live accounts remain unverified.' }, null, 2));
} finally {
  await browserSession?.detach().catch(() => {});
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
