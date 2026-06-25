import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTING_SCHEMA, buildAdminSettings, normalizeSettingValue } from '../src/settings/schema.ts';

test('script_domain settings are normalized to safe HTTP origins', () => {
  assert.deepEqual(normalizeSettingValue('script_domain', ''), { ok: true, value: '' });
  assert.deepEqual(normalizeSettingValue('script_domain', 'example.com/path?q=1'), { ok: true, value: 'https://example.com' });
  assert.deepEqual(normalizeSettingValue('script_domain', 'http://localhost:8787/setup'), { ok: true, value: 'http://localhost:8787' });
  assert.deepEqual(normalizeSettingValue('script_domain', 'http://127.0.0.1:8787/setup'), { ok: true, value: 'http://127.0.0.1:8787' });
  assert.deepEqual(normalizeSettingValue('script_domain', 'http://[::1]:8787/setup'), { ok: true, value: 'http://[::1]:8787' });
  assert.deepEqual(normalizeSettingValue('script_domain', 'https://worker.example.com/'), { ok: true, value: 'https://worker.example.com' });

  assert.equal(normalizeSettingValue('script_domain', 'http://example.com').ok, false);
  assert.equal(normalizeSettingValue('script_domain', 'javascript:alert(1)').ok, false);
  assert.equal(normalizeSettingValue('script_domain', 'https://user:pass@example.com').ok, false);
  assert.equal(normalizeSettingValue('script_domain', true).ok, false);
});

test('collection policy defaults use 120 seconds for persist, ping, and idle intervals', () => {
  assert.equal(SETTING_SCHEMA.record_persist_interval_sec.defaultValue, '120');
  assert.equal(SETTING_SCHEMA.ping_record_persist_interval_sec.defaultValue, '120');
  assert.equal(SETTING_SCHEMA.live_poll_idle_interval_sec.defaultValue, '120');

  const settings = buildAdminSettings({});
  assert.equal(settings.record_persist_interval_sec, '120');
  assert.equal(settings.ping_record_persist_interval_sec, '120');
  assert.equal(settings.live_poll_idle_interval_sec, '120');
});

test('active theme is a public setting and defaults to built-in theme', () => {
  assert.equal(SETTING_SCHEMA.active_theme.defaultValue, 'default');
  assert.equal(SETTING_SCHEMA.active_theme.public, true);

  const settings = buildAdminSettings({});
  assert.equal(settings.active_theme, 'default');
  assert.deepEqual(normalizeSettingValue('active_theme', 'aurora_1'), { ok: true, value: 'aurora_1' });
  assert.equal(normalizeSettingValue('active_theme', '../bad').ok, false);
});

test('email notification settings normalize valid values', () => {
  assert.deepEqual(normalizeSettingValue('notification_method', 'email'), { ok: true, value: 'email' });
  assert.deepEqual(normalizeSettingValue('email_smtp_host', 'smtp.example.com'), { ok: true, value: 'smtp.example.com' });
  assert.deepEqual(normalizeSettingValue('email_smtp_port', 587), { ok: true, value: '587' });
  assert.deepEqual(normalizeSettingValue('email_smtp_security', 'starttls'), { ok: true, value: 'starttls' });
  assert.deepEqual(normalizeSettingValue('email_smtp_security', 'tls'), { ok: true, value: 'tls' });
  assert.deepEqual(normalizeSettingValue('email_smtp_auth_method', 'plain'), { ok: true, value: 'plain' });
  assert.deepEqual(normalizeSettingValue('email_smtp_auth_method', 'login'), { ok: true, value: 'login' });
  assert.deepEqual(normalizeSettingValue('email_smtp_from_address', 'monitor@example.com'), { ok: true, value: 'monitor@example.com' });
  assert.deepEqual(normalizeSettingValue('email_smtp_recipients', 'admin@example.com, ops@example.com'), {
    ok: true,
    value: 'admin@example.com,ops@example.com',
  });
});

test('email notification settings reject unsafe values', () => {
  assert.equal(normalizeSettingValue('email_smtp_port', 25).ok, false);
  assert.equal(normalizeSettingValue('email_smtp_port', 0).ok, false);
  assert.equal(normalizeSettingValue('email_smtp_port', 65536).ok, false);
  assert.equal(normalizeSettingValue('email_smtp_host', 'localhost').ok, false);
  assert.equal(normalizeSettingValue('email_smtp_host', '127.0.0.1').ok, false);
  assert.equal(normalizeSettingValue('email_smtp_host', '192.168.1.10').ok, false);
  assert.equal(normalizeSettingValue('email_smtp_security', 'none').ok, false);
  assert.equal(normalizeSettingValue('email_smtp_auth_method', 'oauth').ok, false);
  assert.equal(normalizeSettingValue('email_smtp_from_address', 'not-an-email').ok, false);
  assert.equal(normalizeSettingValue('email_smtp_recipients', Array.from({ length: 21 }, (_, i) => `u${i}@example.com`).join(',')).ok, false);
});
