export const LIVE_POLL_INTERVAL_ACTIVE = 3000;
export const LIVE_POLL_INTERVAL_IDLE = 2 * 60 * 1000;
// 与 normalizeLivePollConfig 的默认值保持一致（此前是 10 分钟，与设置默认值不符）
export const LIVE_POLL_ACTIVE_MAX_DURATION = 2 * 60 * 1000;
export const LIVE_POLL_SETTINGS_UPDATED_EVENT = 'cf-monitor:live-poll-settings-updated';

/**
 * WebSocket 重连退避序列。
 *
 * 刻意封顶在 60 秒而不是更长：可见状态下 HTTP 轮询已在以 activeIntervalMs
 * 兑现实时体验，重连的作用不是保体验，而是尽快从昂贵的 HTTP 轮询切回 WS。
 * 退避过狠会让系统在贵路径上滞留更久，总请求数反而更高。
 */
export const LIVE_WS_RECONNECT_BACKOFF_MS = [5_000, 10_000, 30_000, 60_000] as const;

/** 连续失败达到此次数即判定为硬故障（如代理阻断 WebSocket），停止重连。 */
export const LIVE_WS_FAILURE_CIRCUIT_BREAK = 10;

export interface LivePollConfig {
  activeIntervalMs: number;
  idleIntervalMs: number;
  activeMaxDurationMs: number;
}

interface LivePollSettings {
  live_poll_active_interval_sec?: unknown;
  live_poll_idle_interval_sec?: unknown;
  live_poll_active_max_duration_sec?: unknown;
}

export const DEFAULT_LIVE_POLL_CONFIG: LivePollConfig = {
  activeIntervalMs: LIVE_POLL_INTERVAL_ACTIVE,
  idleIntervalMs: LIVE_POLL_INTERVAL_IDLE,
  activeMaxDurationMs: LIVE_POLL_ACTIVE_MAX_DURATION,
};

function secondsToMsSetting(
  value: unknown,
  fallbackSeconds: number,
  minSeconds: number,
  maxSeconds: number,
) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const seconds = Number.isFinite(parsed) ? parsed : fallbackSeconds;
  return Math.min(Math.max(seconds, minSeconds), maxSeconds) * 1000;
}

export function normalizeLivePollConfig(settings: LivePollSettings | null | undefined): LivePollConfig {
  return {
    activeIntervalMs: secondsToMsSetting(settings?.live_poll_active_interval_sec, 3, 3, 300),
    idleIntervalMs: secondsToMsSetting(settings?.live_poll_idle_interval_sec, 120, 60, 3600),
    activeMaxDurationMs: secondsToMsSetting(settings?.live_poll_active_max_duration_sec, 120, 60, 3600),
  };
}

export function getLivePollDelay({
  hidden,
  activeSince,
  now = Date.now(),
  config = DEFAULT_LIVE_POLL_CONFIG,
}: {
  hidden: boolean;
  activeSince?: number | null;
  now?: number;
  config?: LivePollConfig;
}) {
  if (hidden) return config.idleIntervalMs;
  if (typeof activeSince === 'number' && now - activeSince >= config.activeMaxDurationMs) {
    return config.idleIntervalMs;
  }
  return config.activeIntervalMs;
}

/**
 * 标签页隐藏时不重连：没人在看，重连纯属浪费。
 * 切回可见时由 visibilitychange 立刻补一次连接。
 */
export function shouldReconnectLiveWebSocket({
  expired,
  hidden,
}: {
  expired: boolean;
  hidden: boolean;
}) {
  return !expired && !hidden;
}

/**
 * 标签页隐藏且 WebSocket 未连通时不轮询：拉回来的数据没有任何人会看到，
 * 切回可见时 visibilitychange 会立刻拉一次。
 */
export function shouldPollLiveData({
  hidden,
  wsOpen,
}: {
  hidden: boolean;
  wsOpen: boolean;
}) {
  return !(hidden && !wsOpen);
}

export function getLiveWsReconnectDelay(attempt: number): number {
  const last = LIVE_WS_RECONNECT_BACKOFF_MS.length - 1;
  const index = Number.isFinite(attempt) ? Math.min(Math.max(Math.trunc(attempt), 0), last) : 0;
  return LIVE_WS_RECONNECT_BACKOFF_MS[index];
}

export function isLiveWsCircuitOpen(failStreak: number): boolean {
  return Number.isFinite(failStreak) && failStreak >= LIVE_WS_FAILURE_CIRCUIT_BREAK;
}
