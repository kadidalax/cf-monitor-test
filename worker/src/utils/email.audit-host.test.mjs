import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSmtpConfig } from './email.ts';
import { normalizeSettingValue } from '../settings/schema.ts';

for (const host of ['fcmail.example.test', 'fdmail.example.test', 'fe80.example.test', 'smtp.example.test', '8.8.8.8']) {
  test(`N04 SMTP accepts an ordinary hostname or public IPv4: ${host}`, () => {
    assert.equal(normalizeSettingValue('email_smtp_host', host).ok, true, 'settings must allow legitimate SMTP names');
    assert.doesNotThrow(() => validateSmtpConfig({ host, port: 465, security: 'tls' }));
  });
}

test('N04 runtime validation separately accepts a DNS name beginning with fc or fd', () => {
  for (const host of ['fcmail.example.test', 'fdmail.example.test']) {
    assert.doesNotThrow(() => validateSmtpConfig({ host, port: 587, security: 'starttls' }));
  }
});

for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fc00::1', 'fd00::1', 'smtp.example.test:465', 'user@smtp.example.test']) {
  test(`N04 SMTP continues rejecting a forbidden literal or malformed authority: ${host}`, () => {
    assert.equal(normalizeSettingValue('email_smtp_host', host).ok, false);
    assert.throws(() => validateSmtpConfig({ host, port: 465, security: 'tls' }));
  });
}

test('N04 settings normalize DNS case and whitespace while preserving optional empty configuration', () => {
  assert.deepEqual(normalizeSettingValue('email_smtp_host', '  FdMail.Example.Test  '), { ok: true, value: 'fdmail.example.test' });
  assert.deepEqual(normalizeSettingValue('email_smtp_host', ''), { ok: true, value: '' });
  assert.throws(() => validateSmtpConfig({ host: '', port: 465, security: 'tls' }));
});
