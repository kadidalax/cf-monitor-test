import assert from 'node:assert/strict';
import test from 'node:test';

import { RateLimitDO } from '../src/do/rate-limit.ts';

class MemoryStorage {
  private values = new Map<string, unknown>();
  private alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list<T>({ prefix = '', limit }: { prefix?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!key.startsWith(prefix)) continue;
      result.set(key, value as T);
      if (limit && result.size >= limit) break;
    }
    return result;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(value: number): Promise<void> {
    this.alarm = value;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

function createRateLimitDO() {
  return new RateLimitDO({ storage: new MemoryStorage() } as unknown as DurableObjectState);
}

function mockDateNow(nowMs: number): () => void {
  const original = Date.now;
  Date.now = () => nowMs;
  return () => {
    Date.now = original;
  };
}

async function check(
  rateLimit: RateLimitDO,
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const response = await rateLimit.fetch(new Request('https://rate-limit.test/rate-limit', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));
  return { status: response.status, json: await response.json() };
}

test('RateLimitDO rejects invalid payloads', async () => {
  const rateLimit = createRateLimitDO();
  const response = await rateLimit.fetch(new Request('https://rate-limit.test/rate-limit', {
    body: JSON.stringify({ bucket: 'agent-report', ip: '', max: 1, windowMs: 60_000 }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));

  assert.equal(response.status, 400);
});

test('RateLimitDO rejects oversized payloads before storing buckets', async () => {
  const rateLimit = createRateLimitDO();
  const declaredTooLarge = await rateLimit.fetch(new Request('https://rate-limit.test/rate-limit', {
    body: JSON.stringify({ bucket: 'agent-report', ip: 'client-a', max: 1, windowMs: 60_000 }),
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(2 * 1024 + 1) },
    method: 'POST',
  }));
  assert.equal(declaredTooLarge.status, 413);

  const parsedTooLarge = await rateLimit.fetch(new Request('https://rate-limit.test/rate-limit', {
    body: JSON.stringify({ bucket: 'x'.repeat(3 * 1024), ip: 'client-a', max: 1, windowMs: 60_000 }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }));
  assert.equal(parsedTooLarge.status, 413);
});

test('RateLimitDO enforces limits per bucket and IP', async () => {
  const rateLimit = createRateLimitDO();

  const first = await check(rateLimit, { bucket: 'agent-report', ip: 'client-a', max: 2, windowMs: 60_000 });
  const second = await check(rateLimit, { bucket: 'agent-report', ip: 'client-a', max: 2, windowMs: 60_000 });
  const third = await check(rateLimit, { bucket: 'agent-report', ip: 'client-a', max: 2, windowMs: 60_000 });
  const otherIp = await check(rateLimit, { bucket: 'agent-report', ip: 'client-b', max: 2, windowMs: 60_000 });

  assert.equal(first.status, 200);
  assert.equal(first.json.allowed, true);
  assert.equal(first.json.remaining, 1);
  assert.equal(second.json.allowed, true);
  assert.equal(second.json.remaining, 0);
  assert.equal(third.json.allowed, false);
  assert.equal(third.json.remaining, 0);
  assert.equal(otherIp.json.allowed, true);
  assert.equal(otherIp.json.remaining, 1);
});

test('RateLimitDO resets counters after the configured window', async () => {
  const restoreDateNow = mockDateNow(1_000);
  try {
    const rateLimit = createRateLimitDO();
    const body = { bucket: 'public-history', ip: 'viewer-a', max: 1, windowMs: 1_000 };

    const first = await check(rateLimit, body);
    const second = await check(rateLimit, body);
    assert.equal(first.json.allowed, true);
    assert.equal(first.json.remaining, 0);
    assert.equal(second.json.allowed, false);

    Date.now = () => 2_001;
    const afterWindow = await check(rateLimit, body);
    assert.equal(afterWindow.json.allowed, true);
    assert.equal(afterWindow.json.remaining, 0);
    assert.ok(afterWindow.json.reset > second.json.reset);
  } finally {
    restoreDateNow();
  }
});
