import assert from 'node:assert/strict';
import { createHarness, deferred, deadline, waitForCall, settleCall, settleRender } from './helpers/harness.mjs';
const selection = process.argv[2] || 'ALL';
const moduleFlag = process.argv.indexOf('--playwright-module');
const playwrightModule = moduleFlag >= 0 ? process.argv[moduleFlag + 1] : process.env.CF_MONITOR_PLAYWRIGHT_MODULE;
const { origin, check, finish } = await createHarness({ selection, playwrightModule });
function configure(data) {
  data.clients.push({ ...data.clients[0], uuid: 'node-b', name: 'Beta Server', sort_order: 1 });
  data.websites.push({ ...data.websites[0], id: 2, name: 'Beta website', url: 'https://beta.invalid', sort_order: 2 });
  data.notificationSettings = { notification_method: 'telegram', telegram_chat_id: '', telegram_endpoint: '', webhook_format: 'generic', webhook_url_set: 'false', webhook_secret_set: 'false' };
  data.offline = data.clients.map(x => ({ client: x.uuid, enable: true, grace_period: 777, last_notified: null }));
  data.expiry = data.clients.map(x => ({ client: x.uuid, enable: true, advance_days: 19, last_notified: null }));
  data.load = [{ id: 1, name: 'CPU alarm', metric: 'cpu', threshold: 80, ratio: 0.8, interval_min: 15, effective_interval_min: 15, clients: [], all_clients: true }];
  data.ping = [{id: 1, name: 'Alpha ping', type: 'icmp', target: '1.1.1.1', clients: [], all_clients: true, sort_order: 0}, {id: 2, name: 'Beta ping', type: 'tcp', target: '1.1.1.1:443', clients: ['node-b'], all_clients: false, sort_order: 1}];
  data.pingRecords=[];
  data.themes = [ { short: 'monitor', name: 'Monitor', active: true, configurable: true, deletable: false, builtin: true, config: {}, custom_css: '' }, { short: 'aurora', name: 'Aurora', active: false, configurable: true, deletable: false, builtin: true, config: {}, custom_css: '' } ];
  data.handlers.push(async ({path,request,url,body,json}) => {
    const method = request.method();
    if (path === '/api/admin/settings' && method === 'GET' && url.searchParams.get('scope') === 'notification') { await json(data.notificationSettings); return true; }
    if (path === '/api/admin/notification/offline') { await json(data.offline); return true; }
    if (path === '/api/admin/notification/expiry') { await json(data.expiry); return true; }
    if (path === '/api/admin/notification/load') { await json(data.load); return true; }
    if (path === '/api/admin/notification/load/policy') { await json({ minimum_interval_min: 4, sample_interval_sec: 120, history_enabled: true }); return true; }
    if (path === '/api/admin/notification/offline/edit' || path === '/api/admin/notification/expiry/edit') { const list = path.includes('offline') ? data.offline : data.expiry; for (const update of Array.isArray(body) ? body : [body]) Object.assign(list.find(x=>x.client === update.client), update); await json({success:true}); return true; }
    if (path === '/api/admin/ping') { await json(data.ping); return true; }
    if (path === '/api/task/ping') { await json(data.ping); return true; }
    if (path === '/api/records/ping/batch') { await json({'1':data.pingRecords,'2':[]}); return true; }
    if (path === '/api/admin/ping/edit') { const task = data.ping.find(x=>x.id===body.id); Object.assign(task,body); await json({success:true,task}); return true; }
    if (path === '/api/admin/ping/reorder') { data.ping = body.ids.map(id=>data.ping.find(x=>x.id===id)); await json({success:true}); return true; }
    if (path === '/api/admin/themes') { await json({data: data.themes}); return true; }
    if (path === '/api/admin/logs') { await json({data: [{id: 1,time: new Date().toISOString(),user:'audit-user',action:'login',detail:'Synthetic audit event'}],total:1,has_more:false}); return true; }
    if (path === '/api/setup/database/init') { await json(method === 'GET' ? {ok:true,project_ref:'audit-project',migration_count:1} : {success:true,total:1,applied:1,skipped:0,results:[]}); return true; }
    return false;
  });
}

function configureMetricAvailability(data, { zero = false, offline = false, unknownScope = false, capacity = unknownScope ? undefined : 0.5 } = {}) {
  configure(data);
  data.authenticated = false;
  data.settings.active_theme = 'aurora';
  data.clients = [{ ...data.clients[0], cpu_cores: 64, mem_total: 68719476736, swap_total: 8589934592 }];
  const fields = ['cpu', 'ram', 'ram_total', 'swap', 'swap_total', 'net_in', 'net_out', 'net_total_up', 'net_total_down'];
  const metrics = { ...Object.fromEntries(fields.map(field => [field, zero ? 0 : null])),
    ...(zero ? { ram_total: 1024 } : {}), disk: 1024, disk_total: 4096, load: null, temp: null,
    uptime: 120, process_count: 17, connections: 1, connections_udp: 0,
    ...(capacity === undefined ? {} : { cpu_capacity: capacity }),
    ...(!zero ? { metric_errors: { cpu: unknownScope ? 'container_scope_unavailable' : 'warming_up', ram: 'container_scope_unavailable', swap: 'collection_failed', network: 'collection_failed' } } : {}),
  };
  const savedAt = Date.now() - 1000;
  const row = { uuid: 'node-a', name: data.clients[0].name, lastReportTime: savedAt, ...metrics };
  const snapshot = { online: offline ? [] : ['node-a'], clients: offline ? [] : [row], data: offline ? {} : { 'node-a': metrics },
    last_known: offline ? { 'node-a': row } : {}, timestamp: savedAt, count: offline ? 0 : 1, metadata_version: 'synthetic-metrics-v1' };
  data.handlers.unshift(async ({ path, json }) => {
    if (path === '/api/public/bootstrap') { await json({ clients: data.clients, nodes: data.clients, settings: data.settings, live: snapshot, metadata_version: 'synthetic-metrics-v1' }); return true; }
    if (path === '/api/live/clients') { await json(snapshot); return true; }
    return false;
  });
  return { fields, metrics };
}


try {
  for (const mode of ['unknown', 'zero', 'offline', 'unknown-scope', 'scope-with-capacity']) {
    await check(`AG02-card-${mode}`, 'cards preserve unknown readings, actual zero and the effective CPU capacity', async (page, data) => {
      configureMetricAvailability(data, { zero: mode === 'zero', offline: mode === 'offline', unknownScope: mode === 'unknown-scope' || mode === 'scope-with-capacity',
        ...(mode === 'scope-with-capacity' ? { capacity: 0.5 } : {}) });
      await page.goto(origin + '/');
      const card = page.locator('#node-a');
      await card.waitFor();
      await settleCall(page, await waitForCall(data, call => call.path === '/api/public/bootstrap'));
      const tiles = card.locator('.node-metric-tile');
      assert.equal(await tiles.nth(0).locator('.node-metric-value').innerText(), mode === 'zero' ? '0.0%' : '—');
      assert.equal(await tiles.nth(1).locator('.node-metric-value').innerText(), mode === 'zero' ? '0.0%' : '—');
      if (mode === 'unknown-scope') assert.doesNotMatch(await tiles.nth(0).innerText(), /x64/);
      else assert.match(await tiles.nth(0).innerText(), /x0\.5/, 'AG02: the report CPU allowance must replace the old host core count');
      if (mode !== 'zero') {
        assert.equal(await tiles.nth(1).locator('.node-metric-detail').innerText(), '— / —');
        assert.doesNotMatch(await card.locator('.node-card-tile-layout').innerText(), /\b0(?:\.0+)?\s*B(?:\/s)?/);
      } else {
        assert.match(await card.locator('.node-card-tile-layout').innerText(), /0\s*B\/s/);
      }
    });
  }
  for (const zero of [false, true]) {
    await check(`AG02-summary-${zero ? 'zero' : 'unknown'}`, 'network summary distinguishes unavailable totals from measured zero', async (page, data) => {
      configureMetricAvailability(data, { zero });
      await page.goto(origin + '/');
      await page.locator('#node-a').waitFor();
      await settleCall(page, await waitForCall(data, call => call.path === '/api/public/bootstrap'));
      const text = await page.locator('.monitor-stat-grid').innerText();
      if (zero) assert.match(text, /↑\s*0\s*B/);
      else {
        assert.match(text, /↑\s*—/);
        assert.doesNotMatch(text, /\b0(?:\.0+)?\s*B(?:\/s)?/);
      }
    });
    for (const view of ['table', 'detail']) {
      await check(`AG02-${view}-${zero ? 'zero' : 'unknown'}`, 'expanded resource details use report CPU capacity and preserve unknown or disabled swap', async (page, data) => {
        configureMetricAvailability(data, { zero });
        await page.goto(origin + (view === 'table' ? '/' : '/instance/node-a'));
        await settleCall(page, await waitForCall(data, call => call.path === '/api/public/bootstrap'));
        if (view === 'table') {
          await page.getByRole('button', { name: '表格视图', exact: true }).click();
          await page.getByRole('button', { name: '展开详情', exact: true }).click();
          const details = page.locator('.node-table-expanded');
          await details.waitFor();
          const swap = details.locator('.node-table-detail-row').filter({ has: page.getByText('交换', { exact: true }) });
          assert.match(await swap.innerText(), zero ? /0\s*B/ : /—/, 'AG02: null swap cannot fall back to a host value');
          assert.match(await details.innerText(), /x0\.5/);
        } else {
          const details = page.locator('.DetailsGrid');
          await details.waitFor();
          const swap = details.locator('.DetailsGrid-item').filter({ has: page.getByText('交换空间', { exact: true }) });
          assert.equal(await swap.locator('.DetailsGrid-value').innerText(), zero ? '0 B' : '—');
          assert.match(await details.locator('.DetailsGrid-item').filter({ has: page.getByText('CPU', { exact: true }) }).innerText(), /x0\.5/);
        }
      });
    }
  }
  for (const [tab, keys] of [['CPU', ['cpu']], ['内存', ['ram']], ['网络', ['net_in', 'net_out']]]) {
    await check(`AG02-history-${keys[0]}`, 'history charts retain unavailable intervals between measured zero samples', async (page, data) => {
      const { fields, metrics } = configureMetricAvailability(data);
      const zeros = Object.fromEntries(fields.map(field => [field, 0]));
      const end = Date.now() - 1000;
      data.handlers.unshift(async ({ path, json }) => {
        if (path !== '/api/records/load') return false;
        await json({ data: [0, 1, 2].map(index => ({ ...metrics, ...(index === 1 ? {} : { ...zeros, ram_total: 1024 }),
          time: new Date(end - (2 - index) * 60000).toISOString(), id: String(index + 1) })), has_more: false });
        return true;
      });
      await page.goto(origin + '/instance/node-a');
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const panel = page.locator('.rt-Card').filter({ has: page.getByText('监控图表 · 最近1小时', { exact: true }) });
      await panel.locator('.recharts-wrapper').waitFor();
      const rendered = await panel.locator('.recharts-wrapper').evaluate(element => {
        let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
        while (fiber) {
          if (fiber.stateNode?.state?.xAxisMap) return { rows: fiber.stateNode.props.data,
            connectNulls: [].concat(fiber.stateNode.props.children).filter(Boolean).some(child => child.props?.connectNulls === true) };
          fiber = fiber.return;
        }
        throw new Error('Fixture could not inspect rendered history data');
      });
      assert.equal(rendered.rows.length, 3, 'AG02: a single unavailable field must not erase the history interval');
      for (const key of keys) assert.deepEqual(rendered.rows.map(row => row[key]), [0, null, 0]);
      assert.equal(rendered.connectNulls, false);
    });
  }
  for (const tab of ['offline', 'expiry']) {
    for (const failure of ['server', 'network', 'invalid']) {
      await check(`F01-${tab}-${failure}`, 'unknown notification settings cannot be written, retry restores saved timing', async (page, data) => {
        configure(data);
        let failing = true;
        data.handlers.unshift(async ({ path, route, json }) => {
          if (!failing || path !== `/api/admin/notification/${tab}`) return false;
          if (failure === 'network') await route.abort('internetdisconnected');
          else await json(failure === 'invalid' ? { data: 'broken' } : { error: 'Synthetic notification read failure' }, failure === 'invalid' ? 200 : 500);
          return true;
        });
        await page.goto(origin + `/admin/notifications/${tab}`);
        const row = page.getByRole('row').filter({ hasText: 'Alpha Server' });
        const toggle = row.getByRole('switch');
        await toggle.waitFor();
        assert.equal(await toggle.isEnabled(), false, 'F01: a failed or malformed read must not unlock a write based on defaults');
        assert.equal(await row.getByRole('button', { name: '编辑', exact: true }).isEnabled(), false);
        assert.match(await row.innerText(), /未知/, 'F01: a failed read is an unknown state, not disabled notification');
        assert.ok(await page.getByRole('alert').count() > 0, 'F01: the read error must remain visible');
        assert.equal(data.calls.filter(call => call.path.endsWith(`/${tab}/edit`)).length, 0);
        failing = false;
        await page.getByRole('button', { name: /重试/ }).click();
        await page.waitForFunction(() => document.querySelector('button[role="switch"]')?.disabled === false);
        assert.match(await row.innerText(), tab === 'offline' ? /777/ : /19/);
        assert.equal(await toggle.getAttribute('aria-checked'), 'true');
        await toggle.click();
        await settleCall(page, await waitForCall(data, call => call.path.endsWith(`/${tab}/edit`)));
        const saved = (tab === 'offline' ? data.offline : data.expiry)[0];
        assert.equal(saved.enable, false);
        assert.equal(saved[tab === 'offline' ? 'grace_period' : 'advance_days'], tab === 'offline' ? 777 : 19, 'F01: toggling preserves the confirmed timing');
      });
    }
  }
  for (const failedId of [1, 2]) {
    await check(`F02-partial-${failedId}`, 'partial website changes update successful items and retry only failures', async (page, data) => {
      configure(data);
      let failing = true;
      data.handlers.unshift(async ({ path, body, json }) => {
        if (!failing || path !== '/api/admin/websites/visibility' || body.id !== failedId) return false;
        await json({ error: 'Synthetic single-item failure' }, 500);
        return true;
      });
      await page.goto(origin + '/admin/websites');
      await page.getByText('Synthetic website', { exact: true }).waitFor();
      await page.evaluate(() => {
        window.auditWebsiteMessages = [];
        window.auditWebsiteChannel = new BroadcastChannel('cf-monitor:website-monitors-updated');
        window.auditWebsiteChannel.onmessage = event => window.auditWebsiteMessages.push(event.data);
      });
      await page.getByRole('checkbox').first().click();
      await page.locator('.admin-selection-inline').getByRole('button', { name: '隐藏', exact: true }).click();
      for (const id of [1, 2]) await settleCall(page, await waitForCall(data, call => call.path === '/api/admin/websites/visibility' && call.body?.id === id));
      const successfulName = failedId === 1 ? 'Beta website' : 'Synthetic website';
      const failedName = failedId === 1 ? 'Synthetic website' : 'Beta website';
      const successRow = page.getByRole('row').filter({ hasText: successfulName });
      const failedRow = page.getByRole('row').filter({ hasText: failedName });
      assert.match(await successRow.locator('.admin-website-visibility-cell').innerText(), /对游客隐藏/, 'F02: the successful server mutation must be reflected even when another target fails');
      assert.equal(await successRow.getByRole('checkbox').getAttribute('aria-checked'), 'false');
      assert.equal(await failedRow.getByRole('checkbox').getAttribute('aria-checked'), 'true');
      assert.match(await page.locator('body').innerText(), /成功 1.*失败 1/, 'F02: partial success needs an explicit outcome');
      await page.waitForFunction(() => window.auditWebsiteMessages.length > 0);
      const previous = data.calls.length;
      failing = false;
      await page.locator('.admin-selection-inline').getByRole('button', { name: '隐藏', exact: true }).click();
      await settleCall(page, await waitForCall(data, call => call.path === '/api/admin/websites/visibility', previous));
      assert.deepEqual(data.calls.slice(previous).filter(call => call.path === '/api/admin/websites/visibility').map(call => call.body.id), [failedId]);
      assert.ok(data.websites.every(item => item.hidden), 'F02: retry completes the remaining target');
    });
  }
  for (const failure of ['server', 'network', 'invalid']) {
    await check(`F03-mfa-${failure}`, 'failed MFA reads remain unknown and retry reveals the enabled state', async (page, data) => {
      configure(data);
      data.mfa = { enabled: true, enabled_at: '2026-09-01T00:00:00Z', recovery_codes_remaining: 5 };
      let failing = true;
      data.handlers.unshift(async ({ path, route, json }) => {
        if (!failing || path !== '/api/admin/account/mfa') return false;
        if (failure === 'network') await route.abort('internetdisconnected');
        else await json(failure === 'invalid' ? {} : { error: 'Synthetic status read failure' }, failure === 'invalid' ? 200 : 500);
        return true;
      });
      await page.goto(origin + '/admin/account');
      await page.getByRole('tab', { name: '身份验证' }).click();
      await settleCall(page, await waitForCall(data, call => call.path === '/api/admin/account/mfa'));
      const panel = page.locator('.admin-account-security-card');
      assert.doesNotMatch(await panel.innerText(), /未启用|正在读取状态/, 'F03: failed or malformed status cannot report disabled or keep loading forever');
      assert.match(await panel.innerText(), /未知/);
      assert.ok(await panel.getByRole('alert').count() > 0);
      failing = false;
      await panel.getByRole('button', { name: /重试/ }).click();
      await panel.getByText('已启用', { exact: true }).waitFor();
      assert.match(await panel.innerText(), /5 个/);
      assert.equal(await panel.getByRole('alert').count(), 0);
    });
  }
  const editors = [
    { kind: 'website', route: '/admin/websites', path: '/api/admin/websites/edit' },
    { kind: 'node', route: '/admin', path: '/api/admin/clients/node-a/edit' },
    { kind: 'ping', route: '/admin/ping', path: '/api/admin/ping/edit' },
    { kind: 'offline', route: '/admin/notifications/offline', path: '/api/admin/notification/offline/edit', numeric: true },
    { kind: 'expiry', route: '/admin/notifications/expiry', path: '/api/admin/notification/expiry/edit', numeric: true },
    { kind: 'load', route: '/admin/notifications/load', path: '/api/admin/notification/load/1' },
    { kind: 'offline-batch', route: '/admin/notifications/offline', path: '/api/admin/notification/offline/edit', numeric: true, batch: true },
    { kind: 'expiry-batch', route: '/admin/notifications/expiry', path: '/api/admin/notification/expiry/edit', numeric: true, batch: true },
  ];
  for (const editor of editors) {
    for (const reopenIndex of editor.batch ? [0] : [0, 1]) {
      for (const failed of editor.kind === 'website' ? [false, true] : [false]) {
        await check(`F04-${editor.kind}-${reopenIndex}-${failed ? 'failure' : 'success'}`, 'late saves belong to the editor that submitted them', async (page, data) => {
          configure(data);
          data.load.push({ ...data.load[0], id: 2, name: 'Second alarm' });
          const gate = deferred();
          data.handlers.unshift(async ({ path, body, json }) => {
            if (path !== editor.path) return false;
            await gate.promise;
            if (failed) { await json({ error: 'Synthetic delayed save failure' }, 500); return true; }
            if (editor.kind === 'website') { Object.assign(data.websites[0], body); await json({ success: true, monitor: data.websites[0] }); }
            else if (editor.kind === 'node') { Object.assign(data.clients[0], body); await json({ success: true, client: data.clients[0] }); }
            else if (editor.kind === 'ping') { Object.assign(data.ping[0], body); await json({ success: true, task: data.ping[0] }); }
            else if (editor.kind === 'load') { Object.assign(data.load[0], body); await json({ success: true }); }
            else { const list = editor.kind.startsWith('offline') ? data.offline : data.expiry; for (const item of Array.isArray(body) ? body : [body]) Object.assign(list.find(row => row.client === item.client), item); await json({ success: true }); }
            return true;
          });
          await page.goto(origin + editor.route);
          if (editor.batch) {
            await page.getByRole('checkbox').first().click();
            await page.getByRole('button', { name: /批量编辑/ }).click();
          } else await page.getByRole('button', { name: '编辑', exact: true }).first().click();
          const dialog = page.getByRole('dialog');
          const input = editor.numeric ? dialog.getByRole('spinbutton').first() : dialog.getByLabel(editor.kind === 'load' ? '规则名称' : '名称', { exact: true });
          await input.fill(editor.numeric ? '40' : 'Saved original');
          await dialog.getByRole('button', { name: /^保存/ }).click();
          const saveCall = await waitForCall(data, call => call.path === editor.path);
          await dialog.getByRole('button', { name: '取消', exact: true }).click();
          if (editor.batch) await page.getByRole('button', { name: /批量编辑/ }).click();
          else await page.getByRole('button', { name: '编辑', exact: true }).nth(reopenIndex).click();
          const draft = editor.numeric ? '70' : 'Unsaved new draft';
          await input.fill(draft);
          gate.resolve();
          await settleCall(page, saveCall);
          assert.equal(await dialog.isVisible(), true, 'F04: an old save cannot close a newer editor, including the same object reopened');
          assert.equal(await input.inputValue(), draft, 'F04: a newer draft survives the old result');
        });
      }
    }
  }
  for (const change of ['rename', 'hide', 'delete', 'restore', 'server-failure', 'invalid-failure']) {
    await check(`F05-details-${change}`, 'open details follow authorized metadata updates and retain data on failed reads', async (page, data, context) => {
      configure(data); data.authenticated = false;
      let failReads = false;
      data.handlers.unshift(async ({ path, json }) => {
        if (!failReads || !['/api/nodes', '/api/clients', '/api/public/bootstrap'].includes(path)) return false;
        await json(change === 'invalid-failure' ? { nodes: 'invalid', clients: 'invalid' } : { error: 'Synthetic metadata failure' }, change === 'invalid-failure' ? 200 : 500);
        return true;
      });
      await page.goto(origin + '/instance/node-a');
      const heading = page.getByRole('heading', { name: 'Alpha Server', exact: true });
      await heading.waitFor();
      await page.evaluate(async () => {
        window.auditMetadataReceived = false;
        const { subscribePublicDataUpdated } = await import('/src/utils/publicDataEvents.ts');
        subscribePublicDataUpdated(() => { window.auditMetadataReceived = true; });
      });
      const publisher = await context.newPage();
      await publisher.goto(origin + '/login');
      if (change === 'hide') data.clients[0].hidden = true;
      else if (change === 'delete') data.clients = data.clients.slice(1);
      else if (change === 'rename' || change === 'restore') {
        data.clients[0].name = 'Updated Alpha'; data.clients[0].public_remark = 'Updated public details';
        if (change === 'restore') data.clients[1].name = 'Restored Beta';
      } else failReads = true;
      await publisher.evaluate(async () => {
        const { notifyPublicDataUpdated } = await import('/src/utils/publicDataEvents.ts');
        notifyPublicDataUpdated({ force: true });
      });
      await page.waitForFunction(() => window.auditMetadataReceived === true);
      if (change === 'hide' || change === 'delete') {
        await page.waitForFunction(() => document.body.textContent.includes('服务器不存在'), null, { timeout: 2500 }).catch(() => {});
        assert.equal(await heading.count(), 0, 'F05: a confirmed hidden/deleted node must be removed from an already-open public detail');
        assert.match(await page.locator('body').innerText(), /服务器不存在/);
      } else if (change.endsWith('failure')) {
        await page.waitForFunction(() => document.querySelector('[role="alert"]') !== null, null, { timeout: 2500 }).catch(() => {});
        assert.equal(await heading.isVisible(), true, 'F05: failed refreshes keep the confirmed node');
        assert.ok(await page.getByRole('alert').count() > 0, 'F05: a failed metadata refresh exposes a persistent retryable error');
        assert.doesNotMatch(await page.locator('body').innerText(), /服务器不存在/);
        failReads = false; data.clients[0].name = 'Recovered Alpha';
        await page.getByRole('button', { name: /重试/ }).click();
        await page.getByRole('heading', { name: 'Recovered Alpha', exact: true }).waitFor();
      } else {
        await page.waitForFunction(() => document.querySelector('.instance-top-summary')?.textContent.includes('Updated Alpha'), null, { timeout: 2500 }).catch(() => {});
        assert.equal(await page.getByRole('heading', { name: 'Updated Alpha', exact: true }).count(), 1, 'F05: already-open details must use newly confirmed metadata');
        assert.match(await page.locator('body').innerText(), /Updated public details/);
        if (change === 'restore') assert.match(await page.locator('body').innerText(), /Restored Beta/);
      }
    });
  }
  for (const scope of ['general', 'notification']) {
    for (const failed of [false, true]) {
      await check(`F07-${scope}-${failed ? 'failure' : 'success'}`, 'save acknowledgements preserve input typed after submission', async (page, data) => {
        configure(data);
        data.notificationSettings.notification_method = 'email';
        data.notificationSettings.email_smtp_host = 'original.smtp.invalid';
        const gate = deferred();
        let rejectSave = failed;
        data.handlers.unshift(async ({ path, request, body, json }) => {
          if (path !== '/api/admin/settings' || request.method() !== 'POST') return false;
          await gate.promise;
          if (rejectSave) { await json({ error: 'Synthetic delayed save failure' }, 500); return true; }
          Object.assign(scope === 'general' ? data.general : data.notificationSettings, body);
          await json({ success: true }); return true;
        });
        await page.goto(origin + (scope === 'general' ? '/admin/settings/general' : '/admin/notifications/settings'));
        const input = page.getByLabel(scope === 'general' ? '每日预计观看时长（分钟）' : 'SMTP Host', { exact: true });
        const saveName = scope === 'general' ? '保存' : '保存设置';
        const firstValue = scope === 'general' ? '40' : 'submitted.smtp.invalid';
        const nextValue = scope === 'general' ? '70' : 'new-draft.smtp.invalid';
        const key = scope === 'general' ? 'capacity_daily_view_minutes' : 'email_smtp_host';
        await input.fill(firstValue);
        await page.getByRole('button', { name: saveName, exact: true }).click();
        const first = await waitForCall(data, call => call.path === '/api/admin/settings' && call.method === 'POST');
        assert.equal(first.body[key], firstValue);
        await input.fill(nextValue);
        gate.resolve(); await settleCall(page, first);
        await page.waitForFunction(name => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === name && !button.disabled), saveName);
        assert.equal(await input.inputValue(), nextValue, 'F07: an earlier save must not overwrite a newer draft');
        rejectSave = false;
        const previous = data.calls.length;
        await page.getByRole('button', { name: saveName, exact: true }).click();
        const second = await waitForCall(data, call => call.path === '/api/admin/settings' && call.method === 'POST', previous);
        assert.equal(second.body[key], nextValue, 'F07: the next save commits the preserved draft');
        await settleCall(page, second);
      });
    }
  }
  for (const action of ['username', 'logo', 'theme', 'recovery']) {
    for (const response of ['html', 'empty', 'missing', ...(action === 'username' ? ['valid'] : [])]) {
      await check(`F08-${action}-${response}`, 'unconfirmed write responses never produce a success acknowledgement', async (page, data) => {
        configure(data); data.settings.site_logo_url = '/fixture-old-logo.png';
        data.mfa = { enabled: true, enabled_at: '2026-09-01T00:00:00Z', recovery_codes_remaining: 5 };
        const path = action === 'username' ? '/api/admin/account/username' : action === 'logo' ? '/api/admin/site-logo/reset' : action === 'theme' ? '/api/admin/themes/set' : '/api/admin/account/mfa/recovery-codes';
        data.handlers.unshift(async ({ path: currentPath, route, json }) => {
          if (path !== currentPath) return false;
          if (response === 'html' || response === 'empty') await route.fulfill({ status: 200, contentType: 'text/html', body: response === 'empty' ? '' : '<html>Unexpected proxy page</html>' });
          else await json(response === 'valid' ? { success: true, user: { uuid: 'synthetic-admin', username: 'Synthetic changed name' } } : {});
          return true;
        });
        await page.goto(origin + (action === 'logo' ? '/admin/settings/site' : action === 'theme' ? '/admin/themes' : '/admin/account'));
        let beforeTheme;
        if (action === 'username') {
          await page.getByLabel('用户名', { exact: true }).fill('Synthetic changed name');
          await page.getByRole('button', { name: '修改用户名', exact: true }).click();
        } else if (action === 'logo') await page.getByRole('button', { name: '恢复默认', exact: true }).click();
        else if (action === 'theme') {
          beforeTheme = await page.locator('html').getAttribute('data-monitor-theme');
          await page.getByRole('button', { name: '启用', exact: true }).nth(1).click();
        } else {
          await page.getByRole('tab', { name: '身份验证' }).click();
          await page.getByRole('button', { name: '重新生成恢复码', exact: true }).click();
        }
        await settleCall(page, await waitForCall(data, call => call.path === path));
        const success = /用户名修改成功|已恢复默认 Logo|主题已启用|恢复码已重新生成/;
        if (response === 'valid') assert.match(await page.locator('body').innerText(), success);
        else {
          assert.doesNotMatch(await page.locator('body').innerText(), success, 'F08: malformed or incomplete responses cannot confirm a write');
          assert.match(await page.locator('body').innerText(), /无法确认|响应.*异常|响应.*无效/);
          if (action === 'username') assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('cf_monitor_user') || '{}').username === 'Synthetic changed name'), false);
          if (action === 'logo') assert.equal(await page.locator('.site-logo-preview img').getAttribute('src'), '/fixture-old-logo.png');
          if (action === 'theme') assert.equal(await page.locator('html').getAttribute('data-monitor-theme'), beforeTheme);
        }
      });
    }
  }
  for (const tab of ['offline', 'expiry']) {
    await check(`F09-${tab}`, 'notification controls have unique accessible names and target-specific keyboard actions', async (page, data, context) => {
      configure(data);
      await page.goto(origin + `/admin/notifications/${tab}`);
      await page.getByRole('row').filter({ hasText: 'Alpha Server' }).getByRole('switch').waitFor();
      const cdp = await context.newCDPSession(page);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const names = nodes.filter(node => !node.ignored && ['checkbox', 'switch'].includes(node.role?.value)).map(node => node.name?.value || '');
      assert.equal(names.length, 5, 'F09 fixture has two switches, two row selectors and one select-all');
      assert.ok(names.every(name => name.trim().length > 0), 'F09: each actionable control requires a name in the actual accessibility tree');
      assert.equal(new Set(names).size, names.length, 'F09: names distinguish the action and target');
      const toggle = page.getByRole('switch', { name: /Alpha Server/ });
      await toggle.focus(); await page.keyboard.press('Space');
      await settleCall(page, await waitForCall(data, call => call.path === `/api/admin/notification/${tab}/edit`));
      const values = tab === 'offline' ? data.offline : data.expiry;
      assert.equal(values[0].enable, false);
      assert.equal(values[1].enable, true);
      const select = page.getByRole('checkbox', { name: /Alpha Server/ });
      await select.focus(); await page.keyboard.press('Space');
      assert.equal(await select.getAttribute('aria-checked'), 'true');
      assert.equal(await page.getByRole('checkbox', { name: /Beta Server/ }).getAttribute('aria-checked'), 'false');
    });
  }
  for (const bytes of [1288490188800, 1099511627775, 1234567, 1073741824]) {
    await check(`F10-name-only-${bytes}`, 'renaming a server never changes its traffic allowance', async (page, data) => {
      configure(data); data.clients[0].traffic_limit = bytes;
      await page.goto(origin + '/admin');
      await page.getByRole('button', { name: '编辑', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      assert.equal(await dialog.locator('.traffic-limit-number-input input').evaluate(input => input.checkValidity()), true, 'F10: the exact stored quota must remain a valid browser number input');
      await dialog.getByLabel('名称', { exact: true }).fill('Renamed synthetic server');
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      const saved = await waitForCall(data, call => call.path === '/api/admin/clients/node-a/edit');
      assert.equal(saved.body.traffic_limit, bytes, 'F10: displaying an allowance must not round the value sent when only the name changes');
      await settleCall(page, saved);
      assert.equal(data.clients[0].traffic_limit, bytes);
    });
  }
  for (const view of ['instance', 'popup']) {
    for (const scenario of ['isolated', 'mixed', 'timeouts', 'success', 'unaligned']) {
      await check(`F11-${view}-${scenario}`, 'Ping charts preserve timeout gaps and distinguish sampling offsets', async (page, data) => {
        configure(data);
        const values = { isolated: [20, -1, 40], mixed: [20, 21, -1, 40, 41], timeouts: [-1, -1, -1], success: [20, 30, 40], unaligned: [20, 30, 40] }[scenario];
        const start = Date.now() - 12 * 60000;
        data.pingRecords = values.map((value, index) => ({ time: new Date(start + index * 120000).toISOString(), value }));
        if (scenario === 'unaligned') {
          data.ping[1].all_clients = true;
          data.handlers.unshift(async ({ path, json }) => {
            if (path !== '/api/records/ping/batch') return false;
            await json({ '1': data.pingRecords, '2': [60, 70, 80].map((value, index) => ({ time: new Date(start + 60000 + index * 120000).toISOString(), value })) });
            return true;
          });
        }
        await page.goto(origin + (view === 'instance' ? '/instance/node-a' : '/'));
        if (view === 'instance') await page.getByText('Ping 延迟', { exact: true }).scrollIntoViewIfNeeded();
        else await page.getByRole('button', { name: '查看 Ping 延迟', exact: true }).first().click();
        const chart = view === 'instance' ? page.locator('.rt-Card').filter({ has: page.getByText('Ping 延迟', { exact: true }) }) : page.locator('.mini-ping-chart');
        const legend = chart.locator(view === 'instance' ? '.instance-ping-series-grid' : '.mini-ping-chart-legend');
        await legend.getByText('Alpha ping', { exact: true }).waitFor();
        await settleRender(page);
        const lines = chart.locator('.recharts-line');
        const alpha = lines.first();
        const path = await alpha.locator('.recharts-line-curve').getAttribute('d').catch(() => '');
        const segmentCount = (path?.match(/M/g) || []).length;
        assert.equal(segmentCount, scenario === 'timeouts' ? 0 : ['isolated', 'mixed'].includes(scenario) ? 2 : 1, 'F11: true timeouts split a curve, while another task sampling later does not');
        assert.equal(await alpha.locator('.recharts-line-dot').count(), values.filter(value => value >= 0).length, 'F11: isolated successful samples remain visible');
        assert.match(await legend.innerText(), new RegExp(`超时 ${values.filter(value => value < 0).length} / ${values.length}`), 'F11: failures remain visible beside the average of successful samples');
        if (scenario === 'timeouts') assert.match(await legend.innerText(), /全部超时/);
        if (scenario === 'unaligned') {
          assert.equal((await lines.nth(1).locator('.recharts-line-curve').getAttribute('d')).match(/M/g).length, 1);
          await alpha.locator('.recharts-line-dot').last().hover();
          const tooltip = chart.locator('.recharts-tooltip-wrapper');
          await tooltip.waitFor({ state: 'visible' });
          assert.match(await tooltip.innerText(), /Alpha ping.*40 ms/s, 'F11: per-task data still matches the hovered timestamp');
          assert.doesNotMatch(await tooltip.innerText(), /Beta ping/, 'F11: an offset task must not borrow the selected array index as its timestamp');
        }
      });
    }
  }
  for (const displayTheme of ['monitor', 'aurora']) {
    for (const mode of ['light', 'dark', 'system']) {
      await check(`F12-${displayTheme}-${mode}`, 'theme previews share real appearance, colors and ongoing system changes', async (page, data, context) => {
        configure(data);
        await page.addInitScript(({ displayTheme, mode }) => {
          localStorage.setItem('cf-monitor-display-theme', displayTheme);
          localStorage.setItem('cf-monitor-display-theme-source', 'local');
          localStorage.setItem('cf-monitor-theme', mode);
        }, { displayTheme, mode });
        await page.emulateMedia({ colorScheme: 'light' });
        data.themes[0].custom_css = 'body { --audit-preview-only: present; }';
        await page.goto(origin + '/admin/themes');
        await page.getByRole('button', { name: '配置', exact: true }).first().click();
        await page.getByRole('button', { name: '预览', exact: true }).click();
        const iframe = page.locator('iframe[title="前台主题预览"]');
        const frame = await (await iframe.elementHandle()).contentFrame();
        await frame.locator('.node-card').first().waitFor();
        assert.equal(await frame.locator('html').getAttribute('data-monitor-theme'), displayTheme, 'F12: the real display theme marker must reach the preview document');
        assert.equal(await frame.locator('html').getAttribute('data-theme-appearance'), mode === 'system' ? null : mode);
        const appearance = mode === 'dark' ? 'dark' : 'light';
        assert.equal(await frame.locator(`.radix-themes.${appearance}`).count(), 1, 'F12: the preview Radix root has an explicit matching appearance');
        assert.equal(await frame.locator('.radix-themes').getAttribute('data-accent-color'), displayTheme === 'aurora' ? 'purple' : 'violet');
        const publicPage = await context.newPage();
        await publicPage.addInitScript(({ displayTheme, mode }) => {
          localStorage.setItem('cf-monitor-display-theme', displayTheme);
          localStorage.setItem('cf-monitor-display-theme-source', 'local');
          localStorage.setItem('cf-monitor-theme', mode);
        }, { displayTheme, mode });
        await publicPage.emulateMedia({ colorScheme: 'light' });
        await publicPage.goto(origin + '/');
        await publicPage.locator('.node-card').first().waitFor();
        const colors = element => {
          const style = getComputedStyle(element);
          return [style.color, style.backgroundColor, style.borderColor, style.getPropertyValue('--accent-9').trim()];
        };
        assert.deepEqual(await frame.locator('.node-card').first().evaluate(colors), await publicPage.locator('.node-card').first().evaluate(colors), 'F12: preview colors match the real public card');
        assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--audit-preview-only').trim()), '');
        assert.equal(await frame.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--audit-preview-only').trim()), 'present');
        if (mode === 'system') {
          await page.emulateMedia({ colorScheme: 'dark' });
          await publicPage.emulateMedia({ colorScheme: 'dark' });
          await frame.locator('.radix-themes.dark').waitFor();
          await publicPage.locator('html.dark').waitFor();
          assert.match(await frame.locator('html').getAttribute('class'), /dark/);
          assert.equal(await frame.locator('html').getAttribute('data-theme-appearance'), null);
          const cards = [frame.locator('.node-card').first(), publicPage.locator('.node-card').first()];
          data.observed.systemThemeTransitions = await Promise.all(cards.map(card => card.evaluate(element => ({
            borderColor: getComputedStyle(element).borderColor,
            animations: element.getAnimations().map(animation => ({
              property: animation.transitionProperty, playState: animation.playState,
              currentTime: animation.currentTime, duration: animation.effect?.getTiming().duration,
            })),
          }))));
          // Independent documents start their 180 ms CSS transitions on different frames.
          await deadline(Promise.all(cards.map(card => card.evaluate(async element => {
            await Promise.all(element.getAnimations().map(animation => animation.finished));
          }))), 'F12 theme border transitions');
          assert.deepEqual(await frame.locator('.node-card').first().evaluate(colors), await publicPage.locator('.node-card').first().evaluate(colors), 'F12: the existing iframe follows system appearance without reopening');
        }
        assert.equal(await iframe.getAttribute('sandbox'), 'allow-same-origin');
      });
    }
  }
  for (const [view, range, hours] of [['instance', '1小时', 1], ['instance', '4小时', 4], ['instance', '24小时', 24], ['instance', '3天', 72], ['popup', '', 4]]) {
    for (const scenario of ['old', 'future', 'valid']) {
      await check(`F13-${view}-${hours}-${scenario}`, 'recent Ping windows use the query clock and show genuinely empty ranges', async (page, data) => {
        configure(data);
        data.handlers.unshift(async ({ path, url, json }) => {
          if (path !== '/api/records/ping/batch') return false;
          const end = Date.parse(url.searchParams.get('cursor'));
          data.observed.queryEnd = end;
          const at = scenario === 'old' ? end - hours * 3600000 - 60000 : scenario === 'future' ? end + 60000 : end - hours * 1800000;
          await json({ 1: [{ time: new Date(at).toISOString(), value: 20 }] });
          return true;
        });
        await page.goto(origin + (view === 'instance' ? '/instance/node-a' : '/'));
        if (view === 'instance') {
          if (hours !== 1) await page.getByRole('radio').filter({ has: page.getByText(range, { exact: true }) }).click();
          await page.getByText('Ping 延迟', { exact: true }).scrollIntoViewIfNeeded();
        } else await page.getByRole('button', { name: '查看 Ping 延迟', exact: true }).first().click();
        await settleCall(page, await waitForCall(data, call => call.path === '/api/records/ping/batch'));
        const chart = view === 'instance' ? page.locator('.rt-Card').filter({ has: page.getByText('Ping 延迟', { exact: true }) }) : page.getByRole('dialog');
        if (scenario !== 'valid') {
          assert.match(await chart.innerText(), /暂无该节点的 Ping 记录/, 'F13: out-of-window samples do not masquerade as recent data');
          assert.equal(await chart.locator('.recharts-line-dot').count(), 0);
        } else {
          await chart.locator('.recharts-line-dot').waitFor();
          const domain = await chart.locator('.recharts-wrapper').evaluate(element => {
            let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
            while (fiber) {
              const axis = fiber.stateNode?.state?.xAxisMap?.[0];
              if (axis) return axis.domain;
              fiber = fiber.return;
            }
            throw new Error('Fixture could not inspect the rendered Recharts axis');
          });
          assert.deepEqual(domain, [data.observed.queryEnd - hours * 3600000, data.observed.queryEnd], 'F13: the actual rendered axis ends at the captured query time');
        }
      });
    }
  }
  for (const kind of ['load', 'gpu']) {
    await check(`D02-${kind}`, 'history charts retain same-time snapshots and forward the opaque continuation', async (page, data) => {
      configure(data);
      if (kind === 'gpu') data.clients[0].gpu_name = 'Synthetic GPU';
      const cursors = [];
      let expectedKey;
      data.handlers.unshift(async ({ path, url, json }) => {
        if (path !== `/api/records/${kind}`) return false;
        const initial = url.searchParams.get('cursor') === url.searchParams.get('end');
        const time = new Date(Date.parse(url.searchParams.get('end')) - 300000).toISOString().slice(0, 19) + '.123456Z';
        cursors.push(url.searchParams.get('cursor'));
        expectedKey = `v1|${time}|9007199254740993|${kind === 'gpu' ? 1 : 0}`;
        const records = kind === 'gpu'
          ? [2, 1].map((ordinal, index) => ({ time, id: initial ? '9007199254740993' : '9007199254740992', device_index: 0, device_ordinal: ordinal, utilization: (initial ? 30 : 10) + index, mem_total: 100, mem_used: 10, temperature: 40 }))
          : [0, 1].map((index) => ({ time, id: String((initial ? 9007199254740994n : 9007199254740992n) - BigInt(index)), cpu: (initial ? 30 : 10) + index }));
        await json({ data: records, has_more: initial, next_cursor: time, next_cursor_key: expectedKey });
        return true;
      });
      await page.goto(origin + '/instance/node-a');
      if (kind === 'gpu') await page.getByRole('tab', { name: 'GPU', exact: true }).click();
      await settleCall(page, await waitForCall(data, call => call.path === `/api/records/${kind}` && new URLSearchParams(call.search).get('cursor')?.startsWith('v1|')));
      const panel = page.locator('.rt-Card').filter({ has: page.getByText('监控图表 · 最近1小时', { exact: true }) });
      await panel.locator('.recharts-wrapper').waitFor();
      const rows = await panel.locator('.recharts-wrapper').evaluate(element => {
        let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
        while (fiber) {
          if (fiber.stateNode?.state?.xAxisMap) return fiber.stateNode.props.data;
          fiber = fiber.return;
        }
        throw new Error('Fixture could not inspect rendered history data');
      });
      assert.equal(rows.length, 4, 'D02: all same-time device or snapshot rows reach the real chart');
      const continuations = cursors.filter(cursor => cursor.startsWith('v1|'));
      assert.ok(continuations.length > 0);
      assert.ok(continuations.every(cursor => cursor === expectedKey), 'D02: the frontend must forward the original key including microseconds and bigint ID');
    });
  }
  for (const flow of ['account', 'create', 'recover']) {
    for (const scenario of ['guidance', 'short', 'short-unicode', 'allowed', 'allowed-unicode', 'server-rejection']) {
      await check(`SEC01-${flow}-${scenario}`, 'new credentials share a fifteen-character minimum without weakening server errors', async (page, data) => {
        configure(data);
        data.authenticated = flow === 'account';
        const mutation = flow === 'account' ? '/api/admin/account/chpasswd' : '/api/admin/recovery';
        data.handlers.unshift(async ({ path, json }) => {
          if (path === '/api/admin/recovery/status') { await json({ admin_present: flow !== 'create', recoverable: true }); return true; }
          if (path !== mutation) return false;
          await json(scenario === 'server-rejection' ? { error: '服务器拒绝：请避开常见弱密码' } : { success: true, mode: flow === 'create' ? 'created' : 'reset' }, scenario === 'server-rejection' ? 400 : 200);
          return true;
        });
        await page.goto(origin + (flow === 'account' ? '/admin/account' : '/login'));
        if (flow === 'account') await page.getByRole('tab', { name: '更改密码', exact: true }).click();
        else if (flow === 'recover') await page.getByRole('button', { name: '忘记密码', exact: true }).click();
        const input = page.getByLabel('新密码', { exact: true });
        await input.waitFor();
        if (scenario === 'guidance') {
          assert.match(await page.locator('body').innerText(), /至少\s*15\s*个字符/, 'SEC01: show the creation policy before submission');
          return;
        }
        const short = scenario.startsWith('short');
        const value = Array.from({ length: short ? 14 : 15 }, (_, index) => String.fromCodePoint((scenario.includes('unicode') ? 0x1f300 : 65) + index)).join('');
        if (flow === 'account') {
          await page.getByLabel('旧密码', { exact: true }).fill('x'.repeat(6));
          await input.fill(value);
          await page.getByLabel('确认新密码', { exact: true }).fill(value);
        } else {
          await page.getByLabel('Supabase Secret key', { exact: true }).fill('synthetic-credential-for-local-fixture');
          await page.getByLabel('用户名', { exact: true }).fill('synthetic-owner');
          await input.fill(value);
        }
        await page.getByRole('button', { name: flow === 'account' ? '修改密码' : flow === 'create' ? '创建管理员' : '重置管理员', exact: true }).click();
        await settleRender(page);
        if (short) {
          assert.equal(data.calls.filter(call => call.path === mutation).length, 0, 'SEC01: fewer than fifteen Unicode characters must not be submitted');
          assert.match(await page.locator('body').innerText(), /至少\s*15\s*个字符/);
        } else {
          const saved = await waitForCall(data, call => call.path === mutation);
          await settleCall(page, saved);
          assert.equal(Array.from(saved.body[flow === 'account' ? 'new_password' : 'password']).length, 15);
          assert.equal(saved.body[flow === 'account' ? 'new_password' : 'password'] === value, true, 'credential content is sent unchanged');
          if (scenario === 'server-rejection') assert.match(await page.locator('body').innerText(), /服务器拒绝：请避开常见弱密码/);
        }
      });
    }
  }
  await check('SEC01-existing-login', 'existing short credentials remain valid for login', async (page, data) => {
    configure(data); data.authenticated = false;
    await page.goto(origin + '/login');
    await page.getByLabel('用户名', { exact: true }).fill('synthetic-owner');
    await page.getByLabel('密码', { exact: true }).fill('x'.repeat(6));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await settleCall(page, await waitForCall(data, call => call.path === '/api/login'));
    await page.waitForURL('**/admin');
    assert.equal(data.authenticated, true);
  });
  for (const response of ['html', 'empty', 'missing']) {
    await check(`F08-admin-recovery-${response}`, 'unconfirmed administrator recovery keeps the form and never announces success', async (page, data) => {
      configure(data); data.authenticated = false;
      data.handlers.unshift(async ({ path, route, json }) => {
        if (path !== '/api/admin/recovery') return false;
        if (response === 'missing') await json({});
        else await route.fulfill({ status: 200, contentType: 'text/html', body: response === 'html' ? '<html>Unexpected gateway document</html>' : '' });
        return true;
      });
      await page.goto(origin + '/login');
      await page.getByRole('button', { name: '忘记密码', exact: true }).click();
      await page.getByLabel('Supabase Secret key', { exact: true }).fill('synthetic-credential-for-local-fixture');
      await page.getByLabel('用户名', { exact: true }).fill('synthetic-owner');
      await page.getByLabel('新密码', { exact: true }).fill(Array.from({ length: 15 }, (_, index) => String.fromCharCode(65 + index)).join(''));
      await page.getByRole('button', { name: '重置管理员', exact: true }).click();
      await settleCall(page, await waitForCall(data, call => call.path === '/api/admin/recovery'));
      assert.doesNotMatch(await page.locator('body').innerText(), /管理员密码已重置|管理员已创建/, 'F08: the server must confirm recovery before it is presented as complete');
      assert.match(await page.locator('body').innerText(), /无法确认/);
      assert.equal(await page.getByLabel('新密码', { exact: true }).isVisible(), true);
    });
  }
  for (const scenario of ['ok', 'warning', 'critical', 'missing', 'invalid']) {
    await check(`D06-display-${scenario}`, 'database diagnostics separate whole database, history and theme quotas', async (page, data) => {
      configure(data);
      const mib = 1024 * 1024;
      const allocated = ({ ok: 420, warning: 425, critical: 475 }[scenario] || 420) * mib;
      const diagnostics = { measurement: 'database-allocation', database_allocated_bytes: allocated,
        application_allocated_bytes: 100 * mib, other_allocated_bytes: allocated - 100 * mib,
        tables: { website_checks: { allocated_bytes: 40 * mib }, theme_assets: { allocated_bytes: 30 * mib }, themes: { allocated_bytes: 10 * mib }, audit_logs: { allocated_bytes: 5 * mib } },
        theme_payload_bytes: 20 * mib, theme_count: 2, theme_asset_count: 8,
        theme_measurement: 'stored-text-including-base64-and-metadata', measured_at: new Date().toISOString(), cache_seconds: 600,
        budget_bytes: 500 * mib, theme_quota_bytes: 32 * mib, status: scenario };
      data.handlers.unshift(async ({ path, json }) => {
        if (path !== '/api/admin/capacity') return false;
        await json({ clients: 2, ping_records_per_day: 0, ping_tasks: [], history_storage_usage: { estimated_live_storage_bytes: mib, allocated_bytes: 2 * mib },
          database_storage_diagnostics: scenario === 'missing' ? null : scenario === 'invalid' ? { ...diagnostics, database_allocated_bytes: null } : diagnostics });
        return true;
      });
      await page.goto(origin + '/admin/settings/general');
      await page.getByText('用量实时估算', { exact: true }).waitFor();
      await settleCall(page, await waitForCall(data, call => call.path === '/api/admin/capacity'));
      const panel = page.getByRole('region', { name: '数据库实际占用', exact: true });
      assert.equal(await panel.count(), 1, 'D06: real database and theme storage must be visible in capacity settings');
      if (scenario === 'missing' || scenario === 'invalid') {
        assert.match(await panel.innerText(), /尚未读取|暂不可用/);
        assert.doesNotMatch(await panel.innerText(), /0(?:\.0)?\s*(?:B|MB|MiB|%)/, 'D06: missing diagnostics are not measured zero storage');
      } else {
        assert.match(await panel.innerText(), scenario === 'ok' ? /正常/ : scenario === 'warning' ? /接近预算/ : /容量紧张/);
        for (const label of ['数据库整体占用', '监控应用占用', '其他数据与系统占用', '网站检查记录', '主题文件', '主题配置', '审计日志', '主题累计内容']) assert.match(await panel.innerText(), new RegExp(label));
        assert.match(await panel.innerText(), /20(?:\.0)?\s*MiB\s*\/\s*32(?:\.0)?\s*MiB/);
        assert.match(await panel.innerText(), /85%.*95%/);
        assert.match(await panel.innerText(), /10 分钟/);
        assert.match(await panel.innerText(), /物理.*不.*历史.*恢复|历史.*恢复.*不.*物理/);
        assert.equal(await panel.getByRole('link', { name: '管理主题', exact: true }).getAttribute('href'), '/admin/themes');
      }
    });
  }
  for (const [scenario, field, value] of [
    ['save', 'database_storage_budget_bytes', '1073741824'],
    ['database-low', 'database_storage_budget_bytes', '67108863'],
    ['database-high', 'database_storage_budget_bytes', '549755813889'],
    ['theme-low', 'theme_storage_quota_bytes', '1048575'],
    ['theme-high', 'theme_storage_quota_bytes', '1073741825'],
  ]) {
    await check(`D06-budget-${scenario}`, 'database and theme budgets save valid values and reject out-of-range edits', async (page, data) => {
      configure(data);
      data.general.database_storage_budget_bytes = '524288000';
      data.general.theme_storage_quota_bytes = '33554432';
      await page.goto(origin + '/admin/settings/general');
      await page.getByText('用量实时估算', { exact: true }).waitFor();
      const input = page.getByLabel(field === 'database_storage_budget_bytes' ? '数据库整体预算（字节）' : '主题累计内容限额（字节）', { exact: true });
      assert.equal(await input.count(), 1, 'D06: storage budgets need an editable, named control');
      await input.fill(value);
      if (scenario === 'save') await page.getByLabel('主题累计内容限额（字节）', { exact: true }).fill('67108864');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      if (scenario === 'save') {
        const saved = await waitForCall(data, call => call.path === '/api/admin/settings' && call.method === 'POST');
        await settleCall(page, saved);
        assert.equal(saved.body.database_storage_budget_bytes, '1073741824');
        assert.equal(saved.body.theme_storage_quota_bytes, '67108864');
      } else {
        await settleRender(page);
        assert.equal(data.calls.filter(call => call.path === '/api/admin/settings' && call.method === 'POST').length, 0);
        assert.match(await page.locator('body').innerText(), /预算.*范围|限额.*范围/);
      }
    });
  }
} finally {
  await finish();
}
