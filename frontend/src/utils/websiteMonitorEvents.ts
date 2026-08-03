import { broadcastCrossTab, subscribeCrossTab } from './crossTabEvents';

export const WEBSITE_MONITORS_UPDATED_EVENT = 'cf-monitor:website-monitors-updated';

export type WebsiteMonitorsUpdateDetail = {
  upsert?: unknown[];
  remove?: number[];
  reorder?: number[];
};

export function notifyWebsiteMonitorsUpdated(detail?: WebsiteMonitorsUpdateDetail | true) {
  broadcastCrossTab(WEBSITE_MONITORS_UPDATED_EVENT, detail);
}

export function subscribeWebsiteMonitorsUpdated(
  callback: (detail?: WebsiteMonitorsUpdateDetail | true) => void,
) {
  return subscribeCrossTab(
    WEBSITE_MONITORS_UPDATED_EVENT,
    detail => callback(detail as WebsiteMonitorsUpdateDetail | true | undefined),
  );
}
