import * as db from '../db/queries.ts';
import type { WebsiteMonitor } from '../db/types.ts';
import {
  buildWebsiteAlertNotification,
  buildWebsiteRecoveryNotification,
  type NotificationMessage,
} from './notification-templates.ts';
import { scheduledItems, type ScheduledCursorContext } from './scheduled-budget.ts';
import { checkWebsiteMonitorHttp, shouldNotifyWebsiteDown, shouldNotifyWebsiteRecovery } from './website-monitor.ts';

interface WebsiteNotificationContext extends ScheduledCursorContext {
  database: db.QueryDatabase;
  getScheduledCursor?(key: string): Promise<string | undefined>;
}

type WebsiteNotificationSender = (
  message: NotificationMessage,
  delivery: { key: string; eventId: string },
) => Promise<boolean>;

const NOTIFICATION_CURSOR = 'website_notifications_after_id';
const PHASE_CURSOR = 'website_first_phase';

async function notifyWebsiteMonitor(
  context: WebsiteNotificationContext,
  monitor: WebsiteMonitor,
  now: Date,
  send: WebsiteNotificationSender,
  previousDownSince?: string | null,
): Promise<void> {
  if (shouldNotifyWebsiteDown(monitor, now)) {
    const downSince = Date.parse(monitor.down_since!);
    const sent = await send(buildWebsiteAlertNotification({
      name: monitor.name,
      url: monitor.url,
      downMinutes: Math.max(0, Math.floor((now.getTime() - downSince) / 60_000)),
      lastStatus: monitor.last_error || (monitor.last_status_code ? `HTTP ${monitor.last_status_code}` : 'network_error'),
      checkedAt: monitor.last_checked_at || now.toISOString(),
    }), { key: `website:${monitor.id}`, eventId: `down:${monitor.config_revision}:${monitor.down_since}` });
    if (!sent) return;
    if (!(await db.markWebsiteMonitorNotified(context.database, monitor.id, now.toISOString(), monitor))) return;
    await db.insertAuditLog(context.database, 'system', 'website_down', `已发送网站告警: ${monitor.name}`);
  }

  if (shouldNotifyWebsiteRecovery(monitor)) {
    const downSince = Date.parse(previousDownSince || '');
    const sent = await send(buildWebsiteRecoveryNotification({
      name: monitor.name,
      url: monitor.url,
      downMinutes: Number.isFinite(downSince) ? Math.max(0, Math.floor((now.getTime() - downSince) / 60_000)) : null,
      statusCode: monitor.last_status_code,
      latencyMs: monitor.last_latency_ms,
      eventTime: now,
    }), { key: `website:${monitor.id}`, eventId: `recovery:${monitor.config_revision}:${monitor.last_notified_at}` });
    if (!sent) return;
    if (!(await db.markWebsiteMonitorNotified(context.database, monitor.id, null, monitor))) return;
    await db.insertAuditLog(context.database, 'system', 'website_recovery', `已发送网站恢复: ${monitor.name}`);
  }
}

async function runPendingNotifications(context: WebsiteNotificationContext, now: Date, send: WebsiteNotificationSender): Promise<void> {
  const cursor = Number(await context.getScheduledCursor?.(NOTIFICATION_CURSOR) || 0);
  const afterId = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  context.budget?.ensureCanStart(1);
  const pending = await db.listPendingWebsiteNotifications(context.database, now.toISOString(), 50, afterId);
  for (const monitor of pending) {
    context.budget?.ensureCanStart(14);
    await notifyWebsiteMonitor(context, monitor, now, send);
    // Move past completed attempts as well as successful sends. The SQL cursor
    // wraps, so retryable failures remain reachable without starving later IDs.
    context.advanceScheduledCursor?.(NOTIFICATION_CURSOR, String(monitor.id));
  }
}

async function runProbes(context: WebsiteNotificationContext, now: Date, send: WebsiteNotificationSender): Promise<void> {
  const monitors = await db.listDueWebsiteMonitors(context.database, now.toISOString(), 50);
  for await (const monitor of scheduledItems(context, 'websites', monitors, monitor => String(monitor.id))) {
    const check = await checkWebsiteMonitorHttp(monitor);
    const updated = await db.recordWebsiteCheck(context.database, check);
    if (!updated) continue;
    await notifyWebsiteMonitor(context, updated, now, send, monitor.down_since);
  }
}

export async function runWebsiteMonitoring(
  context: WebsiteNotificationContext,
  now: Date,
  send: WebsiteNotificationSender,
): Promise<void> {
  const first = await context.getScheduledCursor?.(PHASE_CURSOR) === 'notifications' ? 'notifications' : 'probes';
  // Persist the next first phase before work: even if a slow probe exhausts the
  // invocation budget, the next scheduled run gives pending notifications a turn.
  context.advanceScheduledCursor?.(PHASE_CURSOR, first === 'probes' ? 'notifications' : 'probes');
  await context.flushScheduledCursors?.();
  const phases = first === 'probes' ? [runProbes, runPendingNotifications] : [runPendingNotifications, runProbes];
  for (const phase of phases) await phase(context, now, send);
}
