import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const notificationsSource = readFileSync(join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'Notifications.tsx'), 'utf8');

test('notification settings exposes SMTP email controls', () => {
  assert.match(notificationsSource, /email_smtp_host/);
  assert.match(notificationsSource, /email_smtp_port/);
  assert.match(notificationsSource, /email_smtp_security/);
  assert.match(notificationsSource, /email_smtp_recipients/);
  assert.match(notificationsSource, /SMTP 邮件/);
});

test('SMTP credentials save without secondary admin password prompt', () => {
  assert.match(notificationsSource, /email_smtp_username/);
  assert.match(notificationsSource, /email_smtp_password/);
  assert.doesNotMatch(notificationsSource, /withCurrentPassword|current_password|当前管理员密码/);
});

test('test email sends through existing test endpoint with email channel', () => {
  assert.match(notificationsSource, /\/admin\/test\/sendMessage/);
  assert.match(notificationsSource, /channel:\s*'email'/);
});

test('notification client list displays and searches ipv6 when ipv4 is absent', () => {
  assert.match(notificationsSource, /ipv6\?:\s*string/);
  assert.match(notificationsSource, /function clientDisplayIp\(client: NotificationClient\)/);
  assert.match(notificationsSource, /client\.ipv4\s*\|\|\s*client\.ipv6\s*\|\|\s*''/);
  assert.match(notificationsSource, /clientDisplayIp\(c\)\.toLowerCase\(\)\.includes\(term\)/);
});
