import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModule } from './helpers/production-module.mjs';

const history = productionModule('src/utils/publicHistory.ts');
const ping = productionModule('src/utils/pingChart.ts');
const at = '2026-09-13T00:00:00.123456+00:00';
const end = '2026-09-14T00:00:00.000Z';
const key = (time, id, ordinal = 0) => `v1|${time}|${id}|${ordinal}`;
const normalizers = {
  load: history.normalizePublicMonitorRecords,
  gpu: history.normalizePublicGpuRecords,
  ping: ping.normalizePingRecords,
};

for (const kind of ['load', 'gpu', 'ping']) {
  test(`D02 ${kind} normalization preserves exact snapshot identity and device ordinality`, () => {
    const [record] = normalizers[kind]([{ time: at, id: '9007199254740993', device_index: 0, device_ordinal: 2, value: 10 }]);
    assert.equal(record.id, '9007199254740993');
    assert.equal(record.time, at);
    if (kind === 'gpu') {
      assert.equal(record.device_index, 0);
      assert.equal(record.device_ordinal, 2);
    }
    assert.equal(normalizers[kind]([{ time: at, id: 42, value: 10 }])[0].id, '42', 'legacy safe numeric IDs remain supported');
  });

  test(`D02 ${kind} traverses every same-time row at the selected start boundary`, async () => {
    const samples = [
      { time: at, id: '9007199254740993', value: 13, device_index: 0, device_ordinal: 2 },
      { time: at, id: '9007199254740993', value: 12, device_index: 0, device_ordinal: 1 },
      { time: at, id: '9007199254740992', value: 11, device_index: 0, device_ordinal: 2 },
      { time: at, id: '9007199254740992', value: 10, device_index: 0, device_ordinal: 1 },
    ].filter((_record, index) => kind === 'gpu' || index % 2 === 0);
    const requests = [];
    const result = await history.collectCursorHistory(async cursor => {
      const index = requests.length;
      requests.push(cursor);
      const record = samples[index];
      assert.ok(record, 'traversal stays bounded by the synthetic rows');
      return { data: [record], has_more: index < samples.length - 1, next_cursor: at,
        next_cursor_key: key(at, record.id, kind === 'gpu' ? record.device_ordinal : 0) };
    }, { cursor: end, start: at, end, normalize: normalizers[kind] });
    assert.equal(result.length, samples.length, 'timestamp alone cannot deduplicate devices or snapshots');
    assert.equal(requests.length, samples.length, 'the exact start timestamp may have more rows on later pages');
    assert.deepEqual(requests.slice(1), samples.slice(0, -1).map(record => key(at, record.id, kind === 'gpu' ? record.device_ordinal : 0)));
    assert.equal(new Set(result.map(record => `${record.id}:${kind === 'gpu' ? record.device_ordinal : 0}`)).size, samples.length);
  });
}

test('D02 composite cursors retain microseconds and timezone instead of passing a rounded ISO', async () => {
  const requests = [];
  const rows = [
    { time: '2026-09-13T08:00:00.123456+08:00', id: '1', value: 10 },
    { time: '2026-09-13T00:00:00.123455Z', id: '99', value: 20 },
    { time: '2026-09-13T00:00:00.123454Z', id: '100', value: 30 },
  ];
  const result = await history.collectCursorHistory(async cursor => {
    const index = requests.length;
    requests.push(cursor);
    const record = rows[index];
    return { data: [record], has_more: index < 2, next_cursor: record.time, next_cursor_key: key(record.time, record.id) };
  }, { cursor: end, start: '2026-09-13T00:00:00Z', normalize: ping.normalizePingRecords });
  assert.equal(result.length, 3);
  assert.deepEqual(requests.slice(1), rows.slice(0, 2).map(record => key(record.time, record.id)));
  assert.deepEqual(Array.from(result, record => record.value), [30, 20, 10], 'microsecond order wins over unrelated row IDs');
});

for (const change of ['repeated', 'forward-id', 'forward-ordinal', 'malformed']) {
  test(`D02 rejects ${change} composite continuation instead of looping or skipping`, async () => {
    const initial = key(at, '9007199254740993', 2);
    const next = change === 'repeated' ? initial : change === 'forward-id' ? key(at, '9007199254740994', 1)
      : change === 'forward-ordinal' ? key(at, '9007199254740993', 3) : 'v1|invalid|5|0';
    await assert.rejects(() => history.collectCursorHistory(async () => ({ data: [], has_more: true, next_cursor: '2026-09-12T00:00:00Z', next_cursor_key: next }),
      { cursor: initial, start: '2026-09-12T00:00:00Z', end, normalize: ping.normalizePingRecords }), /游标无效/);
  });
}

test('D02 deduplicates overlapping identities while preserving separate samples', async () => {
  const newer = { time: at, id: '42', value: 20 };
  const older = { time: at, id: '41', value: 10 };
  let requests = 0;
  const result = await history.collectCursorHistory(async () => ++requests === 1
    ? { data: [newer], has_more: true, next_cursor: at, next_cursor_key: key(at, '42') }
    : { data: [newer, older], has_more: false },
  { cursor: end, start: '2026-09-13T00:00:00Z', normalize: ping.normalizePingRecords });
  assert.deepEqual(Array.from(result, record => record.id), ['41', '42']);
});

test('D02 old ISO cursors remain supported without a composite key', async () => {
  const times = ['2026-09-13T12:00:00Z', '2026-09-13T00:00:00Z'];
  const requests = [];
  const result = await history.collectCursorHistory(async cursor => {
    const index = requests.length;
    requests.push(cursor);
    return { data: [{ time: times[index], value: index + 10 }], has_more: index === 0, next_cursor: times[index] };
  }, { cursor: end, start: times[1], normalize: ping.normalizePingRecords });
  assert.deepEqual(requests, [end, times[0]]);
  assert.deepEqual(Array.from(result, record => record.value), [11, 10]);
});

test('D02 a full Ping batch resumes by the oldest exact row identity and merges all same-time samples', async () => {
  const batch = Array.from({ length: 34 }, (_, index) => ({ time: at, id: String(9007199254741000n + BigInt(index)), task_id: 1, value: index + 10 }));
  const requests = [];
  const module = productionModule('src/utils/pingChart.ts', {}, {
    fetch: async input => {
      const url = new URL(input, 'https://synthetic.invalid');
      if (url.pathname === '/api/task/ping') return Response.json([{ id: 1, all_clients: true, interval_sec: 120 }]);
      if (url.pathname.endsWith('/batch')) return Response.json({ 1: batch });
      requests.push(url.searchParams.get('cursor'));
      return Response.json({ data: [{ time: at, id: '9007199254740999', value: 5 }], has_more: false });
    },
  });
  const series = await module.fetchPingTaskSeries('node-a', { rangeHours: 1, cursor: '2026-09-13T00:30:00.000Z' });
  assert.equal(series[0].records.length, 35, 'continuation must not fold distinct snapshots into one timestamp');
  assert.deepEqual(requests, [key(at, '9007199254741000')]);
});
