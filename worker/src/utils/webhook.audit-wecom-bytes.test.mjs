import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebhookRequest, sendWebhookMessage } from './webhook.ts';

const config = { url: 'https://hooks.example.test/notify', format: 'wecom' };
const cases = [
  ['ASCII at limit', 'a'.repeat(2048), 'a'.repeat(2048)],
  ['ASCII over limit', 'a'.repeat(2049), 'a'.repeat(2048)],
  ['Chinese below limit', '中'.repeat(682), '中'.repeat(682)],
  ['Chinese over limit', '中'.repeat(683), '中'.repeat(682)],
  ['emoji at limit', '🚀'.repeat(512), '🚀'.repeat(512)],
  ['emoji over limit', '🚀'.repeat(513), '🚀'.repeat(512)],
  ['mixed complete boundary', 'a'.repeat(2041) + '中🚀!', 'a'.repeat(2041) + '中🚀'],
  ['mixed partial boundary', 'a'.repeat(2045) + '🚀', 'a'.repeat(2045)],
];

for (const [label, body, expected] of cases) {
  test(`N01 WeCom text honors UTF-8 byte limit: ${label}`, async () => {
    const request = await buildWebhookRequest(config, { subject: 'Synthetic', body });
    const payload = JSON.parse(request.body);
    assert.equal(payload.msgtype, 'text');
    assert.ok(Buffer.byteLength(payload.text.content, 'utf8') <= 2048,
      'WeCom text content must fit its 2048-byte limit');
    assert.equal(payload.text.content, expected);
    assert.equal(payload.text.content.isWellFormed(), true, 'do not split surrogate pairs');
  });
}

test('N01 sender applies the same WeCom limit to dispatched messages', async () => {
  let outgoing;
  const result = await sendWebhookMessage(config, { subject: 'Synthetic', body: '中'.repeat(800) }, {
    fetch: async (_url, init) => {
      outgoing = JSON.parse(init.body).text.content;
      return Response.json({ errcode: 0, errmsg: 'ok' });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(outgoing, '中'.repeat(682));
});
