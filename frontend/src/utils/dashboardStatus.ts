import { formatMetricBytes, formatMetricSpeed } from './nodeMetrics';

export const defaultStatusCardVisibility = {
  currentOnline: true,
  regionOverview: true,
  trafficOverview: true,
  networkSpeed: true,
} as const;

export type StatusCardKey = keyof typeof defaultStatusCardVisibility;

export interface DashboardStatusInput {
  onlineCount: number;
  totalCount: number;
  regionCount: number;
  totalUp: number | null;
  totalDown: number | null;
  totalSpeedUp: number | null;
  totalSpeedDown: number | null;
}

export interface DashboardStatusCard {
  key: StatusCardKey;
  title: string;
  value: string;
  detail: string;
  oneLine?: boolean;
  inlineValues?: string[];
}

export function buildDashboardStatusCards(input: DashboardStatusInput): DashboardStatusCard[] {
  const trafficValues = [`↑ ${formatMetricBytes(input.totalUp)}`, `↓ ${formatMetricBytes(input.totalDown)}`];
  const speedValues = [`↑ ${formatMetricSpeed(input.totalSpeedUp)}`, `↓ ${formatMetricSpeed(input.totalSpeedDown)}`];

  return [
    {
      key: 'currentOnline',
      title: '当前在线',
      value: `${input.onlineCount} / ${input.totalCount}`,
      detail: '在线节点 / 全部节点',
      oneLine: true,
    },
    {
      key: 'regionOverview',
      title: '点亮地区',
      value: String(input.regionCount),
      detail: '当前在线地区数',
      oneLine: true,
    },
    {
      key: 'trafficOverview',
      title: '流量概览',
      value: trafficValues.join('  '),
      detail: '累计上传 / 下载',
      inlineValues: trafficValues,
      oneLine: true,
    },
    {
      key: 'networkSpeed',
      title: '网速',
      value: speedValues.join('  '),
      detail: '实时上传 / 下载',
      inlineValues: speedValues,
      oneLine: true,
    },
  ];
}
