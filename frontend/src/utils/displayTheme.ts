export const displayThemes = ['monitor', 'next', 'aurora'] as const;

export type DisplayTheme = typeof displayThemes[number];

export const defaultDisplayTheme: DisplayTheme = 'monitor';

export const displayThemeLabels: Record<DisplayTheme, string> = {
  monitor: 'Monitor',
  next: 'Next',
  aurora: 'Aurora',
};

const legacyDisplayThemeMap: Record<string, DisplayTheme> = {
  'cf-monitor': 'next',
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
