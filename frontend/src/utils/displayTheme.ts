export const displayThemes = ['monitor', 'aurora'] as const;

export type DisplayTheme = typeof displayThemes[number];

export const defaultDisplayTheme: DisplayTheme = 'monitor';

export const displayThemeLabels: Record<DisplayTheme, string> = {
  monitor: 'Monitor',
  aurora: 'Aurora',
};

// 已退场主题的迁移目标。未列入这里的陌生值会回落 defaultDisplayTheme（Monitor），
// 所以移除一套主题时必须同时在此登记，否则老用户不是被"替换"而是被打回默认。
// Next 由 Aurora 全面接替；cf-monitor 原本指向 next，跟着改指 aurora。
const legacyDisplayThemeMap: Record<string, DisplayTheme> = {
  'cf-monitor': 'aurora',
  next: 'aurora',
};

export function normalizeDisplayTheme(value: unknown): DisplayTheme {
  if (typeof value === 'string' && legacyDisplayThemeMap[value]) {
    return legacyDisplayThemeMap[value];
  }

  return displayThemes.includes(value as DisplayTheme)
    ? (value as DisplayTheme)
    : defaultDisplayTheme;
}

// 非法值 indexOf 得 -1，(-1 + 1) % n === 0 回落到第一套，与 normalizeDisplayTheme 一致。
export function getNextDisplayTheme(theme: DisplayTheme): DisplayTheme {
  const index = displayThemes.indexOf(theme);
  return displayThemes[(index + 1) % displayThemes.length];
}
