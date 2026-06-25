import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExpiryNotification,
  buildIpChangeNotification,
  buildLoadNotification,
  buildOfflineNotification,
  buildWebsiteAlertNotification,
  buildWebsiteRecoveryNotification,
} from '../src/utils/notification-templates.ts';

test('notification templates expose specific email subjects and readable times', () => {
  assert.deepEqual(buildOfflineNotification({
    nodeName: 'test2',
    offlineMinutes: 8,
    lastSeen: '2026-06-18T10:00:00.000Z',
    eventTime: '2026-06-18T10:08:00.000Z',
  }), {
    subject: '🔴 CF VPS Monitor 离线告警',
    body: '🔴🔴🔴\n事件: 离线告警\n节点: test2\n消息: 离线 8 分钟；最后上报 2026-06-18 18:00:00\n时间: 2026-06-18 18:08:00',
  });

  assert.deepEqual(buildExpiryNotification({
    nodeName: 'test2',
    expiredAt: '2026-06-25T10:00:00.000Z',
    daysLeft: 3,
    eventTime: '2026-06-22T10:00:00.000Z',
  }), {
    subject: '⏳ CF VPS Monitor 到期提醒',
    body: '⏳⏳⏳\n事件: 到期提醒\n节点: test2\n消息: 剩余 3 天；到期时间 2026-06-25 18:00:00\n时间: 2026-06-22 18:00:00',
  });

  assert.deepEqual(buildLoadNotification({
    ruleName: '',
    nodeName: 'test2',
    metricLabel: 'CPU',
    avgValue: 91.234,
    threshold: 80,
    exceedRatio: 0.85,
    requiredRatio: 0.8,
    eventTime: '2026-06-18T10:00:00.000Z',
  }), {
    subject: '⚠️ CF VPS Monitor 负载告警',
    body: '⚠️⚠️⚠️\n事件: 负载告警\n节点: test2\n消息: CPU 告警；CPU 平均 91.2% (阈值 80%)；超标率 85% / 80%\n时间: 2026-06-18 18:00:00',
  });
});

test('website and ip templates share the notification shape', () => {
  assert.equal(buildWebsiteAlertNotification({
    name: 'API',
    url: 'https://example.com',
    downMinutes: 5,
    lastStatus: 'HTTP 500',
    checkedAt: '2026-06-18T10:00:00.000Z',
  }).body, '🌐🌐🌐\n事件: 网站告警\n节点: API\n消息: https://example.com；状态 HTTP 500；持续 5 分钟\n时间: 2026-06-18 18:00:00');

  assert.equal(buildWebsiteRecoveryNotification({
    name: 'API',
    url: 'https://example.com',
    downMinutes: 5,
    statusCode: 200,
    latencyMs: 120,
    eventTime: '2026-06-18T10:00:00.000Z',
  }).subject, '🟢 CF VPS Monitor 网站恢复');

  assert.deepEqual(buildIpChangeNotification({
    nodeName: 'test2',
    parts: ['IPv4: 1.1.1.1 → 2.2.2.2'],
    eventTime: '2026-06-18T10:00:00.000Z',
  }), {
    subject: '🔁 CF VPS Monitor IP 变更通知',
    body: '🔁🔁🔁\n事件: IP 变更通知\n节点: test2\n消息: IPv4: 1.1.1.1 → 2.2.2.2\n时间: 2026-06-18 18:00:00',
  });
});
