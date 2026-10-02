import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { renderMarkdown } from '../dist/renderers/markdown.js';
import { captureConversation, cancelCapture } from '../dist/adapters/capture.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'})});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const fixture = pathToFileURL(resolve('tests/fixtures/virtual-chat.html')).href;
const checks = [];
const timings = [];
try {
  for (const [provider, mode, ids, count] of [
    ['chatgpt','virtual',true,80], ['gemini','virtual',true,80],
    ['chatgpt','virtual',false,80], ['gemini','delayed',true,80],
    ['chatgpt','slow',true,40], ['chatgpt','very-slow',true,14], ['chatgpt','very-slow',true,7], ['gemini','delayed-slow',true,40], ['gemini','repeat',true,60],
    ['chatgpt','repeat',false,60], ['chatgpt','update',true,20], ['chatgpt','sparse',true,14], ['chatgpt','start-blank',true,20], ['chatgpt','prepend',true,20],
    ['gemini','static',false,30], ['chatgpt','static-padded',false,30]
  ]) {
    await page.goto(`${fixture}?provider=${provider}&mode=${mode}&ids=${ids?1:0}&count=${count}`);
    await page.waitForLoadState('networkidle');
    const original = await page.evaluate(()=>fixture.chat.scrollTop);
    const scanStarted = performance.now();
    const result = await page.evaluate(async ({source,provider}) => {
      const capture = (0,eval)(`(${source})`);
      return capture(provider,{mode:'complete',pollMs:20,quietMs:250,settleMs:150,timeoutMs:20000});
    },{source:captureConversation.toString(),provider});
    const elapsedMs = Math.round(performance.now() - scanStarted);
    timings.push({provider, mode, ids, count, elapsedMs});
    assert.equal(result.status,'captured',`${provider}/${mode}/${ids}: ${result.message}`);
    assert.equal(result.boundariesReached,true);
    assert.equal(result.conversation.messages.length,count,`${provider}/${mode}/${ids}`);
    assert.equal(new Set(result.conversation.messages.map(m=>m.id)).size,count);
    if (mode !== 'repeat') {
      assert.deepEqual(result.conversation.messages.slice(0,count-1).map(m=>m.blocks[0].text), Array.from({length:count-1},(_,i)=>`Message ${i}`));
    }
    if (mode === 'update') assert.equal(result.conversation.messages.at(-1).blocks[0].text,'Final completed answer');
    assert.equal(await page.evaluate(()=>fixture.chat.scrollTop),original);
    assert.equal(await page.evaluate(()=>fixture.chat.style.scrollBehavior),'smooth');
    if (mode === 'static' || mode === 'static-padded') {
      assert.ok(await page.evaluate(()=>fixture.scrollEvents) <= 4, 'Full-DOM chats check boundaries without traversing every viewport');
      assert.ok(elapsedMs < 4000, '30-message full-DOM capture should finish within 4 s on synthetic local page');
    }
    checks.push(`${provider}: ${mode}, ids=${ids}, ${count} messages`);
  }
  // Preview must not scroll or claim a complete capture.
  await page.goto(`${fixture}?provider=gemini`);
  const before = await page.evaluate(()=>fixture.chat.scrollTop);
  const preview = await page.evaluate(async (source) => (0,eval)(`(${source})`)('gemini',{mode:'preview'}),captureConversation.toString());
  assert.equal(preview.boundariesReached,false);
  assert.ok(preview.conversation.messages.length < 80);
  assert.equal(await page.evaluate(()=>fixture.chat.scrollTop),before);
  checks.push('preview: no scrolling, no completeness claim');
  const earlyCancel = await page.evaluate(async ({source,cancel}) => {
    const original = fixture.chat.scrollTop;
    (0,eval)(`(${cancel})`)('early-job');
    const result = await (0,eval)(`(${source})`)('gemini',{mode:'complete',jobId:'early-job'});
    return {result, unmoved:fixture.chat.scrollTop===original, lock:window.__aiChatCapture, pending:window.__aiChatCancelledJobId};
  },{source:captureConversation.toString(),cancel:cancelCapture.toString()});
  assert.equal(earlyCancel.result.status,'cancelled');
  assert.equal(earlyCancel.result.conversation,undefined);
  assert.equal(earlyCancel.unmoved,true);
  assert.equal(earlyCancel.lock,undefined);
  assert.equal(earlyCancel.pending,undefined);
  checks.push('cancel before capture starts: no scrolling, no partial conversation, pending marker consumed');
  // Timeout, cancel, navigation and concurrent work must stop with no partial result.
  for (const action of ['timeout','cancel','navigate','busy','stuck','gap','duplicate','end-empty']) {
    await page.goto(`${fixture}?provider=chatgpt&mode=${action==='gap'?'gap':action==='duplicate'?'duplicate':action==='end-empty'?'end-empty':'virtual'}${action==='end-empty'?'&count=14':''}`);
    const result = await page.evaluate(async ({source,cancel,action}) => {
      const capture=(0,eval)(`(${source})`);
      const original=fixture.chat.scrollTop;
      if(action==='stuck') Object.defineProperty(fixture.chat,'scrollTop',{get:()=>original,set:()=>{}});
      const first=capture('chatgpt',{mode:'complete',jobId:'test-job',pollMs:20,quietMs:100,settleMs:150,timeoutMs:action==='timeout'?30:action==='end-empty'?4000:10000});
      if(action==='cancel') setTimeout(()=>(0,eval)(`(${cancel})`)('test-job'),40);
      if(action==='navigate') setTimeout(()=>window.history.replaceState(null,'',`${location.href}#changed`),40);
      if(action==='busy') {const second=await capture('chatgpt',{mode:'complete',jobId:'other'});(0,eval)(`(${cancel})`)('test-job');await first;return second;}
      return first;
    },{source:captureConversation.toString(),cancel:cancelCapture.toString(),action});
    assert.equal(result.status,action==='cancel'?'cancelled':action==='busy'?'busy':'failed',action);
    assert.equal(result.conversation,undefined,action);
    assert.equal(await page.evaluate(()=>window.__aiChatCapture),undefined);
    if (action === 'end-empty') assert.equal(await page.evaluate(()=>fixture.emptyEndSeen),true);
    checks.push(`${action}: explicit failure, no partial conversation, lock cleared`);
  }
  await page.setContent(`<article data-message-author-role="assistant" data-message-id="rich"><div class="markdown"><h2>結果</h2><p>Read <strong>bold</strong> and <em>italics</em>, <a href="https://example.com/path">source</a>.</p><ul><li><p>One item</p></li></ul><pre><code class="language-js">  const x = 1;\n</code><button>Copy</button></pre><table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td></td><td>3</td></tr></table><div class="katex-display"><span class="katex"><math><annotation encoding="application/x-tex">x^2</annotation></math></span></div><button>Regenerate</button></div></article>`);
  const rich=await page.evaluate(async source=>(0,eval)(`(${source})`)('chatgpt',{mode:'preview'}),captureConversation.toString());
  const blocks=rich.conversation.messages[0].blocks;
  assert.equal(blocks.filter(b=>b.text==='- One item').length,1);
  assert.deepEqual(blocks.find(b=>b.type==='table').rows,[['1','','3']]);
  assert.equal(blocks.find(b=>b.type==='code').code,'  const x = 1;');
  assert.deepEqual(blocks.find(b=>b.type==='math'),{type:'math',tex:'x^2',display:true});
  assert.ok(!JSON.stringify(blocks).includes('Regenerate'));
  const md = renderMarkdown(rich.conversation);
  assert.ok(md.includes('[source](https://example.com/path)'));
  assert.ok(md.includes('**bold**'));
  assert.ok(md.includes('- One item'));
  checks.push('rich content: CJK, links, emphasis, list, code indentation, empty table cells, math, no toolbar text');
  await mkdir('output',{recursive:true});
  await page.screenshot({path:'output/qa-capture-fixture.png',fullPage:true});
  console.log(JSON.stringify({passed:checks.length,checks,timings},null,2));
} finally {await browser.close();}
