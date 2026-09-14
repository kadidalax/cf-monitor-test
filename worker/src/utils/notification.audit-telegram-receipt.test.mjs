import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const notification = { subject: 'Synthetic', body: 'Synthetic notification' };
const settings = { notification_method: 'telegram', telegram_bot_token: '123:synthetic-value', telegram_chat_id: '123456' };

async function deliver(fetcher, globals = {}) {
  const completions = [];
  const health = [];
  let marked = 0;
  const { load } = createWorkerLoader({ globals: { fetch: fetcher, ...globals } });
  const { dispatchNotification, deliverNotification } = load('worker/src/utils/notification-dispatch.ts');
  const delivered = await deliverNotification({
    claim: async () => ({ claimed: true, delivered: false, token: 'synthetic-claim' }),
    complete: async (_token, value) => { completions.push(value); return true; },
    onDelivered: async () => { marked++; return true; },
    send: () => dispatchNotification(undefined, settings, notification, {
      deps: { recordHealth: async (...args) => { health.push(args); } },
    }),
  });
  return { delivered, completions, marked, health };
}

for (const [label, makeResponse, expected] of [
  ['ok true', () => Response.json({ ok: true, result: { message_id: 1, date: 1789300800, chat: { id: 123456, type: 'private' }, text: notification.body } }), true],
  ['ok false', () => Response.json({ ok: false, error_code: 400, description: 'synthetic private response' }), false],
  ['missing ok', () => Response.json({ result: {} }), false],
  ['string ok', () => Response.json({ ok: 'true' }), false],
  ['JSON null', () => Response.json(null), false],
  ['JSON array', () => Response.json([{ ok: true }]), false],
  ['HTML', () => new Response('<html>synthetic private response</html>'), false],
  ['incomplete JSON', () => new Response('{"ok":true'), false],
  ['HTTP error', () => Response.json({ ok: false, error_code: 400, description: 'synthetic private response' }, { status: 400 }), false],
  ['oversized JSON', () => Response.json({ ok: true, result: 'x'.repeat(64 * 1024) }), false],
]) {
  test(`N06 Telegram ${label} ${expected ? 'completes' : 'does not consume'} a delivery`, async () => {
    const result = await deliver(async () => makeResponse());
    assert.equal(result.delivered, expected);
    assert.deepEqual(result.completions, [expected]);
    assert.equal(result.marked, expected ? 1 : 0);
    assert.equal(result.health.at(-1)[2], expected ? 'ok' : 'error');
    assert.doesNotMatch(JSON.stringify(result.health), /synthetic private response/);
  });
}

test('N06 Telegram unfinished response times out, cancels the body and remains retryable', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); },
    cancel() { cancelled = true; },
  });
  const started = performance.now();
  const result = await deliver(async () => new Response(stream), {
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 20)),
  });
  assert.equal(result.delivered, false, 'a partial body cannot prove delivery');
  assert.deepEqual(result.completions, [false]);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
  assert.ok(performance.now() - started < 1500, 'body parsing must not wait indefinitely');
});

test('N06 Telegram transport exceptions do not retain bot credential URLs in health detail', async () => {
  const result = await deliver(async () => { throw new Error('request failed for https://api.telegram.org/bot123:synthetic-value/sendMessage'); });
  assert.equal(result.delivered, false);
  assert.doesNotMatch(JSON.stringify(result.health), /synthetic-value|api\.telegram\.org/);
});
