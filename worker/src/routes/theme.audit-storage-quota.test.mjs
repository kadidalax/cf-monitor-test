import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const manifest = { short: 'synthetic', name: 'Synthetic theme', style: 'style.css' };
const saved = { ...manifest, manifest_json: JSON.stringify(manifest), config_json: '{}', custom_css: '' };

function fixture(kind, fail = true) {
  let attempts = 0;
  let ApiError;
  const write = async () => {
    attempts += 1;
    if (fail) throw new ApiError(kind === 'upload' ? 'cfm_upsert_theme' : 'cfm_update_theme_settings', 400,
      '{"code":"P0001","message":"CFM_THEME_STORAGE_QUOTA_EXCEEDED"}');
    return true;
  };
  const loader = createWorkerLoader({
    db: { getTheme: async () => kind === 'settings' ? saved : null, upsertTheme: write, updateThemeSettings: write,
      getSetting: async () => 'monitor', insertAuditLog: async () => {} },
    globals: { console: { error: () => {}, warn: () => {}, log: () => {} } },
  });
  ApiError = loader.load('worker/src/db/supabase-api/client.ts').SupabaseApiError;
  const { adminThemeRoutes } = loader.load('worker/src/routes/theme.ts');
  adminThemeRoutes.onError((_error, c) => c.json({ error: 'Unhandled theme database failure' }, 500));
  const request = async () => {
    let init;
    if (kind === 'upload') {
      const bytes = zipSync({ 'cf-monitor-theme.json': strToU8(JSON.stringify(manifest)), 'style.css': strToU8('body{color:red}') });
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: 'application/zip' }), 'synthetic.zip');
      init = { method: 'POST', body: form };
    } else {
      init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ short: kind === 'new_builtin' ? 'monitor' : 'synthetic', config: {}, custom_css: 'body{color:red}' }) };
    }
    return adminThemeRoutes.fetch(new Request(`https://panel.example.test/${kind === 'upload' ? 'upload' : 'settings'}`, init), {}, { waitUntil: () => {} });
  };
  return { request, get attempts() { return attempts; } };
}

for (const kind of ['upload', 'settings', 'new_builtin']) {
  test(`D06 theme ${kind} returns an actionable quota response after database rejection`, async () => {
    const app = fixture(kind);
    const response = await app.request();
    assert.equal(app.attempts, 1, 'valid inputs must reach the actual theme write boundary');
    assert.equal(response.status, 409, 'a quota rejection must not become a generic server failure');
    const body = await response.json();
    assert.equal(body.code, 'theme_storage_quota_exceeded');
    assert.match(body.error, /删除/);
    assert.match(body.error, /限额|配额/);
    assert.notEqual(body.success, true);
  });
}

test('D06 a theme write below the accumulated quota retains the successful settings flow', async () => {
  const app = fixture('settings', false);
  const response = await app.request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(app.attempts, 1);
});
