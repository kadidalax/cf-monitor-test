export type SettingsMap = Record<string, string>;

export function mergeConfirmedSettingsDraft(current: SettingsMap, submitted: SettingsMap, confirmed: SettingsMap): SettingsMap {
  const next = { ...confirmed };
  for (const key of new Set([...Object.keys(current), ...Object.keys(submitted)])) {
    if (current[key] === submitted[key]) continue;
    if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
    else delete next[key];
  }
  return next;
}

export function getChangedSettings(
  current: SettingsMap,
  original: SettingsMap,
  keys: readonly string[] = Object.keys(current),
): SettingsMap {
  const changed: SettingsMap = {};

  for (const key of keys) {
    if (current[key] !== original[key]) {
      changed[key] = current[key] ?? '';
    }
  }

  return changed;
}
