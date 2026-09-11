import assert from 'node:assert/strict';
import { createHarness, settleRender } from './helpers/harness.mjs';

const moduleFlag = process.argv.indexOf('--playwright-module');
const { origin, check, finish } = await createHarness({
  selection: process.argv[2] || 'ALL',
  playwrightModule: moduleFlag >= 0 ? process.argv[moduleFlag + 1] : process.env.CF_MONITOR_PLAYWRIGHT_MODULE,
});

function directorySnapshot(data, offline) {
  const now = Date.now();
  const record = { cpu: 17, ram: 16_000_000, ram_total: 128_000_000, swap: 0, swap_total: 0,
    disk: 8_388_608, disk_total: 5_024_000_000, disk_source: 'directory', disk_sampled_at: now - 180_000,
    load: null, temp: null, uptime: 1000, net_in: 0, net_out: 0, net_total_up: 0, net_total_down: 0,
    process_count: 3, connections: 1, connections_udp: 0 };
  const node = { uuid: 'node-a', name: data.clients[0].name, lastReportTime: now - 60_000, ...record };
  return { online: offline ? [] : ['node-a'], clients: offline ? [] : [node], data: offline ? {} : { 'node-a': record },
    last_known: offline ? { 'node-a': node } : {}, count: offline ? 0 : 1, timestamp: now };
}

try {
  for (const [width, offline] of [[1280, false], [390, false], [1280, true]]) {
    await check(`DISK-source-${width}-${offline}`, 'estimated allocated usage and its sampling time remain visible in every view', async (page, data) => {
      data.authenticated = false;
      data.clients = [{ ...data.clients[0], uuid: 'node-a', disk_total: 5_024_000_000 }];
      const live = directorySnapshot(data, offline);
      data.handlers.push(async ({ path, json }) => {
        if (path === '/api/public/bootstrap') { await json({ clients: data.clients, settings: data.settings, live }); return true; }
        if (path === '/api/live/clients') { await json(live); return true; }
        return false;
      });
      await page.goto(origin + '/');
      const card = page.locator('#node-a');
      await card.waitFor();
      await settleRender(page);
      const cardText = await card.innerText();
      assert.match(cardText, /≈\s*8\.00 MB\s*\/\s*4\.7 GB/, 'card shows allocated bytes, not capacity only');
      assert.match(cardText, /文件占用估算/);
      assert.match(cardText, /采样/);
      await page.getByRole('button', { name: '表格视图', exact: true }).click();
      const table = page.locator('.node-table-root');
      await table.waitFor();
      assert.match(await table.innerText(), /≈\s*0\.2%/);
      await page.goto(origin + '/instance/node-a');
      await page.locator('.instance-top-summary').waitFor();
      const details = await page.locator('.instance-top-summary').innerText();
      assert.match(details, /≈\s*8\.00 MB\s*\/\s*4\.7 GB/);
      assert.match(details, /文件占用估算/);
      assert.match(details, /采样/);
      await page.getByRole('tab', { name: '磁盘', exact: true }).click();
      await page.getByText(/按上报时间记录.*文件占用估算/).waitFor();
      const bounds = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(bounds.page <= bounds.viewport, 'source/time text does not overflow the page');
      data.observed = { cardText, details, bounds, sampleTime: live.data['node-a']?.disk_sampled_at ?? live.last_known['node-a'].disk_sampled_at };
    }, { width });
  }
} finally { await finish(); }
