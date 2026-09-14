import { metricNumber, resourceUsage } from './nodeMetrics.ts';

export interface MonitorHistoryRecord {
  time: string;
  cpu?: number | null;
  ram?: number | null;
  ram_total?: number | null;
  disk?: number | null;
  disk_total?: number | null;
  net_in?: number | null;
  net_out?: number | null;
  temp?: number | null;
  connections?: number;
  connections_udp?: number;
  process_count?: number;
}

export interface MonitorChartPoint {
  time: number;
  cpu: number | null;
  ram: number | null;
  disk: number | null;
  net_in: number | null;
  net_out: number | null;
  temp: number | null;
  connections: number;
  connections_udp: number;
  process_count: number;
}

const emptyMetricValues = {
  cpu: null,
  ram: null,
  disk: null,
  net_in: null,
  net_out: null,
  temp: null,
  connections: 0,
  connections_udp: 0,
  process_count: 0,
};

export function buildMonitorChartData(records: MonitorHistoryRecord[]): MonitorChartPoint[] {
  return records.map((record) => {
    const cpu = metricNumber(record.cpu);
    const memory = resourceUsage(record.ram, record.ram_total).percent;
    return {
      time: new Date(record.time).getTime(),
      cpu: cpu === null ? null : Number(cpu.toFixed(2)),
      ram: memory === null ? null : Number(memory.toFixed(1)),
      net_in: metricNumber(record.net_in),
      net_out: metricNumber(record.net_out),
      temp: typeof record.temp === 'number' && Number.isFinite(record.temp) ? record.temp : null,
      disk: typeof record.disk === 'number' && Number.isFinite(record.disk) && record.disk >= 0 &&
        typeof record.disk_total === 'number' && Number.isFinite(record.disk_total) && record.disk_total > 0
        ? Number(((record.disk / record.disk_total) * 100).toFixed(1))
        : null,
      connections: record.connections || 0,
      connections_udp: record.connections_udp || 0,
      process_count: record.process_count || 0,
    };
  });
}

export function buildMonitorChartAxisData(rangeMs: number, now = Date.now()): MonitorChartPoint[] {
  const end = Number.isFinite(now) ? now : Date.now();
  const start = end - Math.max(rangeMs, 1);

  return [
    { time: start, ...emptyMetricValues },
    { time: end, ...emptyMetricValues },
  ];
}

export function getMonitorChartRenderData(
  chartData: MonitorChartPoint[],
  rangeMs: number,
  now = Date.now(),
): MonitorChartPoint[] {
  return chartData.length > 0 ? chartData : buildMonitorChartAxisData(rangeMs, now);
}
