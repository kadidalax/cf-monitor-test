interface HistoryIdentity {
  time: string;
  id?: string;
  device_index?: number;
  device_ordinal?: number;
}

export interface PublicMonitorRecord extends HistoryIdentity {
  cpu: number | null;
  ram: number | null;
  ram_total: number | null;
  swap: number | null;
  swap_total: number | null;
  disk: number | null;
  disk_total: number | null;
  // null = 探针报告本机负载不可取信（容器内 /proc/loadavg 透传宿主机），不是 0。
  load: number | null;
  temp: number | null;
  net_in: number | null;
  net_out: number | null;
  net_total_up: number | null;
  net_total_down: number | null;
  process_count: number;
  connections: number;
  connections_udp: number;
  uptime: number | null;
}

export interface PublicGpuRecord extends HistoryIdentity {
  utilization: number;
  mem_total: number;
  mem_used: number;
  temperature: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function listItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  return Array.isArray(record?.data) ? record.data : [];
}

function timeField(record: Record<string, unknown>): string | null {
  const value = record.time;
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : null;
}

export function normalizeHistoryRecordId(value: unknown): string | undefined {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
}

function preciseHistoryTime(value: string): bigint | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i)?.[1] || '';
  return BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6) || '0');
}

function parseHistoryCursor(value: string) {
  const parts = value.split('|');
  if (parts.length === 1) {
    const time = preciseHistoryTime(value);
    return time === null ? null : { time, id: null, ordinal: null };
  }
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^[1-9]\d*$/.test(parts[2]) || !/^\d+$/.test(parts[3])) return null;
  const time = preciseHistoryTime(parts[1]);
  return time === null ? null : { time, id: BigInt(parts[2]), ordinal: BigInt(parts[3]) };
}

function recordIdentity(record: HistoryIdentity): string {
  return `${preciseHistoryTime(record.time)}|${record.id ?? ''}|${record.device_ordinal ?? record.device_index ?? ''}`;
}

function compareHistoryRecords(a: HistoryIdentity, b: HistoryIdentity): number {
  const aTime = preciseHistoryTime(a.time) ?? 0n;
  const bTime = preciseHistoryTime(b.time) ?? 0n;
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  const aId = BigInt(a.id || '0');
  const bId = BigInt(b.id || '0');
  if (aId !== bId) return aId < bId ? -1 : 1;
  return (a.device_ordinal ?? a.device_index ?? 0) - (b.device_ordinal ?? b.device_index ?? 0);
}

export function mergeHistoryRecords<T extends HistoryIdentity>(records: T[]): T[] {
  return [...new Map(records.map(record => [recordIdentity(record), record])).values()].sort(compareHistoryRecords);
}

export function historyCursorFromRecord(record: HistoryIdentity): string {
  return record.id ? `v1|${record.time}|${record.id}|${record.device_ordinal ?? 0}` : record.time;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  if (!(key in record) || record[key] === undefined) return 0;
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function allNumbers<K extends string>(values: Record<K, number | null>): values is Record<K, number> {
  return Object.values(values).every((value): value is number => value !== null);
}

function optionalMetric(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// 显式 null 是未测得；旧记录缺字段仍兼容 0。undefined 只表示非法输入。
function nullableNumberField(record: Record<string, unknown>, key: string): number | null | undefined {
  const value = record[key];
  if (value === undefined) return 0;
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizePublicMonitorRecord(payload: unknown): PublicMonitorRecord | null {
  const record = asRecord(payload);
  if (!record) return null;
  const time = timeField(record);
  if (!time) return null;
  const load = nullableNumberField(record, 'load');
  if (load === undefined) return null;
  // 温度未知不能补成 0，也不能丢弃同一条记录中的 CPU 等有效指标。
  const temp = typeof record.temp === 'number' && Number.isFinite(record.temp) ? record.temp : null;
  const metrics = {
    cpu: nullableNumberField(record, 'cpu'),
    ram: nullableNumberField(record, 'ram'),
    ram_total: nullableNumberField(record, 'ram_total'),
    swap: nullableNumberField(record, 'swap'),
    swap_total: nullableNumberField(record, 'swap_total'),
    net_in: nullableNumberField(record, 'net_in'),
    net_out: nullableNumberField(record, 'net_out'),
    net_total_up: nullableNumberField(record, 'net_total_up'),
    net_total_down: nullableNumberField(record, 'net_total_down'),
  };
  if (Object.values(metrics).some(value => value === undefined)) return null;
  const values = {
    process_count: numberField(record, 'process_count'),
    connections: numberField(record, 'connections'),
    connections_udp: numberField(record, 'connections_udp'),
  };
  if (!allNumbers(values)) return null;

  return {
    time,
    id: normalizeHistoryRecordId(record.id),
    ...metrics as Record<keyof typeof metrics, number | null>,
    disk: optionalMetric(record, 'disk'),
    disk_total: optionalMetric(record, 'disk_total'),
    load,
    temp,
    process_count: values.process_count,
    connections: values.connections,
    connections_udp: values.connections_udp,
    uptime: optionalMetric(record, 'uptime'),
  };
}

export function normalizePublicMonitorRecords(payload: unknown): PublicMonitorRecord[] {
  return listItems(payload).flatMap((item) => {
    const record = normalizePublicMonitorRecord(item);
    return record ? [record] : [];
  });
}

export function normalizePublicGpuRecord(payload: unknown): PublicGpuRecord | null {
  const record = asRecord(payload);
  if (!record) return null;
  const time = timeField(record);
  if (!time) return null;
  const values = {
    utilization: numberField(record, 'utilization'),
    mem_total: numberField(record, 'mem_total'),
    mem_used: numberField(record, 'mem_used'),
    temperature: numberField(record, 'temperature'),
  };
  if (!allNumbers(values)) return null;

  return {
    time,
    id: normalizeHistoryRecordId(record.id),
    ...(typeof record.device_index === 'number' && Number.isSafeInteger(record.device_index) && record.device_index >= 0 ? { device_index: record.device_index } : {}),
    ...(typeof record.device_ordinal === 'number' && Number.isSafeInteger(record.device_ordinal) && record.device_ordinal > 0 ? { device_ordinal: record.device_ordinal } : {}),
    utilization: values.utilization,
    mem_total: values.mem_total,
    mem_used: values.mem_used,
    temperature: values.temperature,
  };
}

export function normalizePublicGpuRecords(payload: unknown): PublicGpuRecord[] {
  return listItems(payload).flatMap((item) => {
    const record = normalizePublicGpuRecord(item);
    return record ? [record] : [];
  });
}

export async function collectCursorHistory<T extends HistoryIdentity>(
  fetchPage: (cursor: string) => Promise<unknown>,
  options: {
    cursor: string;
    start: string;
    end?: string;
    normalize: (payload: unknown) => T[];
    signal?: AbortSignal;
    maxPages?: number;
  },
): Promise<T[]> {
  const start = preciseHistoryTime(options.start);
  const end = parseHistoryCursor(options.end || options.cursor)?.time ?? null;
  if (start === null || end === null || start > end) throw new Error('历史时间范围无效');
  const records = new Map<string, T>();
  const result = () => [...records.values()].sort(compareHistoryRecords);
  let cursor = options.cursor;
  let position = parseHistoryCursor(cursor);
  if (!position) throw new Error('历史分页游标无效');
  const maxPages = Math.min(32, Math.max(1, options.maxPages ?? 32));
  for (let page = 0; page < maxPages; page += 1) {
    options.signal?.throwIfAborted();
    const payload = await fetchPage(cursor);
    options.signal?.throwIfAborted();
    const envelope = asRecord(payload);
    if (!Array.isArray(payload) && !Array.isArray(envelope?.data)) throw new Error('历史记录响应格式无效');
    for (const record of options.normalize(payload)) {
      const at = preciseHistoryTime(record.time);
      if (at !== null && at >= start && at <= end) records.set(recordIdentity(record), record);
    }
    if (envelope?.has_more !== true) return result();
    const next = typeof envelope.next_cursor_key === 'string' ? envelope.next_cursor_key
      : typeof envelope.next_cursor === 'string' ? envelope.next_cursor : '';
    const nextPosition = parseHistoryCursor(next);
    const advances = nextPosition && (nextPosition.time < position.time ||
      (nextPosition.time === position.time && nextPosition.id !== null &&
        (position.id === null || nextPosition.id < position.id ||
          (nextPosition.id === position.id && nextPosition.ordinal! < position.ordinal!))));
    if (!nextPosition || !advances) throw new Error('历史分页游标无效');
    if (nextPosition.time < start) return result();
    cursor = next;
    position = nextPosition;
  }
  throw new Error('历史记录过多，请选择更短的时间范围');
}
