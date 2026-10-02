import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { captureConversation } from '../dist/adapters/capture.js';

// Every conversation below is local and synthetic. No ChatGPT/account navigation.
// Attribute evidence is pinned in fixtures/chatgpt-layouts.html; no external code copied.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const captureSha256 = createHash('sha256').update(await readFile(resolve('dist/adapters/capture.js'))).digest('hex');
const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE } : { channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome' }) });
const page = await browser.newPage({viewport:{width:1280,height:900}});
const fixtureUrl = pathToFileURL(resolve('tests/fixtures/chatgpt-layouts.html')).href;
const cases = [];
try {
  for (const [variant,mode,count,wrapper='article'] of [
    ['legacy','preview',4], ['role-button','preview',4], ['message-role','preview',4],
    ['search-key','preview',4], ['mixed','preview',4], ['message-role','complete',18],
    ['search-key','complete',18,'div']
  ]) {
    await page.goto(`${fixtureUrl}?variant=${variant}&mode=${mode==='complete'?'virtual':'static'}&count=${count}&wrapper=${wrapper}`);
    const original = await page.evaluate(()=>fixture.chat.scrollTop);
    const start = performance.now();
    const result = await page.evaluate(async ({source,mode}) => (0,eval)(`(${source})`)('chatgpt',{
      mode,jobId:'compatibility-test',pollMs:20,quietMs:100,settleMs:80,timeoutMs:5000
    }),{source:captureConversation.toString(),mode});
    const elapsedMs = Math.round(performance.now()-start);
    try {
      assert.equal(result.status,'captured',result.message);
      assert.equal(result.boundariesReached,mode==='complete');
      assert.equal(result.conversation.messages.length,count,'Exactly one message per turn');
      assert.equal(new Set(result.conversation.messages.map(message=>message.id)).size,count);
      result.conversation.messages.forEach((message,index)=>{
        assert.equal(message.role,index%2?'assistant':'user');
        assert.ok(JSON.stringify(message.blocks).includes(`${index%2?'Answer':'Prompt'} ${index}`),`Missing content anchor ${index}`);
        assert.ok(!JSON.stringify(message.blocks).includes('Copy response'));
        assert.ok(!JSON.stringify(message.blocks).includes('Thumbs up'));
        if(mode==='complete') assert.ok(message.id.includes(`turn-${index}`),'Stable provider turn identity must survive remounting');
      });
      assert.equal(await page.evaluate(()=>fixture.chat.scrollTop),original);
      assert.equal(await page.evaluate(()=>fixture.chat.style.scrollBehavior),'smooth');
      cases.push({variant,mode,wrapper,passed:true,elapsedMs,count});
    } catch(error) {
      cases.push({variant,mode,wrapper,passed:false,elapsedMs,status:result.status,count:result.conversation?.messages.length,error:error.message});
    }
  }
  console.log(JSON.stringify({captureSha256,passed:cases.filter(item=>item.passed).length,failed:cases.filter(item=>!item.passed).length,cases},null,2));
  if(cases.some(item=>!item.passed)) process.exitCode=1;
} finally {await browser.close()}
