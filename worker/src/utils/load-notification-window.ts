import { buildAdminSettings } from '../settings/schema.ts';
import { recordPersistThresholdMs } from './record-persist.ts';

export const LOAD_NOTIFICATION_POLICY_SETTING_KEYS = [
  'record_enabled', 'record_persist_interval_sec',
  'live_poll_active_interval_sec', 'live_poll_idle_interval_sec',
] as const;

export interface LoadNotificationPolicy {
  minimum_interval_min: number;
  sample_interval_sec: number;
  history_enabled: boolean;
}

export function buildLoadNotificationPolicy(stored: Record<string, string> = {}): LoadNotificationPolicy {
  const settings = buildAdminSettings(stored);
  const thresholdMs = recordPersistThresholdMs(Number(settings.record_persist_interval_sec) * 1000);
  // Persistence is checked only when a report arrives. Compute both stable
  // reporting modes separately: the slower mode need not produce the slower
  // persisted cadence when the persistence threshold skips whole reports.
  const sampleSeconds = Math.max(...[
    Number(settings.live_poll_active_interval_sec), Number(settings.live_poll_idle_interval_sec),
  ].map(reportSeconds => Math.max(1, Math.ceil(thresholdMs / (reportSeconds * 1000))) * reportSeconds));
  return {
    minimum_interval_min: Math.max(1, Math.ceil(2 * sampleSeconds / 60)),
    sample_interval_sec: sampleSeconds,
    history_enabled: settings.record_enabled === 'true',
  };
}

export function effectiveLoadNotificationIntervalMin(configured: number, policy: LoadNotificationPolicy): number {
  return Math.max(policy.minimum_interval_min, Number.isFinite(configured) && configured > 0 ? configured : 15);
}
