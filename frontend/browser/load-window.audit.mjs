import assert from 'node:assert/strict';
import { createHarness, waitForCall, settleCall } from './helpers/harness.mjs';

const moduleFlag = process.argv.indexOf('--playwright-module');
const playwrightModule = moduleFlag >= 0 ? process.argv[moduleFlag + 1] : undefined;
const { origin, check, finish } = await createHarness({ selection: 'N09', playwrightModule });

function configure(data, { minimum = 4, sample = 120, interval = 1, history = true, failure } = {}) {
  data.load = [{ id: 1, name: 'Synthetic load rule', metric: 'cpu', threshold: 80, ratio: 0.8,
    interval_min: interval, effective_interval_min: Math.max(interval, minimum), clients: [], all_clients: true }];
  data.handlers.push(async ({ path, body, request, json }) => {
    if (path === '/api/admin/notification/load/policy') {
      await json(failure === 'invalid' ? {} : failure ? { error: 'Synthetic policy unavailable' } : {
        minimum_interval_min: minimum, sample_interval_sec: sample, history_enabled: history,
      }, failure === 'server' ? 503 : 200);
      return true;
    }
    if (path === '/api/admin/notification/load') { await json(data.load); return true; }
    if (path === '/api/admin/notification/load/1' && request.method() === 'POST') {
      Object.assign(data.load[0], body); await json({ success: true }); return true;
    }
    return false;
  });
}

try {
  await check('N09-minimum-save', 'default minimum is visible and an undersized window cannot be saved', async (page, data) => {
    configure(data);
    await page.goto(origin + '/admin/notifications/load');
    const row = page.getByRole('row').filter({ hasText: 'Synthetic load rule' });
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const interval = dialog.getByRole('spinbutton', { name: /监测间隔|统计窗口/ });
    assert.equal(await interval.getAttribute('min'), '4');
    await interval.fill('1');
    assert.equal(await dialog.getByRole('button', { name: '保存', exact: true }).isEnabled(), false,
      'UI must not submit a window with fewer than two regularly persisted samples');
    assert.match(await dialog.innerText(), /至少.*4.*分钟/);
    assert.equal(data.calls.filter(call => call.method === 'POST' && call.path.includes('/notification/load/')).length, 0);
    await interval.fill('4');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    const saved = await waitForCall(data, call => call.method === 'POST' && call.path === '/api/admin/notification/load/1');
    await settleCall(page, saved);
    assert.equal(saved.body.interval_min, 4);
  });

  await check('N09-effective-window', 'existing rules display the expanded window and repeat interval', async (page, data) => {
    configure(data, { minimum: 12, sample: 360, interval: 4 });
    await page.goto(origin + '/admin/notifications/load');
    const row = page.getByRole('row').filter({ hasText: 'Synthetic load rule' });
    await row.waitFor();
    assert.match(await row.innerText(), /生效 12 分钟/);
    assert.match(await row.innerText(), /原设 4 分钟/);
    assert.match(await page.getByRole('tabpanel').innerText(), /重复通知.*统计窗口/);
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.getByRole('dialog').getByRole('spinbutton', { name: /统计窗口/ }).getAttribute('min'), '12');
  });

  for (const failure of ['server', 'invalid']) {
    await check(`N09-policy-${failure}`, 'unknown cadence disables writes and exposes a retry', async (page, data) => {
      configure(data, { failure });
      await page.goto(origin + '/admin/notifications/load');
      const row = page.getByRole('row').filter({ hasText: 'Synthetic load rule' });
      await row.waitFor();
      assert.equal(await row.getByRole('button', { name: '编辑', exact: true }).isEnabled(), false);
      assert.equal(await page.getByRole('button', { name: '新建规则', exact: true }).first().isEnabled(), false);
      assert.match(await page.getByRole('alert').innerText(), /未知|失败/);
      assert.equal(await page.getByRole('button', { name: /重试/ }).count(), 1);
      assert.equal(data.calls.filter(call => call.method === 'POST' && call.path.includes('/notification/load/')).length, 0);
    });
  }

  await check('N09-disabled-history', 'the page explains why load alerts pause when history is disabled', async (page, data) => {
    configure(data, { history: false });
    await page.goto(origin + '/admin/notifications/load');
    await page.getByRole('row').filter({ hasText: 'Synthetic load rule' }).waitFor();
    assert.match(await page.getByRole('tabpanel').innerText(), /历史记录已关闭.*负载告警已暂停/);
  });
} finally { await finish(); }
