import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { captureConversation, cancelCapture } from '../dist/adapters/capture.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
    : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
});
const page = await browser.newPage();
const fixtureUrl = pathToFileURL(resolve('tests/fixtures/scroll-chat.html')).href;
const captureSha256 = createHash('sha256').update(await readFile(resolve('dist/adapters/capture.js'))).digest('hex');
const symptom = 'Chat scrolling stopped before reaching the end. No incomplete file was saved.';
const cases = [];
const scenarios = [
  { name: 'plain', mode: 'plain', count: 1 },
  { name: 'snap-minimal', mode: 'snap', count: 1 },
  { name: 'snap-history', mode: 'snap', count: 8 },
  // Negative range with one chronological history subtree, not reversed DOM turns.
  { name: 'reverse-minimal', mode: 'reverse', count: 1 },
  { name: 'reverse-history', mode: 'reverse', count: 8 },
  { name: 'snap-reverse-history', mode: 'snap-reverse', count: 8 },
  { name: 'nested-padding-reverse', mode: 'nested-padding-reverse', count: 4 },
  { name: 'unmarked-root-rejected', mode: 'unmarked-padding-reverse', count: 4, expected: 'failed', expectedTimeout: true },
  { name: 'declared-virtual-tail-rejected', mode: 'nested-tail-reverse', count: 4, expected: 'failed', expectedTimeout: true },
  { name: 'short-semantic-root', mode: 'short-semantic-reverse', count: 2 },
  { name: 'second-declared-canvas-rejected', mode: 'split-canvas-reverse', count: 4, expected: 'failed', expectedTimeout: true },
  { name: 'outer-wrapper-virtual-tail-rejected', mode: 'outer-wrapper-tail-reverse', count: 4, expected: 'failed', expectedTimeout: true },
  { name: 'internal-sibling-tail-rejected', mode: 'sibling-tail-reverse', count: 4, expected: 'failed', expectedTimeout: true },
  { name: 'changed-scoped-extent-settles', mode: 'delayed-extent-reverse', count: 2, quietMs: 300 },
  { name: 'shrinking-end', mode: 'collapse', count: 1 },
  { name: 'blocked-still-fails', mode: 'blocked', count: 1, expected: 'failed' },
  { name: 'cancel-restores-snap', mode: 'snap', count: 8, expected: 'cancelled' }
];
const requested = new Set(process.argv.slice(2));

function scrollState() {
  const chat = window.fixture.chat;
  const styles = ['scroll-behavior', 'scroll-snap-type', 'overflow-anchor'];
  return {
    top: chat.scrollTop,
    styles: styles.map(name => [name, chat.style.getPropertyValue(name), chat.style.getPropertyPriority(name)])
  };
}

try {
  for (const scenario of scenarios.filter(item => !requested.size || requested.has(item.name))) {
    await page.goto(`${fixtureUrl}?mode=${scenario.mode}&count=${scenario.count}`);
    const before = await page.evaluate(scrollState);
    const initialEnd = await page.evaluate(() => fixture.chat.scrollHeight - fixture.chat.clientHeight);
    const started = performance.now();
    const result = await page.evaluate(async ({ source, cancel, shouldCancel, quietMs }) => {
      const capture = (0, eval)(`(${source})`);
      if (shouldCancel) setTimeout(() => (0, eval)(`(${cancel})`)('scroll-cancel'), 100);
      return capture('chatgpt', {
        mode: 'complete', jobId: 'scroll-cancel', pollMs: 20,
        quietMs: shouldCancel ? 1000 : quietMs, settleMs: 80, timeoutMs: 4000
      });
    }, { source: captureConversation.toString(), cancel: cancelCapture.toString(), shouldCancel: scenario.expected === 'cancelled', quietMs: scenario.quietMs || 100 });
    const settledSinceReady = scenario.mode === 'delayed-extent-reverse'
      ? await page.evaluate(() => ({ scheduled:fixture.boundaryStartedAt>0, ready:fixture.extentReadyAt>0, elapsedMs:performance.now()-fixture.extentReadyAt })) : undefined;
    const after = await page.evaluate(scrollState);
    const finalEnd = await page.evaluate(() => fixture.chat.scrollHeight - fixture.chat.clientHeight);
    const geometry = scenario.mode === 'nested-padding-reverse' ? await page.evaluate(() => {
      const chat=fixture.chat;
      const origin=chat.getBoundingClientRect().top+chat.clientTop;
      const logical=chat.scrollTop+chat.scrollHeight-chat.clientHeight;
      const last=document.querySelectorAll('[data-message-author-role]').item(3);
      return {
        roleBottomGap: chat.scrollHeight-(last.getBoundingClientRect().bottom-origin+logical),
        wrapperBottomGap: chat.scrollHeight-(last.closest('article').getBoundingClientRect().bottom-origin+logical)
      };
    }) : undefined;
    try {
      assert.equal(result.status, scenario.expected || 'captured', result.message);
      if (result.status === 'captured') {
        assert.equal(result.boundariesReached, true);
        assert.deepEqual(result.conversation.messages.map(message => message.blocks[0].text),
          Array.from({ length: scenario.count }, (_, index) => `Scroll message ${index}`));
        assert.equal(new Set(result.conversation.messages.map(message => message.id)).size, scenario.count);
      } else {
        assert.equal('conversation' in result, false, 'No incomplete transcript returned');
        if (scenario.expectedTimeout) assert.match(result.message, /^Scan timed out before both ends settled\./);
        else if (scenario.expected === 'failed') assert.equal(result.message, symptom);
      }
      if (scenario.mode.includes('reverse')) assert.ok(before.top < 0, 'Exercise a real negative starting position');
      if (scenario.mode === 'collapse') assert.ok(finalEnd < initialEnd, 'Exercise actual viewport extent shrink');
      if (settledSinceReady) {
        assert.equal(settledSinceReady.scheduled,true,'Canvas change scheduled during final boundary check');
        assert.equal(settledSinceReady.ready,true,'Delayed canvas shrink happened before success');
        assert.ok(settledSinceReady.elapsedMs>=scenario.quietMs,'Newly valid scoped extent receives the full quiet interval');
      }
      assert.deepEqual(after, before, 'Raw scroll position and exact inline style values/priorities restored');
      assert.equal(await page.evaluate(() => window.__aiChatCapture === undefined), true, 'Scan lock cleaned up');
      cases.push({ name: scenario.name, passed: true, elapsedMs: Math.round(performance.now() - started) });
    } catch (error) {
      cases.push({ name: scenario.name, passed: false, elapsedMs: Math.round(performance.now() - started),
        status: result.status, message: result.message, exactReportedSymptom: result.message === symptom,
        restored: JSON.stringify(after) === JSON.stringify(before), initialEnd, finalEnd, geometry, settledSinceReady, error: error.message });
    }
  }
  console.log(JSON.stringify({ captureSha256, passed: cases.filter(item => item.passed).length,
    failed: cases.filter(item => !item.passed).length, cases }, null, 2));
  if (cases.some(item => !item.passed)) process.exitCode = 1;
} finally {
  await browser.close();
}
