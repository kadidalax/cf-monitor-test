import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearCachedPublicSettings,
  fetchPublicSettings,
  normalizePublicSettings,
} from '../src/utils/publicSettings.ts';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCachedPublicSettings();
});

test('public settings normalization keeps expected keys and clamps numeric settings', () => {
  const settings = normalizePublicSettings({
    site_title: 'Custom',
    site_subtitle: 42,
    script_domain: 'https://example.com',
    live_poll_active_interval_sec: '1',
    live_poll_idle_interval_sec: '999999',
    live_poll_active_max_duration_sec: '120',
    active_theme: 'aurora',
    theme_settings: {
      backgroundImageUrlDesktop: '/bg.png',
      backgroundImageUrlMobile: 123,
      mainContentWidth: 10,
    },
    unexpected_secret: 'do-not-cache',
  });

  assert.ok(settings);
  assert.equal(settings.site_title, 'Custom');
  assert.equal(settings.site_subtitle, '');
  assert.equal(settings.script_domain, 'https://example.com');
  assert.equal(settings.live_poll_active_interval_sec, '3');
  assert.equal(settings.live_poll_idle_interval_sec, '3600');
  assert.equal(settings.live_poll_active_max_duration_sec, '120');
  assert.equal(settings.active_theme, 'aurora');
  assert.equal(settings.theme_settings.backgroundImageUrlDesktop, '/bg.png');
  assert.equal(settings.theme_settings.backgroundImageUrlMobile, '');
  assert.equal(settings.theme_settings.mainContentWidth, 60);
  assert.equal('unexpected_secret' in settings, false);
});

test('public settings fetch rejects malformed payloads and caches normalized responses', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ site_title: 'Cached', theme_settings: { mainContentWidth: 95 } }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };

  const first = await fetchPublicSettings({ force: true });
  const second = await fetchPublicSettings();

  assert.equal(calls, 1);
  assert.equal(first.site_title, 'Cached');
  assert.equal(second.theme_settings.mainContentWidth, 95);

  clearCachedPublicSettings();
  globalThis.fetch = async () => new Response(JSON.stringify(['nope']), { status: 200 });
  await assert.rejects(() => fetchPublicSettings({ force: true }), /Invalid public settings response/);
});
