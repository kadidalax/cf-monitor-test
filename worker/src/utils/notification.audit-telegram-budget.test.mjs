import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

for (const expiresBeforeParsing of [true, false]) {
  test(`N06 budget expiry ${expiresBeforeParsing ? 'before' : 'during'} Telegram body parsing defers without consuming delivery and releases the body`, async () => {
    let clock = 0;
    let cancelled = false;
    let completions = 0;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const { load } = createWorkerLoader({ globals: {
      fetch: async () => {
        if (expiresBeforeParsing) clock = 100;
        return new Response(body);
      },
      setTimeout: (callback, delay) => setTimeout(() => { clock += delay; callback(); }, 5),
    } });
    const { ScheduledBudget, ScheduledBudgetExceeded, withScheduledBudget } = load('worker/src/utils/scheduled-budget.ts');
    const { dispatchNotification, deliverNotification } = load('worker/src/utils/notification-dispatch.ts');
    const budget = new ScheduledBudget({ now: () => clock, maxDurationMs: 5100, reserveMs: 5000 });
    await assert.rejects(() => withScheduledBudget(budget, () => deliverNotification({
      claim: async () => ({ claimed: true, delivered: false, token: 'synthetic-claim' }),
      complete: async () => { completions++; return true; },
      send: () => dispatchNotification(undefined, {
        notification_method: 'telegram', telegram_bot_token: '123:synthetic', telegram_chat_id: '1234',
      }, { subject: 'Synthetic', body: 'Synthetic' }),
    })), ScheduledBudgetExceeded);
    assert.equal(completions, 0, 'budget exhaustion must not turn into a completed failure');
    assert.equal(cancelled, true, 'an already opened response must be cancelled on every exit');
    assert.equal(body.locked, false);
  });
}
