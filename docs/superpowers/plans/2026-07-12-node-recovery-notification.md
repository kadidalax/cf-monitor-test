# Node Recovery Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one offline alert per incident and one recovery notification when an alerted node resumes reporting.

**Architecture:** Extract the offline transition decision into one pure utility, reuse `offline_notifications.last_notified` as the persisted open-incident marker, and keep all delivery through the existing notification dispatcher. Update the Supabase RPC so the marker can be cleared without adding tables or columns.

**Tech Stack:** Cloudflare Workers, TypeScript, Node.js assert, Supabase/Postgres RPC migrations.

---

### Task 1: Define and test the offline incident state machine

**Files:**
- Create: `worker/src/utils/offline-notification.ts`
- Create: `worker/src/utils/offline-notification.test.mjs`
- Modify: `worker/src/index.ts:543-632`

- [ ] **Step 1: Write the failing state-machine test**

```js
import assert from 'node:assert/strict';
import { evaluateOfflineNotificationEvent } from './offline-notification.ts';

const now = new Date('2026-07-12T04:10:00.000Z');
const base = {
  now,
  clientCreatedAt: '2026-07-12T03:00:00.000Z',
  gracePeriodSec: 180,
  notifyNeverReported: true,
};

assert.equal(evaluateOfflineNotificationEvent({
  ...base,
  lastTime: '2026-07-12T04:09:00.000Z',
  lastNotified: null,
}), null);

assert.equal(evaluateOfflineNotificationEvent({
  ...base,
  lastTime: '2026-07-12T04:00:00.000Z',
  lastNotified: null,
})?.type, 'offline');

assert.equal(evaluateOfflineNotificationEvent({
  ...base,
  lastTime: '2026-07-12T04:00:00.000Z',
  lastNotified: '2026-07-12T04:04:00.000Z',
}), null);

assert.deepEqual(evaluateOfflineNotificationEvent({
  ...base,
  lastTime: '2026-07-12T04:09:00.000Z',
  lastNotified: '2026-07-12T04:04:00.000Z',
}), {
  type: 'recovery',
  recoveredAt: '2026-07-12T04:09:00.000Z',
});

assert.equal(evaluateOfflineNotificationEvent({
  ...base,
  lastTime: null,
  lastNotified: null,
})?.type, 'offline');

assert.equal(evaluateOfflineNotificationEvent({
  ...base,
  lastTime: '2026-07-12T04:09:00.000Z',
  lastNotified: '2026-07-12T04:04:00.000Z',
  notifyNeverReported: false,
})?.type, 'recovery');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node worker/src/utils/offline-notification.test.mjs
```

Expected: FAIL with module/function not found.

- [ ] **Step 3: Implement the pure transition evaluator**

Create `worker/src/utils/offline-notification.ts`:

```ts
export type OfflineNotificationEvent =
  | {
      type: 'offline';
      offlineMs: number;
      lastSeenLabel: string;
      neverReported: boolean;
      createdAt?: string;
    }
  | {
      type: 'recovery';
      recoveredAt: string;
    };

export function evaluateOfflineNotificationEvent(args: {
  now: Date;
  clientCreatedAt: string | null | undefined;
  lastTime: string | null | undefined;
  lastNotified: string | null | undefined;
  gracePeriodSec: number;
  notifyNeverReported: boolean;
}): OfflineNotificationEvent | null {
  const graceMs = Math.max(30, Number(args.gracePeriodSec || 180)) * 1000;
  const nowMs = args.now.getTime();
  const neverReported = !args.lastTime;
  const referenceTime = args.lastTime || (
    args.notifyNeverReported ? args.clientCreatedAt : null
  );
  if (!referenceTime) return null;

  const referenceMs = new Date(referenceTime).getTime();
  if (Number.isNaN(referenceMs)) return null;

  const offlineMs = nowMs - referenceMs;
  if (offlineMs >= graceMs) {
    if (args.lastNotified) return null;
    return {
      type: 'offline',
      offlineMs,
      lastSeenLabel: neverReported ? '从未上报' : referenceTime,
      neverReported,
      ...(neverReported ? { createdAt: referenceTime } : {}),
    };
  }

  if (!args.lastNotified || !args.lastTime) return null;
  return { type: 'recovery', recoveredAt: args.lastTime };
}
```

- [ ] **Step 4: Run the state-machine test**

Run:

```bash
node worker/src/utils/offline-notification.test.mjs
```

Expected: exit 0.

### Task 2: Add the node recovery notification template

**Files:**
- Modify: `worker/src/utils/notification-templates.ts:59-78`
- Create: `worker/src/utils/notification-templates.test.mjs`

- [ ] **Step 1: Write the failing template test**

```js
import assert from 'node:assert/strict';
import { buildNodeRecoveryNotification } from './notification-templates.ts';

const notification = buildNodeRecoveryNotification({
  nodeName: '首尔节点',
  recoveredAt: '2026-07-12T04:09:00.000Z',
  eventTime: '2026-07-12T04:10:00.000Z',
});

assert.equal(notification.event, '恢复上线');
assert.equal(notification.clients, '首尔节点');
assert.match(notification.body, /节点已恢复上报/);
assert.match(notification.body, /2026-07-12 12:09:00/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node worker/src/utils/notification-templates.test.mjs
```

Expected: FAIL because `buildNodeRecoveryNotification` is not exported.

- [ ] **Step 3: Add the minimal template**

Add after `buildOfflineNotification`:

```ts
export function buildNodeRecoveryNotification(input: {
  nodeName: string;
  recoveredAt: string;
  eventTime?: string | Date;
}): NotificationMessage {
  return eventMessage({
    emoji: '🟢',
    event: '恢复上线',
    clients: input.nodeName,
    message: `节点已恢复上报；最新上报 ${formatNotificationTime(input.recoveredAt)}`,
    time: input.eventTime,
  });
}
```

- [ ] **Step 4: Run the template test**

Run:

```bash
node worker/src/utils/notification-templates.test.mjs
```

Expected: exit 0.

### Task 3: Persist and clear the incident marker

**Files:**
- Modify: `worker/src/db/supabase-api/client.ts:363-379`
- Modify: `worker/src/db/queries.ts` wrapper for `markOfflineNotificationSent`
- Modify: `supabase/migrations/4_rpc_api.sql:1023-1061`
- Create: `supabase/migrations/8_offline_recovery_state.sql`
- Create: `worker/src/db/supabase-api/offline-recovery-state.test.mjs`
- Regenerate: `worker/src/generated/supabase-migrations.ts`

- [ ] **Step 1: Write the failing migration contract test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../../../supabase/migrations/8_offline_recovery_state.sql', import.meta.url), 'utf8');
const generated = await readFile(new URL('../../generated/supabase-migrations.ts', import.meta.url), 'utf8');

for (const source of [migration, generated]) {
  assert.match(source, /last_notified\s*=\s*case\s+when\s+excluded\.enable\s*=\s*0\s+then\s+null/i);
  assert.match(source, /set\s+last_notified\s*=\s*nullif\(input_time,\s*''\)::timestamptz/i);
  assert.match(source, /revoke all on function public\.cfm_mark_offline_notification_sent\(text, text\) from public/i);
  assert.match(source, /grant execute on function public\.cfm_mark_offline_notification_sent\(text, text\) to service_role/i);
}
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
node worker/src/db/supabase-api/offline-recovery-state.test.mjs
```

Expected: FAIL because migration 8 does not exist.

- [ ] **Step 3: Update the RPC definitions**

In both `4_rpc_api.sql` and migration 8, make the conflict update use:

```sql
    on conflict (client) do update set
      enable = excluded.enable,
      grace_period = excluded.grace_period,
      last_notified = case
        when excluded.enable = 0 then null
        else offline_notifications.last_notified
      end
    where offline_notifications.enable is distinct from excluded.enable
       or offline_notifications.grace_period is distinct from excluded.grace_period
       or (excluded.enable = 0 and offline_notifications.last_notified is not null)
```

Change the marker RPC body to:

```sql
  update offline_notifications
  set last_notified = nullif(input_time, '')::timestamptz
  where client = input_client;
```

Migration 8 must finish with explicit revoke/grant statements for both replaced functions:

```sql
revoke all on function public.cfm_set_offline_notifications(jsonb) from public;
revoke all on function public.cfm_set_offline_notifications(jsonb) from anon;
revoke all on function public.cfm_set_offline_notifications(jsonb) from authenticated;
grant execute on function public.cfm_set_offline_notifications(jsonb) to service_role;

revoke all on function public.cfm_mark_offline_notification_sent(text, text) from public;
revoke all on function public.cfm_mark_offline_notification_sent(text, text) from anon;
revoke all on function public.cfm_mark_offline_notification_sent(text, text) from authenticated;
grant execute on function public.cfm_mark_offline_notification_sent(text, text) to service_role;
```

- [ ] **Step 4: Allow nullable marker values in TypeScript**

Change the Supabase client and query wrapper signatures to:

```ts
export function markOfflineNotificationSent(
  database: QueryDatabase,
  client: string,
  time: string | null,
): Promise<void>
```

and:

```ts
export function markSupabaseOfflineNotificationSent(
  env: SupabaseApiEnv,
  client: string,
  time: string | null,
): Promise<void>
```

Keep the RPC payload `{ input_client: client, input_time: time }`.

- [ ] **Step 5: Regenerate migrations and run the contract test**

Run:

```bash
npm run build:migrations
node worker/src/db/supabase-api/offline-recovery-state.test.mjs
```

Expected: generated migration count is 8 and test exits 0.

### Task 4: Integrate recovery transitions into Cron

**Files:**
- Modify: `worker/src/index.ts:36-42,543-632`

- [ ] **Step 1: Replace the old evaluator with the utility import**

Add:

```ts
import { evaluateOfflineNotificationEvent } from './utils/offline-notification';
```

Add `buildNodeRecoveryNotification` to the notification-template imports, then remove `OfflineNotificationCandidate` and `evaluateOfflineNotificationCandidate` from `index.ts`.

- [ ] **Step 2: Replace the loop decision and delivery branch**

Use:

```ts
    const event = evaluateOfflineNotificationEvent({
      now,
      clientCreatedAt: client.created_at,
      lastTime: latestMap.get(item.client),
      lastNotified: item.last_notified,
      gracePeriodSec: gracePeriod,
      notifyNeverReported,
    });
    if (!event) continue;

    if (event.type === 'offline') {
      const sent = await sendNotification(context, buildOfflineNotification({
        nodeName: client.name || client.uuid,
        offlineMinutes: Math.floor(event.offlineMs / 60000),
        lastSeen: event.lastSeenLabel,
        createdAt: event.createdAt,
        eventTime: now,
      }));
      await db.markOfflineNotificationSent(context.database, item.client, now.toISOString());
      await db.insertAuditLog(context.database, 'system', 'offline_notify', `${sent ? '已发送' : '已记录'}离线告警: ${client.name || client.uuid}${event.neverReported ? ' (从未上报)' : ''}`);
      continue;
    }

    const sent = await sendNotification(context, buildNodeRecoveryNotification({
      nodeName: client.name || client.uuid,
      recoveredAt: event.recoveredAt,
      eventTime: now,
    }));
    await db.markOfflineNotificationSent(context.database, item.client, null);
    await db.insertAuditLog(context.database, 'system', 'online_notify', `${sent ? '已发送' : '已记录'}恢复上线: ${client.name || client.uuid}`);
```

- [ ] **Step 3: Run focused Worker checks**

Run:

```bash
node worker/src/utils/offline-notification.test.mjs
node worker/src/utils/notification-templates.test.mjs
node worker/src/db/supabase-api/offline-recovery-state.test.mjs
npm --prefix worker run lint
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit the recovery notification fix**

```bash
git add worker/src/index.ts worker/src/utils/offline-notification.ts worker/src/utils/offline-notification.test.mjs worker/src/utils/notification-templates.ts worker/src/utils/notification-templates.test.mjs worker/src/db/queries.ts worker/src/db/supabase-api/client.ts worker/src/db/supabase-api/offline-recovery-state.test.mjs supabase/migrations/4_rpc_api.sql supabase/migrations/8_offline_recovery_state.sql worker/src/generated/supabase-migrations.ts
git commit -m "fix: 增加节点恢复上线通知"
```

### Task 5: Full dev verification

**Files:**
- Verify only.

- [ ] **Step 1: Run all focused regressions**

```bash
node frontend/src/components/Flag.test.mjs
node worker/src/utils/offline-notification.test.mjs
node worker/src/utils/notification-templates.test.mjs
node worker/src/db/supabase-api/offline-recovery-state.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 2: Run repository verification through the configured proxy**

```bash
HTTPS_PROXY=http://127.0.0.1:10808 HTTP_PROXY=http://127.0.0.1:10808 ALL_PROXY=socks5://127.0.0.1:10808 npm run verify
HTTPS_PROXY=http://127.0.0.1:10808 HTTP_PROXY=http://127.0.0.1:10808 ALL_PROXY=socks5://127.0.0.1:10808 npm run verify:cloudflare
```

Expected: both commands exit 0; dry-run reports `cf-monitor-test`, eight bundled migrations, and the current dev commit.

- [ ] **Step 3: Confirm unrelated user changes remain untouched**

```bash
git status --short
```

Expected: only the pre-existing unstaged `README.md` modification remains.

