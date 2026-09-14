import { Badge, Box, Button, Flex, Text } from '@radix-ui/themes';
import { Link } from 'react-router-dom';

interface StorageDiagnostics {
  database_allocated_bytes: number;
  application_allocated_bytes: number;
  other_allocated_bytes: number;
  tables: Record<string, { allocated_bytes: number }>;
  theme_payload_bytes: number;
  theme_count: number;
  theme_asset_count: number;
  measured_at: string;
  cache_seconds: number;
  budget_bytes: number;
  theme_quota_bytes: number;
  status: 'ok' | 'warning' | 'critical';
}

function readDiagnostics(value: unknown): StorageDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const numbers = ['database_allocated_bytes', 'application_allocated_bytes', 'other_allocated_bytes',
    'theme_payload_bytes', 'theme_count', 'theme_asset_count', 'cache_seconds', 'budget_bytes', 'theme_quota_bytes'];
  if (record.measurement !== 'database-allocation' || numbers.some(key => typeof record[key] !== 'number' || !Number.isFinite(record[key]) || (record[key] as number) < 0)) return null;
  if (Number(record.budget_bytes) <= 0 || Number(record.theme_quota_bytes) <= 0 ||
    !['ok', 'warning', 'critical'].includes(String(record.status)) ||
    typeof record.measured_at !== 'string' || !Number.isFinite(Date.parse(record.measured_at)) ||
    !record.tables || typeof record.tables !== 'object' || Array.isArray(record.tables)) return null;
  return record as unknown as StorageDiagnostics;
}

function storageSize(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '未读取';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

export default function DatabaseStoragePanel({ value }: { value: unknown }) {
  const data = readDiagnostics(value);
  const status = data?.status;
  const statusText = status === 'critical' ? '容量紧张' : status === 'warning' ? '接近预算' : '正常';
  const metrics = data ? [
    ['数据库整体占用', `${storageSize(data.database_allocated_bytes)} / ${storageSize(data.budget_bytes)}`],
    ['监控应用占用', storageSize(data.application_allocated_bytes)],
    ['其他数据与系统占用', storageSize(data.other_allocated_bytes)],
    ...[['website_checks', '网站检查记录'], ['theme_assets', '主题文件'], ['themes', '主题配置'], ['audit_logs', '审计日志']]
      .map(([key, label]) => [label, storageSize(data.tables[key]?.allocated_bytes)]),
    ['主题累计内容', `${storageSize(data.theme_payload_bytes)} / ${storageSize(data.theme_quota_bytes)}`],
  ] : [];

  return (
    <section aria-labelledby="database-storage-title" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-5)' }}>
      <Flex align="center" justify="between" gap="2" wrap="wrap" mb="2">
        <Text id="database-storage-title" size="2" weight="bold">数据库实际占用</Text>
        {data && <Badge color={status === 'critical' ? 'red' : status === 'warning' ? 'amber' : 'green'}>{statusText}</Badge>}
      </Flex>
      {!data ? <Text size="2" color="gray">数据库诊断尚未读取或暂不可用，可使用“刷新实际行数”重试。</Text> : (
        <Flex direction="column" gap="2">
          <Box asChild>
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '6px 16px', margin: 0, fontSize: 'var(--font-size-1)' }}>
              {metrics.map(([label, amount]) => <Box key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd style={{ margin: 0, textAlign: 'right' }}>{amount}</dd></Box>)}
            </dl>
          </Box>
          <Text size="1" color="gray">达到已保存整体预算的 85% 提醒，95% 显示容量紧张。预算按实际方案填写，平台实际配额以控制台为准。</Text>
          <Text size="1" color="gray">物理占用不决定历史写入恢复；历史恢复仍按有效数据与行数水位判断。删除内容后，数据库文件未必立即缩小。</Text>
          <Text size="1" color="gray">共 {data.theme_count} 个主题、{data.theme_asset_count} 个文件。主题累计内容达到限额后，可删除不用的主题或缩小图片和自定义样式后再保存。</Text>
          <Flex align="center" justify="between" gap="2" wrap="wrap">
            <Text size="1" color="gray">测量于 {new Date(data.measured_at).toLocaleString('zh-CN')}；缓存约 {Math.ceil(data.cache_seconds / 60)} 分钟。</Text>
            <Button asChild size="1" variant="soft"><Link to="/admin/themes">管理主题</Link></Button>
          </Flex>
        </Flex>
      )}
    </section>
  );
}
