import type { LastKnownRecord, LiveDataResponse, LiveRecord } from '../contexts/LiveDataContext';
import { diskMeasurementMetadata } from './diskMeasurement.ts';

export type ViewerTokenResponse = {
  token: string;
  expires_at: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function emptyLiveDataResponse(now = Date.now()): LiveDataResponse {
  return { online: [], clients: [], data: {}, last_known: {}, count: 0, timestamp: now };
}

const lastKnownMetrics = ['cpu', 'gpu', 'ram', 'ram_total', 'swap', 'swap_total', 'disk', 'disk_total',
  'net_in', 'net_out', 'net_total_up', 'net_total_down', 'load', 'temp', 'uptime', 'process_count', 'connections', 'connections_udp'] as const;
const nullableMetrics = new Set<string>(['cpu', 'ram', 'ram_total', 'swap', 'swap_total',
  'net_in', 'net_out', 'net_total_up', 'net_total_down', 'disk', 'disk_total', 'load', 'temp', 'uptime']);

export function selectMetricAvailability(payload: unknown): Pick<LiveRecord, 'cpu_capacity' | 'metric_errors'> {
  const record = asRecord(payload);
  const result: Pick<LiveRecord, 'cpu_capacity' | 'metric_errors'> = {};
  const errors = asRecord(record?.metric_errors);
  for (const metric of ['cpu', 'ram', 'swap', 'network'] as const) {
    const reason = errors?.[metric];
    if (reason === 'collection_failed' || reason === 'container_scope_unavailable' || reason === 'warming_up') {
      (result.metric_errors ??= {})[metric] = reason;
    }
  }
  const capacity = asFiniteNumber(record?.cpu_capacity);
  if (capacity !== null && capacity > 0) result.cpu_capacity = capacity;
  return result;
}

function normalizeLiveMetricMetadata(record: Record<string, unknown>) {
  const { cpu_capacity: _capacity, metric_errors: _errors, ...fields } = record;
  return { ...fields, ...selectMetricAvailability(record) };
}

export function normalizeLastKnownRecord(payload: unknown, uuid: string): LastKnownRecord | null {
  const record = asRecord(payload);
  if (!record || record.uuid !== uuid || !uuid.trim() || typeof record.name !== 'string') return null;
  const lastReportTime = asFiniteNumber(record.lastReportTime);
  if (lastReportTime === null || lastReportTime < 0) return null;
  const result: LastKnownRecord = { uuid, name: record.name, lastReportTime };
  for (const key of lastKnownMetrics) {
    const value = record[key];
    if ((value === null && nullableMetrics.has(key)) || asFiniteNumber(value) !== null) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  Object.assign(result, selectMetricAvailability(record));
  const diskSource = diskMeasurementMetadata(record);
  if (diskSource.valid) {
    result.disk_source = 'directory';
    result.disk_sampled_at = diskSource.sampledAt;
  } else if (diskSource.attempted) {
    result.disk = null;
  }
  if (typeof record.message === 'string') result.message = record.message;
  const order = asFiniteNumber(record.sort_order);
  if (order !== null) result.sort_order = order;
  return result;
}

export function normalizeLiveDataResponse(payload: unknown): LiveDataResponse | null {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.online) || !record.online.every(item => typeof item === 'string')) {
    return null;
  }
  const count = asFiniteNumber(record.count);
  if (count === null || count < 0) return null;
  const clients = Array.isArray(record.clients)
    ? record.clients.flatMap((client) => {
        const entry = asRecord(client);
        if (!entry || typeof entry.uuid !== 'string' || typeof entry.name !== 'string') return [];
        const lastReportTime = asFiniteNumber(entry.lastReportTime);
        if (lastReportTime === null) return [];
        return [{ ...normalizeLiveMetricMetadata(entry), uuid: entry.uuid, name: entry.name, lastReportTime }];
      }) as LiveDataResponse['clients']
    : [];
  const data = Object.fromEntries(Object.entries(asRecord(record.data) || {}).flatMap(([uuid, value]) => {
    const entry = asRecord(value);
    return entry ? [[uuid, normalizeLiveMetricMetadata(entry)]] : [];
  }));
  const online = record.online;
  const lastKnown = Object.fromEntries(Object.entries(asRecord(record.last_known) || {}).flatMap(([uuid, value]) => {
    const item = normalizeLastKnownRecord(value, uuid);
    return item && !online.includes(uuid) ? [[uuid, item]] : [];
  }));
  const metadataVersion = typeof record.metadata_version === 'string' && record.metadata_version.trim() !== ''
    ? record.metadata_version
    : undefined;
  return {
    online: record.online,
    clients,
    data: data as LiveDataResponse['data'] || {},
    last_known: lastKnown,
    count: Math.floor(count),
    timestamp: asFiniteNumber(record.timestamp) ?? Date.now(),
    ...(metadataVersion ? { metadata_version: metadataVersion } : {}),
  };
}

export function normalizeViewerTokenResponse(payload: unknown): ViewerTokenResponse | null {
  const record = asRecord(payload);
  if (!record || typeof record.token !== 'string' || record.token.trim() === '') return null;
  return {
    token: record.token,
    expires_at: typeof record.expires_at === 'number' && Number.isFinite(record.expires_at)
      ? record.expires_at
      : null,
  };
}
