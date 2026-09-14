import { ClientInfo, LiveDataMap, LiveRecord } from '../types';
import { resolveFlagCode } from '../components/Flag';
import { getNodeStatus, metricNumber, resourceUsage, sumMetrics } from './nodeMetrics';

export type OfflinePosition = 'first' | 'keep' | 'last';
export type NodeStatusFilter = 'all' | 'online' | 'offline';
export type AdminSortKey =
  | 'manual'
  | 'name'
  | 'status'
  | 'cpu'
  | 'memory'
  | 'disk'
  | 'network'
  | 'traffic';

export interface NodeStatsSummary {
  onlineCount: number;
  totalCount: number;
  regionCount: number;
  totalUp: number | null;
  totalDown: number | null;
  totalSpeedUp: number | null;
  totalSpeedDown: number | null;
}

export interface MonitorFilterOptions {
  searchTerm?: string;
  selectedGroup?: string;
  statusFilter?: NodeStatusFilter;
  offlinePosition?: OfflinePosition;
}

export interface AdminFilterOptions extends MonitorFilterOptions {
  sortKey?: AdminSortKey;
  sortDir?: 'asc' | 'desc';
}

export function normalizeLiveData(rawLiveData: any): LiveDataMap {
  if (!rawLiveData) return { online: [], data: {}, statusReady: false };

  const online = [...(rawLiveData.online || [])] as string[];
  const data: Record<string, LiveRecord> = {};

  if (rawLiveData.data) {
    for (const [uuid, record] of Object.entries(rawLiveData.data)) {
      data[uuid] = record as LiveRecord;
    }
  }

  if (Array.isArray(rawLiveData.clients)) {
    for (const client of rawLiveData.clients) {
      const hasExplicitOnlineFlag = typeof client.online === 'boolean';
      if (client.uuid && !online.includes(client.uuid) && (!hasExplicitOnlineFlag || client.online)) {
        online.push(client.uuid);
      }

      if (client.uuid && !data[client.uuid]) {
        data[client.uuid] = client as LiveRecord;
      }
    }
  }

  return { online, data, last_known: rawLiveData.last_known || {}, statusReady: rawLiveData.statusReady ?? true };
}

export function getNodeStatsSummary(
  clients: ClientInfo[],
  liveData: LiveDataMap,
): NodeStatsSummary {
  let totalUp: number | null = 0;
  let totalDown: number | null = 0;
  let totalSpeedUp: number | null = 0;
  let totalSpeedDown: number | null = 0;

  const onlineCount = clients.filter((client) =>
    liveData.online.includes(client.uuid),
  ).length;

  const regionSet = new Set(
    clients
      .filter((client) => liveData.online.includes(client.uuid) && client.region)
      .map((client) => resolveFlagCode(client.region))
      .filter((code) => code !== 'UN'),
  );

  for (const client of clients) {
    if (!liveData.online.includes(client.uuid)) continue;

    const record = liveData.data[client.uuid];
    totalUp = sumMetrics(totalUp, record?.net_total_up);
    totalDown = sumMetrics(totalDown, record?.net_total_down);
    totalSpeedUp = sumMetrics(totalSpeedUp, record?.net_out);
    totalSpeedDown = sumMetrics(totalSpeedDown, record?.net_in);
  }

  return {
    onlineCount,
    totalCount: clients.length,
    regionCount: regionSet.size,
    totalUp,
    totalDown,
    totalSpeedUp,
    totalSpeedDown,
  };
}

export function getNodeGroups(clients: ClientInfo[]): string[] {
  return Array.from(
    new Set(clients.map((client) => client.group?.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

export function filterMonitorNodes(
  clients: ClientInfo[],
  liveData: LiveDataMap,
  options: MonitorFilterOptions = {},
): ClientInfo[] {
  const {
    searchTerm = '',
    selectedGroup = 'all',
    statusFilter = 'all',
    offlinePosition = 'keep',
  } = options;

  const term = searchTerm.trim().toLowerCase();

  const filtered = clients.filter((client) => {
    const status = getNodeStatus(client.uuid, liveData);
    const isOnline = status === 'online';

    if (selectedGroup !== 'all' && client.group !== selectedGroup) {
      return false;
    }

    if (statusFilter === 'online' && !isOnline) {
      return false;
    }

    if (statusFilter === 'offline' && status !== 'offline') {
      return false;
    }

    if (!term) return true;

    return [
      client.name,
      client.os,
      client.region,
      client.group,
      client.tags,
      client.public_remark || '',
    ]
      .join('\n')
      .toLowerCase()
      .includes(term);
  });

  return applyOfflinePosition(filtered, liveData, offlinePosition);
}

export function sortAdminNodes(
  clients: ClientInfo[],
  liveData: LiveDataMap,
  options: AdminFilterOptions = {},
): ClientInfo[] {
  const sortKey = options.sortKey || 'name';
  const sortDir = options.sortDir || 'asc';

  const sorted = [...filterMonitorNodes(clients, liveData, options)].sort((a, b) => {
    const aOnline = liveData.online.includes(a.uuid);
    const bOnline = liveData.online.includes(b.uuid);
    const aLive = liveData.data[a.uuid];
    const bLive = liveData.data[b.uuid];

    let comparison = 0;
    let metrics: [unknown, unknown] | undefined;

    switch (sortKey) {
      case 'manual':
        comparison = getSortOrder(a) - getSortOrder(b);
        break;
      case 'name':
        comparison = (a.name || '').localeCompare(b.name || '');
        break;
      case 'status':
        comparison = Number(bOnline) - Number(aOnline);
        break;
      case 'cpu':
        metrics = [aLive?.cpu, bLive?.cpu];
        break;
      case 'memory':
        metrics = [resourceUsage(aLive?.ram, aLive?.ram_total, a.mem_total).percent, resourceUsage(bLive?.ram, bLive?.ram_total, b.mem_total).percent];
        break;
      case 'disk':
        metrics = [resourceUsage(aLive?.disk, aLive?.disk_total, a.disk_total).percent, resourceUsage(bLive?.disk, bLive?.disk_total, b.disk_total).percent];
        break;
      case 'network':
        metrics = [sumMetrics(aLive?.net_in, aLive?.net_out), sumMetrics(bLive?.net_in, bLive?.net_out)];
        break;
      case 'traffic':
        metrics = [sumMetrics(aLive?.net_total_up, aLive?.net_total_down), sumMetrics(bLive?.net_total_up, bLive?.net_total_down)];
        break;
      default:
        comparison = (a.name || '').localeCompare(b.name || '');
        break;
    }

    if (metrics) {
      const [aValue, bValue] = metrics.map(metricNumber);
      if (aValue === null || bValue === null) {
        if (aValue !== bValue) return aValue === null ? 1 : -1;
      } else comparison = aValue - bValue;
    }
    if (comparison === 0) {
      comparison = (a.name || '').localeCompare(b.name || '');
    }

    return sortDir === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

function applyOfflinePosition(
  clients: ClientInfo[],
  liveData: LiveDataMap,
  offlinePosition: OfflinePosition,
): ClientInfo[] {
  if (offlinePosition === 'keep' || liveData.statusReady === false) return [...clients];

  return [...clients].sort((a, b) => {
    const aOnline = liveData.online.includes(a.uuid);
    const bOnline = liveData.online.includes(b.uuid);

    if (aOnline === bOnline) {
      return 0;
    }

    if (offlinePosition === 'first') {
      return aOnline ? 1 : -1;
    }

    return aOnline ? -1 : 1;
  });
}

function getSortOrder(client: ClientInfo): number {
  return typeof client.sort_order === 'number' && Number.isFinite(client.sort_order)
    ? client.sort_order
    : Number.MAX_SAFE_INTEGER;
}
