import assert from 'node:assert/strict';
import test from 'node:test';
import { sendWebhookMessage } from './webhook.ts';

for (const [label, sizes, closed] of [
  ['one chunk exactly 1024', [1024], false],
  ['several chunks exactly 1024', [200, 300, 524], false],
  ['chunk crosses 1024', [600, 600], false],
  ['EOF before 1024', [30], true],
]) {
  test(`N07 Webhook error body releases its reader: ${label}`, async t => {
    let cancelled = false;
    let controller;
    const stream = new ReadableStream({
      start(value) {
        controller = value;
        for (const size of sizes) controller.enqueue(new Uint8Array(size).fill(120));
        if (closed) controller.close();
      },
      cancel() { cancelled = true; },
    });
    t.after(() => { try { controller.close(); } catch {} });
    const result = await sendWebhookMessage({ format: 'generic', url: 'https://hooks.example.test/notify' },
      { subject: 'Synthetic', body: 'Synthetic' }, { fetch: async () => new Response(stream, { status: 503 }) });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'HTTP 503: ' + 'x'.repeat(closed ? 30 : 1024));
    if (!closed) assert.equal(cancelled, true, 'unconsumed error response must be cancelled');
    assert.equal(stream.locked, false, 'returning the send result must release the reader');
  });
}

test('N07 Webhook response read failure releases its reader without masking HTTP failure', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('synthetic read failure')); } });
  const result = await sendWebhookMessage({ format: 'generic', url: 'https://hooks.example.test/notify' },
    { subject: 'Synthetic', body: 'Synthetic' }, { fetch: async () => new Response(stream, { status: 500 }) });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'HTTP 500');
  assert.equal(stream.locked, false);
});
