import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyLiveDataResponse,
  normalizeLiveDataResponse,
  normalizeViewerTokenResponse,
} from '../src/utils/liveDataResponse.ts';

test('emptyLiveDataResponse returns a stable empty snapshot', () => {
  assert.deepEqual(emptyLiveDataResponse(123), {
    online: [],
    clients: [],
    data: {},
    count: 0,
    timestamp: 123,
  });
});

test('normalizeLiveDataResponse accepts valid snapshots and defaults optional collections', () => {
  assert.deepEqual(normalizeLiveDataResponse({
    online: ['node-1'],
    count: 1.9,
    timestamp: 456,
    clients: [
      { uuid: 'node-1', name: 'Node 1', lastReportTime: 455, cpu: 12 },
      { uuid: 'bad', name: 'Bad' },
      'not-an-object',
    ],
    data: { 'node-1': { cpu: 12 } },
  }), {
    online: ['node-1'],
    clients: [{ uuid: 'node-1', name: 'Node 1', lastReportTime: 455, cpu: 12 }],
    data: { 'node-1': { cpu: 12 } },
    count: 1,
    timestamp: 456,
  });

  const fallbackTimestamp = normalizeLiveDataResponse({
    online: [],
    count: 0,
  })?.timestamp;
  assert.equal(typeof fallbackTimestamp, 'number');
});

test('normalizeLiveDataResponse rejects malformed top-level snapshots', () => {
  assert.equal(normalizeLiveDataResponse(null), null);
  assert.equal(normalizeLiveDataResponse({ online: [1], count: 1 }), null);
  assert.equal(normalizeLiveDataResponse({ online: [], count: -1 }), null);
  assert.equal(normalizeLiveDataResponse({ online: [], count: null }), null);
  assert.equal(normalizeLiveDataResponse({ online: [], count: '0' }), null);
  assert.equal(normalizeLiveDataResponse({ online: [] }), null);
});

test('normalizeViewerTokenResponse accepts only non-empty token responses', () => {
  assert.deepEqual(normalizeViewerTokenResponse({ token: 'viewer-token', expires_at: 789 }), {
    token: 'viewer-token',
    expires_at: 789,
  });
  assert.deepEqual(normalizeViewerTokenResponse({ token: 'viewer-token', expires_at: 'soon' }), {
    token: 'viewer-token',
    expires_at: null,
  });
  assert.equal(normalizeViewerTokenResponse({ token: '' }), null);
  assert.equal(normalizeViewerTokenResponse({ expires_at: 789 }), null);
});
