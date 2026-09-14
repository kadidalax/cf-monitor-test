import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { productionModule, productionDeclaration } from './helpers/production-module.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const WebsiteMonitorList = productionModule('src/components/WebsiteMonitorList.tsx').default;
const checkedAt = new Date().toISOString();
const monitor = { id: 1, name: 'Synthetic website', url: null, interval_sec: 120, status: 'pending',
  last_checked_at: null, last_status_code: null, last_latency_ms: null, checks: [] };
function websiteHtml(patch) {
  return renderToStaticMarkup(createElement(WebsiteMonitorList, {
    monitors: [{ ...monitor, ...patch }], periodHours: 1, onPeriodChange() {},
  }));
}

test('F06 an unprobed website shows unknown measurements instead of zero or now', () => {
  const html = websiteHtml({});
  assert.match(html, /暂无记录/);
  assert.match(html, /尚未检测/);
  assert.doesNotMatch(html, /0%|0ms|现在/);
});

test('F06 empty selected history differs from confirmed zero availability', () => {
  const html = websiteHtml({ status: 'up', last_checked_at: new Date(Date.now() - 4 * 3600000).toISOString(),
    last_latency_ms: 15, checks: [{ checked_at: new Date(Date.now() - 4 * 3600000).toISOString(), ok: true }] });
  assert.match(html, /暂无记录/);
  assert.match(html, /15ms/);
  assert.doesNotMatch(html, /尚未检测/);
});

test('F06 all failed checks report measured zero availability and unknown latency', () => {
  const html = websiteHtml({ status: 'down', last_checked_at: checkedAt,
    checks: [{ checked_at: checkedAt, ok: false, latency_ms: null }] });
  assert.match(html, /0%/);
  assert.doesNotMatch(html, /0ms|暂无记录/);
});

test('F06 all successful checks retain 100 percent availability', () => {
  const html = websiteHtml({ status: 'up', last_checked_at: checkedAt, last_latency_ms: 12,
    checks: [{ checked_at: checkedAt, ok: true, latency_ms: 12 }] });
  assert.match(html, /100%/);
  assert.match(html, /12ms/);
});

test('F06 a genuinely measured zero millisecond latency remains zero', () => {
  const html = websiteHtml({ status: 'up', last_checked_at: checkedAt, last_latency_ms: 0,
    checks: [{ checked_at: checkedAt, ok: true, latency_ms: 0 }] });
  assert.match(html, /0ms/);
  assert.match(html, /100%/);
});

test('F06 invalid check timestamps do not masquerade as a recent measurement', () => {
  const html = websiteHtml({ last_checked_at: 'invalid' });
  assert.match(html, /尚未检测/);
  assert.doesNotMatch(html, /NaN|现在/);
});

for (const body of ['<html>Unexpected page</html>', '', 'null', 'false']) {
  test(`F08 successful HTTP with unusable JSON rejects: ${JSON.stringify(body)}`, async () => {
    const readJson = productionDeclaration('src/contexts/AuthContext.tsx', 'readJson');
    await assert.rejects(readJson(new Response(body, { status: 200 })), /无法确认/);
  });
}

test('F08 a non-JSON authentication rejection still clears the rejected session', async () => {
  let clears = 0;
  const api = productionDeclaration('src/contexts/AuthContext.tsx', 'useApiResponse', {
    useAuth: () => ({ clearAuth: () => { clears += 1; } }), useCallback: value => value,
    runWithMfaStepUpRetry: request => request(), requestMfaStepUp() {},
    buildApiRequest: path => ({ url: path, init: {} }),
    fetch: async () => new Response('<html>Rejected</html>', { status: 401 }),
    readJson: productionDeclaration('src/contexts/AuthContext.tsx', 'readJson'),
    shouldClearAuthForStatus: status => status === 401,
  })();
  await assert.rejects(api('/admin/synthetic'), /HTTP 401/);
  assert.equal(clears, 1);
});

const traffic = productionModule('src/utils/traffic.ts');
for (const bytes of [1288490188800, 1099511627775, 1099511627777, 1, 1234567, 1073741824, 9007199254740991]) {
  test(`F10 an unchanged traffic form preserves exactly ${bytes} bytes`, () => {
    const form = traffic.createTrafficLimitFormValue(bytes, 'sum');
    assert.equal(traffic.serializeTrafficLimitFormValue(form).traffic_limit, bytes);
  });
}

for (const [unit, expected] of [['GB', 1610612736], ['TB', 1649267441664]]) {
  test(`F10 explicitly editing the quota to 1.5 ${unit} uses the requested amount`, () => {
    const form = traffic.createTrafficLimitFormValue(1288490188800, 'sum');
    assert.equal(traffic.serializeTrafficLimitFormValue({ ...form, value: '1.5', unit }).traffic_limit, expected);
  });
}

const pingChart = productionModule('src/utils/pingChart.ts');
test('F11 nearby records from one task cannot overwrite an actual timeout', () => {
  const task = pingChart.normalizePingTask({ id: 1, name: 'Synthetic ping', interval_sec: 60 }, 0);
  const start = Date.parse('2026-09-13T00:00:00Z');
  const records = [0, 1000, 120000].map((offset, index) => ({ time: new Date(start + offset).toISOString(), value: [20, -1, 40][index] }));
  const rows = pingChart.buildPingChartRows([{ task, records }]);
  assert.equal(rows.length, 3, 'all observed samples from a task must survive tooltip alignment');
  assert.deepEqual(Array.from(rows, row => row[task.key]), [20, null, 40]);
});

for (const hours of [1, 4, 24, 72]) {
  const end = Date.parse('2026-09-13T12:00:00Z');
  const start = end - hours * 3600000;
  const task = pingChart.normalizePingTask({ id: 1, name: 'Synthetic ping', all_clients: true, interval_sec: 120 }, 0);
  const records = [start - 1, start, end - 1000, end, end + 1].map((at, index) => ({ time: new Date(at).toISOString(), value: index + 10 }));
  test(`F13 ${hours}h filtering uses the fixed query end and retains both boundaries`, () => {
    const result = pingChart.limitPingSeriesToRecentRange([{ task, records }], hours, end);
    assert.deepEqual(Array.from(result[0].records, record => Date.parse(record.time)), [start, end - 1000, end]);
  });
  test(`F13 ${hours}h time domain stays at query end when the last sample is old`, () => {
    assert.deepEqual(Array.from(pingChart.getPingTimeDomain([{ task, records: [records[0]] }], hours, end)), [start, end]);
  });
  for (const transport of ['batch', 'fallback']) {
    test(`F13 ${hours}h ${transport} uses the same absolute range`, async () => {
      const cursors = [];
      const module = productionModule('src/utils/pingChart.ts', {}, {
        fetch: async input => {
          const url = new URL(input, 'https://synthetic.invalid');
          if (url.pathname === '/api/task/ping') return new Response(JSON.stringify([{ id: 1, name: 'Synthetic ping', all_clients: true, interval_sec: 120 }]));
          cursors.push(url.searchParams.get('cursor'));
          if (url.pathname.endsWith('/batch')) return transport === 'batch' ? new Response(JSON.stringify({ 1: records })) : new Response('{}', { status: 404 });
          return new Response(JSON.stringify({ data: records, has_more: false }));
        },
      });
      const series = await module.fetchPingTaskSeries('node-a', { rangeHours: hours, cursor: new Date(end).toISOString() });
      assert.deepEqual(Array.from(series[0].records, record => Date.parse(record.time)), [start, end - 1000, end]);
      assert.ok(cursors.every(cursor => cursor === new Date(end).toISOString()));
    });
  }
}
