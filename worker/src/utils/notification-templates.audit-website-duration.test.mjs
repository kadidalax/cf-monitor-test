import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebsiteRecoveryNotification } from './notification-templates.ts';

for (const [downMinutes, expected] of [[null, '故障时长未知'], [12, '故障时长 12 分钟']]) {
  test(`N08 website recovery reports downtime ${downMinutes === null ? 'as unknown when unavailable' : 'when known'}`, () => {
    const notification = buildWebsiteRecoveryNotification({
      name: 'Synthetic', url: 'https://site.example.test', downMinutes, statusCode: 200, latencyMs: 12,
    });
    assert.ok(notification.body.includes(expected), 'a recovered row with cleared down_since cannot claim a zero-minute outage');
  });
}
