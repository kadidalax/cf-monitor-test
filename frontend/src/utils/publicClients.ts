import type { ClientInfo } from '../types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanField(record: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function listItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  return Array.isArray(record?.data) ? record.data : [];
}

export function normalizePublicClient(payload: unknown): ClientInfo | null {
  const record = asRecord(payload);
  const uuid = typeof record?.uuid === 'string' ? record.uuid.trim() : '';
  if (!record || !uuid) return null;
  const name = stringField(record, 'name').trim() || uuid;

  return {
    uuid,
    name,
    cpu_name: stringField(record, 'cpu_name'),
    cpu_cores: numberField(record, 'cpu_cores'),
    os: stringField(record, 'os'),
    arch: stringField(record, 'arch'),
    has_ipv4: booleanField(record, 'has_ipv4'),
    has_ipv6: booleanField(record, 'has_ipv6'),
    region: stringField(record, 'region'),
    mem_total: numberField(record, 'mem_total'),
    swap_total: numberField(record, 'swap_total'),
    disk_total: numberField(record, 'disk_total'),
    group: stringField(record, 'group'),
    tags: stringField(record, 'tags'),
    hidden: booleanField(record, 'hidden'),
    price: numberField(record, 'price'),
    billing_cycle: numberField(record, 'billing_cycle'),
    currency: stringField(record, 'currency'),
    expired_at: stringField(record, 'expired_at'),
    traffic_limit: numberField(record, 'traffic_limit'),
    traffic_limit_type: stringField(record, 'traffic_limit_type'),
    sort_order: numberField(record, 'sort_order'),
    gpu_name: stringField(record, 'gpu_name'),
    version: stringField(record, 'version'),
    public_remark: stringField(record, 'public_remark'),
    virtualization: stringField(record, 'virtualization'),
    kernel_version: stringField(record, 'kernel_version'),
  };
}

export function normalizePublicClients(payload: unknown): ClientInfo[] {
  return listItems(payload).flatMap((item) => {
    const client = normalizePublicClient(item);
    return client && !client.hidden ? [client] : [];
  });
}
