import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const notification = { subject: 'Synthetic', body: 'Synthetic delivery check' };
const success = {
  id: '1414559521615908901', channel_id: '1414559521615908900',
  content: notification.body, timestamp: '2026-09-13T12:00:00Z', type: 0,
  author: { id: '1414559521615908902', username: 'Synthetic webhook', discriminator: '0000', avatar: null, bot: true },
  attachments: [], embeds: [], mentions: [], mention_roles: [], mention_everyone: false,
  pinned: false, tts: false, edited_timestamp: null,
};

for (const suffix of ['', '&wait=false', '&wait=true', '&wait=false&wait=true']) {
  test(`N02 Discord requests a saved message receipt and preserves thread parameters (${suffix || 'default'})`, async () => {
    let sentUrl;
    const { load } = createWorkerLoader({ globals: {
      fetch: async (input) => { sentUrl = new URL(input); return Response.json(success); },
    } });
    const { sendWebhookMessage } = load('worker/src/utils/webhook.ts');
    const result = await sendWebhookMessage({
      url: `https://hooks.example.test/notify?thread_id=1414559521615908900${suffix}`,
      format: 'discord',
    }, notification);
    assert.equal(result.ok, true);
    assert.deepEqual(sentUrl.searchParams.getAll('wait'), ['true']);
    assert.equal(sentUrl.searchParams.get('thread_id'), '1414559521615908900');
  });
}

for (const [label, response, confirmed] of [
  ['saved message', () => Response.json(success), true],
  ['204 without confirmation', () => new Response(null, { status: 204 }), false],
  ['JSON without message identity', () => Response.json({ code: 0 }), false],
  ['message without channel identity', () => Response.json({ id: success.id }), false],
  ['HTML success page', () => new Response('<html>synthetic private response</html>'), false],
  ['oversized message receipt', () => Response.json({ ...success, extra: 'x'.repeat(20 * 1024) }), false],
  ['HTTP rejection', () => new Response('synthetic private response', { status: 400 }), false],
]) {
  test(`N02 Discord ${label} ${confirmed ? 'completes' : 'does not consume'} a delivery event`, async () => {
    const health = [];
    const completions = [];
    let marked = 0;
    const { load } = createWorkerLoader({ globals: { fetch: async () => response() } });
    const { dispatchNotification, deliverNotification } = load('worker/src/utils/notification-dispatch.ts');
    const delivered = await deliverNotification({
      claim: async () => ({ claimed: true, delivered: false, token: 'synthetic-claim' }),
      complete: async (_token, sent) => { completions.push(sent); return true; },
      onDelivered: async () => { marked++; return true; },
      send: () => dispatchNotification(undefined, {
        notification_method: 'webhook', webhook_format: 'discord', webhook_url: 'https://hooks.example.test/notify',
      }, notification, { deps: { recordHealth: async (...args) => { health.push(args); } } }),
    });
    assert.equal(delivered, confirmed);
    assert.deepEqual(completions, [confirmed]);
    assert.equal(marked, confirmed ? 1 : 0, 'unconfirmed delivery must leave notification state retryable');
    assert.equal(health.at(-1)[2], confirmed ? 'ok' : 'error');
    assert.doesNotMatch(JSON.stringify(health), /synthetic private response/);
  });
}
