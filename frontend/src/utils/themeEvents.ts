export const THEME_UPDATED_EVENT = 'cf-monitor:theme-updated';

import { broadcastCrossTab, subscribeCrossTab } from './crossTabEvents';

export function notifyThemeUpdated() {
  broadcastCrossTab(THEME_UPDATED_EVENT);
}

export function subscribeThemeUpdated(callback: () => void) {
  return subscribeCrossTab(THEME_UPDATED_EVENT, () => callback());
}
