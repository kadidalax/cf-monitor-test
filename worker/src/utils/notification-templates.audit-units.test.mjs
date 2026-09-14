import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoadNotification } from './notification-templates.ts';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const cases = [
  ['cpu', 'CPU', 85.4, 80, 'CPU 平均 85.4% (阈值 80%)'],
  ['ram', '内存', 85.4, 80, '内存 平均 85.4% (阈值 80%)'],
  ['disk', '磁盘', 85.4, 80, '磁盘 平均 85.4% (阈值 80%)'],
  ['temp', '温度', 85.4, 80, '温度 平均 85.4°C (阈值 80°C)'],
  ['load', '负载', 1.5, 1, '负载 平均 1.5 (阈值 1)'],
];

for (const [metric, metricLabel, avgValue, threshold, expected] of cases) {
  test(`N05 ${metric} alert uses the metric unit while sample exceedance remains a percentage`, () => {
    const result = buildLoadNotification({
      ruleName: 'Synthetic', nodeName: 'Synthetic node', metric, metricLabel,
      avgValue, threshold, exceedRatio: 0.9, requiredRatio: 0.8,
    });
    assert.ok(result.body.includes(expected), `${metric} must display its correct unit`);
    assert.ok(result.body.includes('超标率 90% / 80%'));
  });
}

test('N05 the real scheduled load pipeline passes metric identity into outgoing notification text', async () => {
  const bodies = [];
  const rules = cases.map(([metric, , , threshold], index) => ({
    id: index + 1, name: `Synthetic ${metric}`, clients: ['synthetic-node'], metric,
    threshold, ratio: 0.8, interval_min: 15, last_notified: null,
  }));
  const { load } = createWorkerLoader({
    expose: { 'worker/src/index.ts': ['runLoadCheck'] },
    db: {
      listLoadNotifications: async () => rules,
      getLoadMetricWindowStatsForClients: async (_db, _clients, _start, _end, metric) => new Map([
        ['synthetic-node', { samples: 10, exceeded: 9, avg_value: metric === 'load' ? 1.5 : 85.4 }],
      ]),
      claimNotificationDelivery: async () => ({ claimed: true, delivered: false, token: 'synthetic-claim' }),
      completeNotificationDelivery: async () => true,
      markLoadNotificationSent: async () => true,
      insertAuditLog: async () => {},
      getSetting: async () => null,
      setSetting: async () => {},
    },
    globals: { fetch: async (input, init) => {
      assert.equal(new URL(input).hostname, 'hooks.example.test');
      bodies.push(JSON.parse(init.body).message);
      return new Response(null, { status: 204 });
    } },
  });
  await load('worker/src/index.ts').runLoadCheck({
    database: {}, env: {},
    getClients: async () => [{ uuid: 'synthetic-node', name: 'Synthetic node' }],
    getAdminSettings: async () => ({ notification_method: 'webhook', webhook_format: 'generic', webhook_url: 'https://hooks.example.test/notify' }),
  }, new Date('2026-09-13T12:00:00Z'));
  assert.equal(bodies.length, 5);
  for (const [metric, , , , expected] of cases) {
    const body = bodies.find(value => value.includes(`Synthetic ${metric}`));
    assert.ok(body?.includes(expected), `${metric} must reach the sender with its correct unit`);
    assert.ok(body.includes('超标率 90% / 80%'));
  }
});
