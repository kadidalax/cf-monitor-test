export const STORAGE_BUDGETS = {
  database_storage_budget_bytes: { label: '数据库整体预算', fallback: 524_288_000, min: 67_108_864, max: 549_755_813_888 },
  theme_storage_quota_bytes: { label: '主题累计内容限额', fallback: 33_554_432, min: 1_048_576, max: 1_073_741_824 },
} as const;

export function storageBudgetError(settings: Record<string, string>): string | null {
  for (const [key, rule] of Object.entries(STORAGE_BUDGETS)) {
    const value = Number(settings[key] ?? rule.fallback);
    if (!Number.isSafeInteger(value) || value < rule.min || value > rule.max) {
      return `${rule.label}超出允许范围，请输入 ${rule.min} 至 ${rule.max} 的整数字节数`;
    }
  }
  return null;
}
