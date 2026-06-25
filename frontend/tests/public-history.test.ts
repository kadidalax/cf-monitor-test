import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  normalizePublicGpuRecords,
  normalizePublicMonitorRecords,
} from '../src/utils/publicHistory.ts';

test('normalizePublicMonitorRecords keeps valid monitor rows and drops malformed rows', () => {
  assert.deepEqual(normalizePublicMonitorRecords({
    data: [
      { time: '2026-06-17T00:00:00.000Z', cpu: 12, ram: 2, ram_total: 4, net_in: 1024 },
      { time: 'not-a-date', cpu: 99 },
      { time: '2026-06-17T00:01:00.000Z', cpu: '99' },
      null,
    ],
  }), [{
    time: '2026-06-17T00:00:00.000Z',
    cpu: 12,
    ram: 2,
    ram_total: 4,
    swap: 0,
    swap_total: 0,
    disk: 0,
    disk_total: 0,
    load: 0,
    temp: 0,
    net_in: 1024,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process_count: 0,
    connections: 0,
    connections_udp: 0,
    uptime: 0,
  }]);
});

test('normalizePublicGpuRecords keeps valid GPU rows and drops malformed rows', () => {
  assert.deepEqual(normalizePublicGpuRecords([
    { time: '2026-06-17T00:00:00.000Z', utilization: 45, mem_total: 100, mem_used: 50, temperature: 61 },
    { time: '2026-06-17T00:01:00.000Z', utilization: '45', mem_total: 100 },
    { time: 'bad', utilization: 10 },
  ]), [{
    time: '2026-06-17T00:00:00.000Z',
    utilization: 45,
    mem_total: 100,
    mem_used: 50,
    temperature: 61,
  }]);
});

test('instance page normalizes public history responses before chart state', () => {
  const instanceSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Instance.tsx'), 'utf8');

  assert.match(instanceSource, /setRecords\(normalizePublicMonitorRecords\(data\)\)/);
  assert.match(instanceSource, /setGpuRecords\(normalizePublicGpuRecords\(data\)\)/);
  assert.doesNotMatch(instanceSource, /normalizeListResponse<RecordData>/);
  assert.doesNotMatch(instanceSource, /normalizeListResponse<any>/);
  assert.doesNotMatch(instanceSource, /useState<any\[\]>/);
});

test('instance charts render selected history without live refresh animation', () => {
  const instanceSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'Instance.tsx'), 'utf8');
  const chartMarks = instanceSource.match(/<(?:Line|Area)\b[^>]*\/>/gs) || [];

  assert.doesNotMatch(instanceSource, /setRecords\(prev =>/);
  assert.doesNotMatch(instanceSource, /autoRefresh/);
  assert.match(instanceSource, /getMonitorChartRenderData\(chartData,\s*timeRangeMs\[timeRange\],\s*recordsRangeEnd\)/);
  assert.match(instanceSource, /rangeHours:\s*timeRangeHours\[timeRange\]/);
  assert.match(instanceSource, /getPingTimeDomain\(pingSeriesWithData,\s*timeRangeHours\[timeRange\]\)/);
  assert.ok(chartMarks.length >= 9, 'Expected monitor and ping chart series');
  for (const mark of chartMarks) {
    assert.match(mark, /isAnimationActive=\{false\}/);
  }
});
