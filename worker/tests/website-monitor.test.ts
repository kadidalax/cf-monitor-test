import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWebsiteAlertMessage,
  buildWebsiteRecoveryMessage,
  checkWebsiteMonitorHttp,
  checkWebsiteMonitorTcp,
  isWebsiteCheckDue,
  normalizeWebsiteFetchResult,
  shouldNotifyWebsiteDown,
  shouldNotifyWebsiteRecovery,
  validateWebsiteMonitorInput,
} from '../src/utils/website-monitor.ts';

test('website monitor validation accepts safe https URL', () => {
  const result = validateWebsiteMonitorInput({
    name: 'Example API',
    url: 'https://example.com/health',
    method: 'GET',
    expected_status_min: 200,
    expected_status_max: 399,
    interval_sec: 300,
    timeout_sec: 10,
    grace_period_sec: 180,
    enabled: true,
    hidden: false,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.url, 'https://example.com/health');
    assert.equal(result.value.method, 'GET');
    assert.equal(result.value.hidden, false);
  }
});

test('website monitor validation rejects unsafe URLs', () => {
  const base = {
    name: 'Bad',
    method: 'GET',
    expected_status_min: 200,
    expected_status_max: 399,
    interval_sec: 300,
    timeout_sec: 10,
    grace_period_sec: 180,
    enabled: true,
    hidden: false,
  };

  for (const url of [
    'http://localhost',
    'http://api.localhost/status',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://192.168.1.20',
    'http://169.254.169.254/latest/meta-data',
    'http://[::ffff:127.0.0.1]',
    'http://metadata.google.internal',
    'ftp://example.com',
    'https://user:pass@example.com',
    'https://example.com/#secret',
  ]) {
    const result = validateWebsiteMonitorInput({ ...base, url });
    assert.equal(result.ok, false, url);
  }
});

test('website monitor validation rejects invalid numeric boundaries', () => {
  const base = {
    name: 'Example',
    url: 'https://example.com',
    method: 'GET',
    expected_status_min: 200,
    expected_status_max: 399,
    enabled: true,
    hidden: false,
  };

  assert.equal(validateWebsiteMonitorInput({ ...base, interval_sec: 59, timeout_sec: 10, grace_period_sec: 180 }).ok, false);
  assert.equal(validateWebsiteMonitorInput({ ...base, interval_sec: 300, timeout_sec: 31, grace_period_sec: 180 }).ok, false);
  assert.equal(validateWebsiteMonitorInput({ ...base, interval_sec: 10, timeout_sec: 20, grace_period_sec: 180 }).ok, false);
  assert.equal(validateWebsiteMonitorInput({ ...base, interval_sec: 300, timeout_sec: 10, grace_period_sec: 29 }).ok, false);
  assert.equal(validateWebsiteMonitorInput({ ...base, interval_sec: 300, timeout_sec: 10, grace_period_sec: 180, expected_status_min: 500, expected_status_max: 200 }).ok, false);
});

test('website monitor validation defaults to 200-399 status range and 120 second interval', () => {
  const result = validateWebsiteMonitorInput({
    name: 'Example',
    url: 'https://example.com',
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.expected_status_min, 200);
    assert.equal(result.value.expected_status_max, 399);
    assert.equal(result.value.interval_sec, 120);
  }
});

test('fetch result normalization stores short public-safe errors', () => {
  assert.deepEqual(normalizeWebsiteFetchResult({ status: 204, latencyMs: 42, min: 200, max: 399 }), {
    ok: true,
    effective_status: 'up',
    effective_reason: 'status_in_expected_range',
    status_code: 204,
    raw_status_code: 204,
    latency_ms: 42,
    error: null,
  });

  assert.deepEqual(normalizeWebsiteFetchResult({ status: 500, latencyMs: 80, min: 200, max: 399 }), {
    ok: false,
    effective_status: 'down',
    effective_reason: 'http_status_mismatch',
    status_code: 500,
    raw_status_code: 500,
    latency_ms: 80,
    error: 'http_500',
  });

  assert.deepEqual(normalizeWebsiteFetchResult({ error: new Error('getaddrinfo ENOTFOUND example.internal'), latencyMs: 1, min: 200, max: 399 }), {
    ok: false,
    effective_status: 'down',
    effective_reason: 'dns_error',
    status_code: null,
    raw_status_code: null,
    latency_ms: 1,
    error: 'dns_error',
  });
});

test('default website availability treats worker challenge statuses as reachable', () => {
  assert.deepEqual(normalizeWebsiteFetchResult({ status: 412, latencyMs: 60, min: 200, max: 399 }), {
    ok: true,
    effective_status: 'up',
    effective_reason: 'reachable_challenge',
    status_code: 412,
    raw_status_code: 412,
    latency_ms: 60,
    error: null,
  });

  assert.deepEqual(normalizeWebsiteFetchResult({ status: 404, latencyMs: 60, min: 200, max: 399 }), {
    ok: false,
    effective_status: 'down',
    effective_reason: 'http_status_mismatch',
    status_code: 404,
    raw_status_code: 404,
    latency_ms: 60,
    error: 'http_404',
  });
});

test('down notification waits for grace period and hidden monitors still qualify', () => {
  const now = new Date('2026-06-18T10:05:00.000Z');
  const monitor = {
    id: 1,
    name: 'Example',
    url: 'https://example.com',
    status: 'down',
    hidden: true,
    grace_period_sec: 180,
    down_since: '2026-06-18T10:00:00.000Z',
    last_notified_at: null,
    last_checked_at: '2026-06-18T10:04:59.000Z',
    last_status_code: 500,
    last_latency_ms: 120,
    last_error: 'http_500',
  };

  assert.equal(shouldNotifyWebsiteDown(monitor, now), true);
  assert.equal(shouldNotifyWebsiteDown({ ...monitor, down_since: '2026-06-18T10:04:00.000Z' }, now), false);
  assert.equal(shouldNotifyWebsiteRecovery({ ...monitor, status: 'up', last_notified_at: '2026-06-18T10:04:00.000Z' }), true);
});

test('enabled controls due checks and hidden does not pause checks', () => {
  const now = new Date('2026-06-18T10:05:00.000Z');

  assert.equal(isWebsiteCheckDue({ enabled: true, hidden: true, interval_sec: 300, last_checked_at: null }, now), true);
  assert.equal(isWebsiteCheckDue({ enabled: false, hidden: false, interval_sec: 300, last_checked_at: null }, now), false);
  assert.equal(isWebsiteCheckDue({ enabled: true, hidden: false, interval_sec: 300, last_checked_at: '2026-06-18T10:01:00.000Z' }, now), false);
  assert.equal(isWebsiteCheckDue({ enabled: true, hidden: false, interval_sec: 300, last_checked_at: '2026-06-18T10:00:00.000Z' }, now), true);
  assert.equal(isWebsiteCheckDue({ enabled: true, hidden: false, interval_sec: 120, last_checked_at: '2026-06-18T10:03:15.000Z' }, now), true);
  assert.equal(isWebsiteCheckDue({ enabled: true, hidden: false, interval_sec: 120, last_checked_at: '2026-06-18T10:03:31.000Z' }, now), false);
});

test('website monitor validation accepts TCP endpoint monitors', () => {
  const result = validateWebsiteMonitorInput({
    name: 'SSH',
    url: 'tcp://example.com:22',
    method: 'TCP',
    interval_sec: 300,
    timeout_sec: 5,
    grace_period_sec: 180,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.url, 'tcp://example.com:22');
    assert.equal(result.value.method, 'TCP');
    assert.equal(result.value.expected_status_min, 200);
    assert.equal(result.value.expected_status_max, 399);
  }
});

test('website monitor HTTP check blocks redirects to unsafe hosts', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; redirect?: RequestRedirect }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), redirect: init?.redirect });
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/admin' },
    });
  }) as typeof fetch;

  try {
    const result = await checkWebsiteMonitorHttp({
      id: 1,
      url: 'https://example.com',
      method: 'GET',
      timeout_sec: 5,
      expected_status_min: 200,
      expected_status_max: 399,
    });

    assert.equal(result.ok, false);
    assert.equal(result.effective_reason, 'unsafe_redirect');
    assert.equal(result.error, 'unsafe_redirect');
    assert.deepEqual(calls, [{ url: 'https://example.com/', redirect: 'manual' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('website monitor TCP check records connect latency without HTTP status', async () => {
  let closed = false;
  const result = await checkWebsiteMonitorTcp({
    id: 2,
    url: 'tcp://example.com:22',
    method: 'TCP',
    timeout_sec: 5,
    expected_status_min: 200,
    expected_status_max: 399,
  }, () => ({
    opened: Promise.resolve({}),
    close: async () => { closed = true; },
  }));

  assert.equal(result.monitor_id, 2);
  assert.equal(result.ok, true);
  assert.equal(result.effective_status, 'up');
  assert.equal(result.effective_reason, 'tcp_connect');
  assert.equal(result.status_code, null);
  assert.equal(result.error, null);
  assert.equal(closed, true);
});

test('alert and recovery messages include website identity without stack traces', () => {
  const down = buildWebsiteAlertMessage({
    name: 'Example',
    url: 'https://example.com',
    downMinutes: 8,
    lastStatus: 'HTTP 500',
    checkedAt: '2026-06-18T10:00:00.000Z',
  });
  const recovery = buildWebsiteRecoveryMessage({
    name: 'Example',
    url: 'https://example.com',
    downMinutes: 8,
    statusCode: 200,
    latencyMs: 120,
  });

  assert.match(down, /CF VPS Monitor 网站告警/);
  assert.match(down, /Example/);
  assert.doesNotMatch(down, /Error:/);
  assert.match(recovery, /CF VPS Monitor 网站恢复/);
  assert.match(recovery, /120ms/);
});
