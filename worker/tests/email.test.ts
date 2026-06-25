import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEmailMessage,
  normalizeRecipients,
  sendSmtpCommands,
  validateSmtpConfig,
} from '../src/utils/email.ts';

test('normalizeRecipients accepts comma semicolon and newline separators', () => {
  assert.deepEqual(
    normalizeRecipients('admin@example.com; ops@example.com\nroot@example.com'),
    ['admin@example.com', 'ops@example.com', 'root@example.com'],
  );
});

test('normalizeRecipients rejects invalid and excessive recipients', () => {
  assert.throws(() => normalizeRecipients('not-email'), /收件地址无效/);
  assert.throws(() => normalizeRecipients(Array.from({ length: 21 }, (_, i) => `u${i}@example.com`).join(',')), /不能超过 20/);
});

test('validateSmtpConfig rejects unsafe destinations', () => {
  assert.throws(() => validateSmtpConfig({ host: 'localhost', port: 587, security: 'starttls' }), /SMTP Host 无效/);
  assert.throws(() => validateSmtpConfig({ host: '127.0.0.1', port: 587, security: 'starttls' }), /SMTP Host 无效/);
  assert.throws(() => validateSmtpConfig({ host: 'smtp.example.com', port: 25, security: 'starttls' }), /25/);
});

test('buildEmailMessage creates a UTF-8 text email without leaking password fields', () => {
  const message = buildEmailMessage({
    fromAddress: 'monitor@example.com',
    fromName: 'CF VPS Monitor',
    recipients: ['admin@example.com'],
    subject: '测试通知',
    body: '节点离线: server-1',
    host: 'smtp.example.com',
  });

  assert.match(message, /^From: "CF VPS Monitor" <monitor@example\.com>/m);
  assert.match(message, /^To: admin@example\.com/m);
  assert.match(message, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(message, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(message, /节点离线: server-1/);
  assert.doesNotMatch(message, /password/i);
});

test('SMTP command builder sends mail transaction commands in order', async () => {
  const commands: string[] = [];
  const result = await sendSmtpCommands({
    readLine: async () => commands.length === 0 ? '220 smtp.example.com ESMTP' : '250 OK',
    writeLine: async (line: string) => { commands.push(line); },
    writeData: async (data: string) => { commands.push(data); },
  }, {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    username: 'user',
    password: 'pass',
    fromAddress: 'monitor@example.com',
    fromName: 'CF VPS Monitor',
    recipients: ['admin@example.com'],
    authMethod: 'plain',
  }, 'Subject', 'Body');

  assert.equal(result.ok, true);
  assert.deepEqual(commands.slice(-5), [
    'MAIL FROM:<monitor@example.com>',
    'RCPT TO:<admin@example.com>',
    'DATA',
    commands.at(-2)!,
    'QUIT',
  ]);
});
