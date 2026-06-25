import assert from 'node:assert/strict';
import test from 'node:test';

import { apiFetch, fetchWithBootstrapRetry, normalizeListResponse, publicFetch } from '../src/utils/api.ts';

type FetchCall = {
  input: string;
  init?: RequestInit;
};

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

function setCookie(cookie: string) {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie },
  });
}

function restoreDocument() {
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument);
  } else {
    delete (globalThis as { document?: unknown }).document;
  }
}

function mockFetch(body: unknown = { ok: true }) {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };
  return calls;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  restoreDocument();
});

test('apiFetch prefixes admin paths, sends cookies, and injects CSRF for unsafe methods', async () => {
  setCookie('theme=dark; cf_monitor_csrf=csrf-token; other=value');
  const calls = mockFetch({ data: [{ id: 1 }] });

  const result = await apiFetch('/admin/settings', {
    body: JSON.stringify({ enabled: true }),
    method: 'POST',
  });

  assert.deepEqual(result, { data: [{ id: 1 }] });
  assert.equal(calls[0].input, '/api/admin/settings');
  assert.equal(calls[0].init?.credentials, 'same-origin');
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.get('X-CSRF-Token'), 'csrf-token');
});

test('apiFetch does not add CSRF to safe methods or non-admin requests', async () => {
  setCookie('cf_monitor_csrf=csrf-token');
  const calls = mockFetch();

  await apiFetch('/admin/settings');
  await apiFetch('/public/site', { method: 'POST' });

  assert.equal(calls[0].input, '/api/admin/settings');
  assert.equal(new Headers(calls[0].init?.headers).has('X-CSRF-Token'), false);
  assert.equal(calls[1].input, '/api/public/site');
  assert.equal(new Headers(calls[1].init?.headers).has('X-CSRF-Token'), false);
});

test('apiFetch preserves explicit CSRF and avoids JSON content type for FormData', async () => {
  setCookie('cf_monitor_csrf=cookie-token');
  const calls = mockFetch();
  const body = new FormData();

  await apiFetch('/api/admin/upload', {
    body,
    headers: { 'X-CSRF-Token': 'explicit-token' },
    method: 'POST',
  });

  assert.equal(calls[0].input, '/api/admin/upload');
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('X-CSRF-Token'), 'explicit-token');
  assert.equal(headers.has('Content-Type'), false);
});

test('publicFetch prefixes non-api paths without admin credentials options', async () => {
  const calls = mockFetch({ public: true });

  const result = await publicFetch('stats');

  assert.deepEqual(result, { public: true });
  assert.equal(calls[0].input, '/api/stats');
  assert.equal(calls[0].init, undefined);
});

test('bootstrap retry stops quickly instead of holding the first page for 20+ seconds', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'Database is not ready' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 202,
    });
  };
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === 'function') callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  const response = await fetchWithBootstrapRetry('/api/public/bootstrap');

  assert.equal(response.status, 202);
  assert.equal(calls, 6);
});

test('normalizeListResponse accepts arrays and data envelopes only', () => {
  assert.deepEqual(normalizeListResponse([1, 2]), [1, 2]);
  assert.deepEqual(normalizeListResponse({ data: ['a'] }), ['a']);
  assert.deepEqual(normalizeListResponse({ data: 'nope' }), []);
  assert.deepEqual(normalizeListResponse(null), []);
});
