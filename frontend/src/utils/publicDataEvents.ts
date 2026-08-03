import { clearCachedPublicBootstrap } from './publicBootstrap';
import { patchCachedPublicBootstrapClients } from './publicBootstrap';
import { broadcastCrossTab, subscribeCrossTab } from './crossTabEvents';

export const PUBLIC_DATA_UPDATED_EVENT = 'cf-monitor:public-data-updated';
export const PUBLIC_DATA_READY_EVENT = 'cf-monitor:public-data-ready';

const EMPTY_UPDATE_SUPPRESS_MS = 10_000;
let lastDetailedUpdateAt = 0;

export type PublicDataUpdateDetail = {
  force?: boolean;
  clients?: {
    upsert?: unknown[];
    remove?: string[];
  };
};

export function notifyPublicDataUpdated(detail?: PublicDataUpdateDetail) {
  rememberDetailedUpdate(detail);
  if (detail?.clients) patchCachedPublicBootstrapClients(detail);
  else clearCachedPublicBootstrap();
  broadcastCrossTab(PUBLIC_DATA_UPDATED_EVENT, detail);
}

function rememberDetailedUpdate(detail?: PublicDataUpdateDetail) {
  if (detail?.clients) lastDetailedUpdateAt = Date.now();
}

function shouldIgnoreEmptyUpdate(detail?: PublicDataUpdateDetail): boolean {
  if (detail?.force) return false;
  return !detail?.clients && Date.now() - lastDetailedUpdateAt < EMPTY_UPDATE_SUPPRESS_MS;
}

export function notifyPublicDataReady() {
  window.dispatchEvent(new CustomEvent(PUBLIC_DATA_READY_EVENT));
}

export function subscribePublicDataUpdated(callback: (detail?: PublicDataUpdateDetail) => void) {
  return subscribeCrossTab(PUBLIC_DATA_UPDATED_EVENT, (raw) => {
    const detail = raw as PublicDataUpdateDetail | undefined;
    rememberDetailedUpdate(detail);
    if (!shouldIgnoreEmptyUpdate(detail)) callback(detail);
  });
}
