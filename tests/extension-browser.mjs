import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cp, readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const temp=await mkdtemp(join(tmpdir(),'chat-export-qa-'));
const extensionPath=join(temp,'extension');
await cp(resolve('dist'),extensionPath,{recursive:true});
const manifest=JSON.parse(await readFile(join(extensionPath,'manifest.json'),'utf8'));
// Test-only permission grants access to synthetic routed sites. Production manifest
// keeps activeTab. This test cannot qualify user-gesture permission granting.
manifest.host_permissions=['https://chatgpt.com/*','https://gemini.google.com/*'];
await writeFile(join(extensionPath,'manifest.json'),JSON.stringify(manifest));
const executable=process.env.PLAYWRIGHT_EXECUTABLE;
if(!executable) throw new Error('Set PLAYWRIGHT_EXECUTABLE to a Chromium binary supporting unpacked extensions.');
const context=await chromium.launchPersistentContext(join(temp,'profile'),{
  executablePath:executable,headless:true,acceptDownloads:true,
  args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],
  viewport:{width:1440,height:1000}
});
const fixture=await readFile(resolve('tests/fixtures/virtual-chat.html'),'utf8');
const compatibilityFixture=await readFile(resolve('tests/fixtures/chatgpt-layouts.html'),'utf8');
const checks=[];
try {
  const worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).hostname;
  await context.route(/https:\/\/(chatgpt\.com|gemini\.google\.com)\//,route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('/hydration-fixture')?compatibilityFixture:fixture}));
  await mkdir('output',{recursive:true});
  for(const provider of ['chatgpt','gemini']) {
    const source=await context.newPage();
    const host=provider==='chatgpt'?'chatgpt.com':'gemini.google.com';
    await source.goto(`https://${host}/${provider==='chatgpt'?'c':'app'}/fixture?provider=${provider}&count=12`);
    await source.waitForLoadState('networkidle');
    const tabId=await worker.evaluate(async sourceUrl=>{
      const tabs=await chrome.tabs.query({});return tabs.find(tab=>tab.url===sourceUrl).id;
    },source.url());
    const popup=await context.newPage();
    await popup.setViewportSize({width:380,height:800});
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html?sourceTabId=${tabId}`);
    await popup.locator('#export-button:enabled').waitFor();
    assert.equal(await popup.locator('.format-mode').count(),2);
    assert.equal(await popup.locator('.theme-mode').count(),2);
    assert.equal(await popup.locator('select,input[type=color]').count(),0);
    assert.equal(await popup.locator('#open-editor').count(),0,'Export must not offer another page');
    assert.equal(await popup.locator('#preview-details').getAttribute('open'),null,'Preview starts collapsed');
    assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(provider==='chatgpt') await popup.screenshot({path:resolve('output/qa-popup.png'),fullPage:true});
    await popup.close();
    const workspace=await context.newPage();
    const errors=[];workspace.on('pageerror',error=>errors.push(error.message));
    const downloadPromise=workspace.waitForEvent('download',{timeout:60000});
    await workspace.goto(`chrome-extension://${extensionId}/popup/index.html?mode=editor&sourceTabId=${tabId}&exportFormat=markdown&autostart=1`);
    const download=await downloadPromise;
    await download.saveAs(resolve(`output/qa-${provider}-full.md`));
    await workspace.locator('#status').filter({hasText:'Saved'}).waitFor({timeout:20000});
    const md=await readFile(resolve(`output/qa-${provider}-full.md`),'utf8');
    for(let i=0;i<12;i++) assert.ok(md.includes(`Message ${i}`),`${provider} missing ${i}`);
    assert.equal((md.match(/^## (You|ChatGPT|Gemini)$/gm)||[]).length,12);
    assert.equal(errors.length,0,errors.join('\n'));
    assert.ok((await workspace.locator('#conversation-meta').innerText()).includes('12 messages captured'));
    // Retained capture exports again even after source tab closes.
    await source.close();
    const retryDownloadPromise=workspace.waitForEvent('download',{timeout:15000});
    await workspace.locator('#export-button').click();
    await (await retryDownloadPromise).saveAs(resolve(`output/qa-${provider}-retry.md`));
    await workspace.locator('#status').filter({hasText:'Saved'}).waitFor();
    assert.equal(await readFile(resolve(`output/qa-${provider}-retry.md`),'utf8'),md);
    checks.push(`${provider}: real extension injection, full scan, actual Blob download completion, cached retry after source closes`);
    if(provider==='gemini') {
      await workspace.screenshot({path:resolve('output/qa-export-workspace.png'),fullPage:true});
      await workspace.locator('[data-format="pdf"]').click();
      await workspace.locator('#preview-details summary').click();
      const pdfPromise=workspace.waitForEvent('download',{timeout:30000});
      await workspace.locator('#export-button').click();
      await(await pdfPromise).saveAs(resolve('output/qa-rebuilt-export.pdf'));
      await workspace.locator('#status').filter({hasText:'Saved'}).waitFor();
      const pdf=await readFile(resolve('output/qa-rebuilt-export.pdf'));
      assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
      const doc=await getDocument({data:new Uint8Array(pdf),disableWorker:true,standardFontDataUrl:fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/",import.meta.url))}).promise;
      let pdfText='';
      for(let n=1;n<=doc.numPages;n++) pdfText+=(await(await doc.getPage(n)).getTextContent()).items.map(item=>item.str).join(' ')+' ';
      assert.deepEqual(Array.from(pdfText.matchAll(/\bMessage\s+(\d+)\b/g),match=>Number(match[1])),Array.from({length:12},(_,i)=>i));
      await doc.destroy();
      await workspace.waitForFunction(()=>document.querySelector('#preview-document').width>300);
      await workspace.locator('#preview-loading').waitFor({state:'hidden',timeout:30000});
      await workspace.screenshot({path:resolve('output/qa-pdf-workspace.png'),fullPage:true});
      assert.deepEqual(await workspace.locator('#preview-document').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(4,4,1,1).data).slice(0,3)),[13,13,13]);
      await workspace.locator('[data-theme="light"]').click();
      await workspace.locator('#preview-loading').waitFor({state:'hidden',timeout:30000});
      assert.deepEqual(await workspace.locator('#preview-document').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(4,4,1,1).data).slice(0,3)),[255,255,255]);
      await workspace.screenshot({path:resolve('output/qa-pdf-light.png'),fullPage:true});
      await workspace.setViewportSize({width:360,height:800});
      assert.equal(await workspace.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await workspace.screenshot({path:resolve('output/qa-workspace-mobile.png'),fullPage:true});
      checks.push('PDF: real worker render, all 12 message anchors, confirmed download, correct light/dark preview pixels; 380px popup and 360px workspace fit');
    }
    await workspace.close();
  }
  const hydrationSource=await context.newPage();
  await hydrationSource.goto('https://chatgpt.com/c/hydration-fixture?variant=search-key&wrapper=div&hydrate=1500&count=4');
  assert.equal(await hydrationSource.locator('[data-chatgpt-search-unit-key]').count(),0,'fixture must begin with unmounted messages');
  const hydrationTabId=await worker.evaluate(async sourceUrl=>(await chrome.tabs.query({})).find(tab=>tab.url===sourceUrl).id,hydrationSource.url());
  const hydrationWorkspace=await context.newPage();
  const hydrationDownload=hydrationWorkspace.waitForEvent('download',{timeout:30000});
  await hydrationWorkspace.goto(`chrome-extension://${extensionId}/popup/index.html?mode=editor&sourceTabId=${hydrationTabId}&exportFormat=markdown&autostart=1`);
  await(await hydrationDownload).saveAs(resolve('output/qa-chatgpt-hydration.md'));
  await hydrationWorkspace.locator('#status').filter({hasText:'Saved'}).waitFor();
  const hydratedMarkdown=await readFile(resolve('output/qa-chatgpt-hydration.md'),'utf8');
  for(let i=0;i<4;i++)assert.ok(hydratedMarkdown.includes(`${i%2?'Answer':'Prompt'} ${i}`));
  assert.equal((hydratedMarkdown.match(/^## (You|ChatGPT)$/gm)||[]).length,4);
  assert.ok(!hydratedMarkdown.includes('Copy response'));
  assert.ok((await hydrationWorkspace.locator('#conversation-meta').innerText()).includes('4 messages captured'));
  await hydrationWorkspace.close();
  await hydrationSource.close();
  checks.push('New ChatGPT keyed div layout: initially empty DOM automatically becomes ready, preserves prompt buttons and exports all 4 messages without manual Rescan');
  const closingSource=await context.newPage();
  await closingSource.goto('https://chatgpt.com/c/close-fixture?count=80');
  await closingSource.waitForLoadState('networkidle');
  const closingTabId=await worker.evaluate(async sourceUrl=>(await chrome.tabs.query({})).find(tab=>tab.url===sourceUrl).id,closingSource.url());
  const originalTop=await closingSource.locator('#chat').evaluate(element=>element.scrollTop);
  const closingWorkspace=await context.newPage();
  await closingWorkspace.goto(`chrome-extension://${extensionId}/popup/index.html?mode=editor&sourceTabId=${closingTabId}&exportFormat=markdown&autostart=1`);
  await closingWorkspace.locator('#status').filter({hasText:'Scanning messages'}).waitFor({timeout:15000});
  await closingWorkspace.close();
  const deadline=Date.now()+10000;
  let locked=true;
  while(locked && Date.now()<deadline) {
    locked=await worker.evaluate(async tabId=>{
      const [injection]=await chrome.scripting.executeScript({target:{tabId},func:()=>Boolean(window.__aiChatCapture)});
      return injection.result;
    },closingTabId);
    if(locked) await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(locked,false,'closing capture owner must release source lock');
  assert.equal(await closingSource.locator('#chat').evaluate(element=>element.scrollTop),originalTop,'closed owner restores source scroll');
  await closingSource.close();
  checks.push('Closing an active export workspace cancels source scan and restores scroll instead of leaving an orphaned lock');
  console.log(JSON.stringify({passed:checks.length,checks,limitation:'Synthetic pages; temporary test-only host grants. No live provider or activeTab user gesture qualification.'},null,2));
}finally{
  await context.close();
  await rm(temp,{recursive:true,force:true});
}
