import assert from 'node:assert/strict';

const {
  DEFAULT_LIVE_POLL_CONFIG,
  LIVE_WS_FAILURE_CIRCUIT_BREAK,
  LIVE_WS_RECONNECT_BACKOFF_MS,
  getLivePollDelay,
  getLiveWsReconnectDelay,
  isLiveWsCircuitOpen,
  normalizeLivePollConfig,
  shouldPollLiveData,
  shouldReconnectLiveWebSocket,
} = await import('./livePolling.ts');

// --- 回归锁：hidden 守卫曾经是死代码（参数留在类型里但从不解构） ---
assert.equal(
  shouldReconnectLiveWebSocket({ expired: false, hidden: true }),
  false,
  '标签页隐藏时不得重连——此断言防止 hidden 守卫再次被掏空',
);
assert.equal(shouldReconnectLiveWebSocket({ expired: false, hidden: false }), true);
assert.equal(shouldReconnectLiveWebSocket({ expired: true, hidden: false }), false);
assert.equal(shouldReconnectLiveWebSocket({ expired: true, hidden: true }), false);

// --- 隐藏且未连通时不轮询 ---
assert.equal(shouldPollLiveData({ hidden: true, wsOpen: false }), false, '隐藏且 WS 未连通时不轮询');
assert.equal(shouldPollLiveData({ hidden: true, wsOpen: true }), true, 'WS 连通时隐藏也保留轮询排期');
assert.equal(shouldPollLiveData({ hidden: false, wsOpen: false }), true);
assert.equal(shouldPollLiveData({ hidden: false, wsOpen: true }), true);

// --- 重连退避序列 ---
assert.deepEqual([...LIVE_WS_RECONNECT_BACKOFF_MS], [5_000, 10_000, 30_000, 60_000]);
assert.equal(getLiveWsReconnectDelay(0), 5_000);
assert.equal(getLiveWsReconnectDelay(1), 10_000);
assert.equal(getLiveWsReconnectDelay(2), 30_000);
assert.equal(getLiveWsReconnectDelay(3), 60_000);
assert.equal(getLiveWsReconnectDelay(4), 60_000, '越界后封顶在 60 秒');
assert.equal(getLiveWsReconnectDelay(999), 60_000);
assert.equal(getLiveWsReconnectDelay(-1), 5_000, '负数回落到首档');
assert.equal(getLiveWsReconnectDelay(Number.NaN), 5_000, 'NaN 回落到首档');
assert.ok(
  Math.max(...LIVE_WS_RECONNECT_BACKOFF_MS) <= 60_000,
  '退避不得超过 60 秒：可见状态下滞留在 HTTP 轮询比重连本身更贵',
);

// --- 熔断阈值 ---
assert.equal(LIVE_WS_FAILURE_CIRCUIT_BREAK, 10);
assert.equal(isLiveWsCircuitOpen(0), false);
assert.equal(isLiveWsCircuitOpen(9), false, '第 9 次失败不熔断');
assert.equal(isLiveWsCircuitOpen(10), true, '第 10 次失败熔断');
assert.equal(isLiveWsCircuitOpen(11), true);
assert.equal(isLiveWsCircuitOpen(Number.NaN), false);

// --- 轮询间隔 ---
const config = DEFAULT_LIVE_POLL_CONFIG;
assert.equal(
  getLivePollDelay({ hidden: true, activeSince: Date.now(), config }),
  config.idleIntervalMs,
  '隐藏时用 idle 间隔',
);
assert.equal(
  getLivePollDelay({ hidden: false, activeSince: null, config }),
  config.activeIntervalMs,
  '可见且无 activeSince 时用 active 间隔',
);
assert.equal(
  getLivePollDelay({ hidden: false, activeSince: 1_000, now: 1_000 + config.activeMaxDurationMs, config }),
  config.idleIntervalMs,
  '超过 activeMaxDuration 后回落到 idle',
);
assert.equal(
  getLivePollDelay({ hidden: false, activeSince: 1_000, now: 1_000 + config.activeMaxDurationMs - 1, config }),
  config.activeIntervalMs,
  '未超过 activeMaxDuration 时保持 active',
);

// --- 配置归一化与边界裁剪 ---
const defaults = normalizeLivePollConfig(undefined);
assert.deepEqual(defaults, {
  activeIntervalMs: 3_000,
  idleIntervalMs: 120_000,
  activeMaxDurationMs: 120_000,
});
assert.deepEqual(
  defaults,
  DEFAULT_LIVE_POLL_CONFIG,
  'DEFAULT_LIVE_POLL_CONFIG 必须等于空设置归一化的结果——两者曾在 activeMaxDurationMs 上不一致',
);
assert.equal(normalizeLivePollConfig({ live_poll_active_interval_sec: '1' }).activeIntervalMs, 3_000, '下限 3 秒');
assert.equal(normalizeLivePollConfig({ live_poll_active_interval_sec: '9999' }).activeIntervalMs, 300_000, '上限 300 秒');
assert.equal(normalizeLivePollConfig({ live_poll_idle_interval_sec: '1' }).idleIntervalMs, 60_000, '下限 60 秒');
assert.equal(normalizeLivePollConfig({ live_poll_idle_interval_sec: '99999' }).idleIntervalMs, 3_600_000, '上限 3600 秒');
assert.equal(normalizeLivePollConfig({ live_poll_active_max_duration_sec: 'abc' }).activeMaxDurationMs, 120_000, '非法值回落默认');

console.log('livePolling.test.mjs: all assertions passed');
