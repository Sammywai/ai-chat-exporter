import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { captureConversation } from '../dist/adapters/capture.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
    : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
});
const page = await browser.newPage();
const fixture = `<style>html,body{margin:0;height:100%}article{height:100vh}p{margin:0}</style>
  <article data-message-author-role="assistant" data-message-id="short"><p>Complete answer</p></article>`;
const checks = [];

try {
  for (const scenario of ['unchanged', 'mutation', 'loading']) {
    await page.setContent(fixture);
    const started = performance.now();
    const outcome = await page.evaluate(async ({ source, scenario }) => {
      let changedAt = 0;
      let loadingFinishedAt = 0;
      let scheduled = false;
      window.chrome ??= {};
      window.chrome.runtime = { sendMessage(message) {
        if (scenario !== 'unchanged' && message.phase === 'Checking last message' && !scheduled) {
          scheduled = true;
          setTimeout(() => {
            if (scenario === 'mutation') {
              // This attribute does not alter text or geometry; the mutation
              // guard must still invalidate quiet time carried from the start.
              document.querySelector('article').setAttribute('data-late-mount', 'ready');
              changedAt = performance.now();
            } else {
              const loader = document.createElement('div');
              loader.className = 'loading-history';
              loader.style.cssText = 'position:absolute;top:0';
              loader.textContent = 'Loading history';
              document.body.append(loader);
              setTimeout(() => { loader.remove(); loadingFinishedAt = performance.now(); }, 80);
            }
          }, 20);
        }
        return Promise.resolve();
      }};
      const quietMs = scenario === 'unchanged' ? 2000 : 250;
      const result = await (0, eval)(`(${source})`)('chatgpt', {
        mode: 'complete', pollMs: 20, settleMs: 150, quietMs, timeoutMs: 5000
      });
      return { result, changedAt, loadingFinishedAt, completedAt: performance.now(), quietMs,
        lockCleared: window.__aiChatCapture === undefined };
    }, { source: captureConversation.toString(), scenario });
    const elapsedMs = Math.round(performance.now() - started);
    assert.equal(outcome.result.status, 'captured', outcome.result.message);
    assert.equal(outcome.result.boundariesReached, true);
    assert.deepEqual(outcome.result.conversation.messages.map(message => message.blocks[0].text), ['Complete answer']);
    assert.equal(outcome.lockCleared, true);
    if (scenario === 'unchanged') {
      assert.ok(elapsedMs < 3300, `Same viewport should reuse its 2 s quiet check, took ${elapsedMs} ms`);
    } else if (scenario === 'mutation') {
      assert.ok(outcome.changedAt > 0, 'Exercise a mutation during the reused boundary check');
      assert.ok(outcome.completedAt - outcome.changedAt >= outcome.quietMs,
        'Mutation receives a new full quiet interval');
    } else {
      assert.ok(outcome.loadingFinishedAt > 0, 'Exercise a visible loading marker');
      assert.ok(outcome.completedAt - outcome.loadingFinishedAt >= outcome.quietMs - 25,
        'Loading marker blocks completion and resets quiet time');
    }
    checks.push({ scenario, passed: true, elapsedMs });
  }
  for (const mode of ['margin', 'flex-gap', 'spacer', 'tail']) {
    await page.goto(`${pathToFileURL(resolve('tests/fixtures/paired-layout-chat.html'))}?mode=${mode}`);
    const result = await page.evaluate(async (source) => {
      const result = await (0, eval)(`(${source})`)('chatgpt', {
        mode: 'complete', pollMs: 20, quietMs: 100, settleMs: 80,
        timeoutMs: location.search.includes('tail') ? 2200 : 8000
      });
      return { result, scrollEvents: fixture.scrollEvents };
    }, captureConversation.toString());
    if (mode === 'tail') {
      assert.equal(result.result.status, 'failed', 'Uncovered declared canvas tail cannot claim completeness');
      assert.equal('conversation' in result.result, false);
    } else {
      assert.equal(result.result.status, 'captured', result.result.message);
      assert.equal(result.result.boundariesReached, true);
      assert.deepEqual(result.result.conversation.messages.map(message => message.blocks[0].text),
        ['Pair 0 user', 'Pair 0 assistant', 'Pair 1 user', 'Pair 1 assistant']);
      assert.ok(mode === 'spacer' ? result.scrollEvents > 4 : result.scrollEvents <= 4,
        'Declared wrapper spacing can skip traversal; unknown spacer geometry must traverse');
    }
    checks.push({ scenario: `paired-${mode}`, passed: true, scrollEvents: result.scrollEvents });
  }
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await browser.close();
}
