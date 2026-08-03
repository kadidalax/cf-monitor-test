import assert from 'node:assert/strict';

// 最小 DOM 桩：只提供 crossTabEvents 用到的部分
class FakeEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
function makeWindow() {
  const listeners = new Map();
  return {
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
    removeEventListener: (t, f) => listeners.get(t)?.delete(f),
    dispatchEvent: (e) => { for (const f of listeners.get(e.type) ?? []) f(e); return true; },
    __fire: (t, e) => { for (const f of listeners.get(t) ?? []) f(e); },
  };
}
const storageWrites = [];
globalThis.window = makeWindow();
globalThis.CustomEvent = FakeEvent;
globalThis.localStorage = {
  setItem: (k, v) => storageWrites.push([k, v]),
  getItem: () => null,
  removeItem: () => {},
};

const bcPosts = [];
const bcInstances = [];
class FakeBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null; bcInstances.push(this); }
  postMessage(data) { bcPosts.push([this.name, data]); }
  close() { this.closed = true; }
}
globalThis.BroadcastChannel = FakeBroadcastChannel;

const { broadcastCrossTab, subscribeCrossTab } = await import('./crossTabEvents.ts');

const EV = 'cf-monitor:test-event';

// --- 回归锁：BroadcastChannel 可用时，发送不得同时写 localStorage ---
storageWrites.length = 0; bcPosts.length = 0;
broadcastCrossTab(EV, { hello: 1 });
assert.equal(bcPosts.length, 1, '应通过 BroadcastChannel 广播一次');
assert.equal(
  storageWrites.length, 0,
  'BroadcastChannel 可用时不得再写 localStorage——两条通道同时生效会导致同一通知被处理两遍',
);
assert.equal(bcPosts[0][0], EV);
assert.equal(bcPosts[0][1].type, EV);
assert.deepEqual(bcPosts[0][1].detail, { hello: 1 });
assert.ok(typeof bcPosts[0][1].id === 'string' && bcPosts[0][1].id.length > 0, '每条消息必须带唯一 id');

// --- 同一 id 只处理一次（跨标签页去重兜底）---
{
  let calls = 0;
  const stop = subscribeCrossTab(EV, () => { calls += 1; });
  const chan = bcInstances.at(-1);
  const envelope = { type: EV, id: 'fixed-id-1', at: Date.now(), detail: { a: 1 } };
  chan.onmessage({ data: envelope });
  assert.equal(calls, 1, '首次投递应触发回调');
  chan.onmessage({ data: envelope });
  assert.equal(calls, 1, '同一 id 重复投递不得再次触发');
  chan.onmessage({ data: { ...envelope, id: 'fixed-id-2' } });
  assert.equal(calls, 2, '不同 id 应触发');
  stop();
}

// --- BroadcastChannel 与 storage 携带同一 id 时只处理一次 ---
{
  let calls = 0;
  const stop = subscribeCrossTab(EV, () => { calls += 1; });
  const chan = bcInstances.at(-1);
  const envelope = { type: EV, id: 'dual-channel-id', at: Date.now(), detail: null };
  chan.onmessage({ data: envelope });
  window.__fire('storage', { key: EV, newValue: JSON.stringify(envelope) });
  assert.equal(calls, 1, '两条通道携带同一 id 时只应处理一次');
  stop();
}

// --- 同标签页 CustomEvent 正常投递 ---
{
  let received;
  const stop = subscribeCrossTab(EV, d => { received = d; });
  window.dispatchEvent(new FakeEvent(EV, { detail: { local: true } }));
  assert.deepEqual(received, { local: true }, '同标签页 CustomEvent 应正常送达');
  stop();
}

// --- 取消订阅后不再触发 ---
{
  let calls = 0;
  const stop = subscribeCrossTab(EV, () => { calls += 1; });
  stop();
  window.dispatchEvent(new FakeEvent(EV, { detail: {} }));
  assert.equal(calls, 0, '取消订阅后不得再触发');
}

// --- BroadcastChannel 不可用时回落到 localStorage ---
{
  const saved = globalThis.BroadcastChannel;
  delete globalThis.BroadcastChannel;
  storageWrites.length = 0;
  broadcastCrossTab(EV, { fallback: true });
  assert.equal(storageWrites.length, 1, '无 BroadcastChannel 时必须回落到 localStorage');
  assert.equal(JSON.parse(storageWrites[0][1]).detail.fallback, true);
  globalThis.BroadcastChannel = saved;
}

console.log('crossTabEvents.test.mjs: all assertions passed');
