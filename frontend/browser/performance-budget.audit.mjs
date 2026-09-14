import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, settleRender } from './helpers/harness.mjs';

const mode = process.argv[2] || 'verify';
const moduleFlag = process.argv.indexOf('--playwright-module');
const playwrightModule = moduleFlag >= 0 ? process.argv[moduleFlag + 1] : process.env.CF_MONITOR_PLAYWRIGHT_MODULE;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const output = fileURLToPath(new URL('../../.trellis/tasks/09-13-full-audit-remediation/research/performance/', import.meta.url));
await mkdir(output, { recursive: true });
const { origin, check, finish } = await createHarness({ selection: 'ALL', playwrightModule, production: true });

function mergedRanges(ranges) {
  const result = [];
  for (const range of ranges.sort((a, b) => a.startOffset - b.startOffset)) {
    const previous = result.at(-1);
    if (previous && range.startOffset <= previous.endOffset) previous.endOffset = Math.max(previous.endOffset, range.endOffset);
    else result.push({ ...range });
  }
  return result;
}

async function styles(page, selectors) {
  return page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing rendered style target: ${selector}`);
    const style = getComputedStyle(element);
    return [selector, Object.fromEntries(['display', 'position', 'color', 'backgroundColor', 'borderColor', 'borderRadius', 'padding', 'gap'].map(name => [name, style[name]]))];
  })), selectors);
}

try {
  await check('PERF01-home', 'production homepage loads only its needed resources and preserves charts and administration', async (page, data, context) => {
    data.authenticated = false;
    const base = data.clients[0];
    data.clients = Array.from({ length: 12 }, (_, index) => ({ ...base, uuid: `node-${index}`, name: `Synthetic server ${index + 1}`, sort_order: index }));
    data.handlers.unshift(async ({ path, json }) => {
      if (path === '/api/task/ping') { await json([{ id: 1, name: 'Synthetic ping', target: '1.1.1.1', all_clients: true, interval_sec: 120 }]); return true; }
      if (path === '/api/records/ping/batch') { await json({ 1: [20, 30, 40].map((value, index) => ({ time: new Date(Date.now() - (index + 1) * 120000).toISOString(), value })) }); return true; }
      return false;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const sheets = new Map();
    cdp.on('CSS.styleSheetAdded', ({ header }) => sheets.set(header.styleSheetId, header));
    await cdp.send('CSS.startRuleUsageTracking');
    await page.addInitScript(() => {
      window.auditPerformance = { lcp: null, cls: 0 };
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.auditPerformance.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.auditPerformance.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.querySelectorAll('.node-card').length === 12);
    await page.evaluate(() => new Promise(resolve => requestIdleCallback(resolve)));
    await page.waitForLoadState('networkidle');
    await settleRender(page);
    const resources = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource').map(entry => entry.name))]);
    const files = [];
    for (const resource of resources) {
      const url = new URL(resource);
      if (url.origin !== origin || !url.pathname.startsWith('/assets/') || !/\.(?:js|css)$/.test(url.pathname)) continue;
      const body = await readFile(join(dist, 'assets', basename(url.pathname)));
      files.push({ name: basename(url.pathname), type: url.pathname.endsWith('.css') ? 'css' : 'js', bytes: body.length, gzipBytes: gzipSync(body).length });
    }
    const { ruleUsage } = await cdp.send('CSS.stopRuleUsageTracking');
    const cssCoverage = [];
    for (const [id, sheet] of sheets) {
      if (!sheet.sourceURL.startsWith(origin + '/assets/')) continue;
      const { text } = await cdp.send('CSS.getStyleSheetText', { styleSheetId: id });
      const usedRanges = mergedRanges(ruleUsage.filter(row => row.styleSheetId === id && row.used));
      cssCoverage.push({ name: basename(new URL(sheet.sourceURL).pathname), bytes: Buffer.byteLength(text),
        usedBytes: usedRanges.reduce((sum, range) => sum + Buffer.byteLength(text.slice(range.startOffset, range.endOffset)), 0) });
    }
    const snapshot = {
      mode, measuredAt: new Date().toISOString(), environment: 'Local production build; cold cache; 12 synthetic nodes; default CPU/network; laboratory observation only',
      files, cssCoverage,
      jsBytes: files.filter(file => file.type === 'js').reduce((sum, file) => sum + file.bytes, 0),
      cssBytes: files.filter(file => file.type === 'css').reduce((sum, file) => sum + file.bytes, 0),
      jsGzipBytes: files.filter(file => file.type === 'js').reduce((sum, file) => sum + file.gzipBytes, 0),
      cssGzipBytes: files.filter(file => file.type === 'css').reduce((sum, file) => sum + file.gzipBytes, 0),
      metrics: await page.evaluate(() => ({ ...window.auditPerformance, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null })),
      publicStyles: await styles(page, ['.node-card', '.nav-bar', '.main-content']),
    };
    await page.screenshot({ path: join(output, `${mode}-home.png`), fullPage: true });
    await page.getByRole('button', { name: '查看 Ping 延迟', exact: true }).first().click();
    await page.locator('.mini-ping-chart-legend').getByText('Synthetic ping', { exact: true }).waitFor();
    assert.equal(await page.locator('.mini-ping-chart .recharts-line-dot').count(), 3, 'charts remain functional after opening the control');
    data.authenticated = true;
    await page.goto(origin + '/admin/settings/general');
    await page.getByText('数据库实际占用', { exact: true }).waitFor();
    snapshot.adminStyles = await styles(page, ['.admin-sidebar', '.admin-main', '.general-settings-workspace']);
    await page.screenshot({ path: join(output, `${mode}-admin.png`), fullPage: true });
    await writeFile(join(output, `${mode}.json`), JSON.stringify(snapshot, null, 2));
    data.observed = snapshot;
    if (mode !== 'baseline') {
      const baseline = JSON.parse(await readFile(join(output, 'baseline.json'), 'utf8'));
      assert.deepEqual(snapshot.publicStyles, baseline.publicStyles, 'public appearance stays unchanged');
      assert.deepEqual(snapshot.adminStyles, baseline.adminStyles, 'administration keeps its original styles');
      assert.equal(files.filter(file => /^(?:AdminLayout|Account|Dashboard|Websites|Notifications|Themes|AuditLogs|SettingsGeneral|SettingsSite|SettingsLayout|PingTasks|About)-/.test(file.name)).length, 0, 'an idle public homepage must not fetch administration routes');
      assert.ok(snapshot.jsBytes <= baseline.jsBytes * 0.7, 'initial JavaScript must fall by at least thirty percent from the measured baseline');
      // The confirmed administration selectors account for > 24 KiB after minification.
      // Keep the full Radix palette and component CSS available to custom themes.
      assert.ok(snapshot.cssBytes <= baseline.cssBytes - 24 * 1024, 'initial CSS must exclude at least 24 KiB of administration-only styles');
    }
  });
} finally {
  await finish();
}
