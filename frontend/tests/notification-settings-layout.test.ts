import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  join(import.meta.dirname, '..', 'src', 'pages', 'admin', 'Notifications.tsx'),
  'utf8',
);

test('settings tab imports and uses shared SettingCard', () => {
  assert.match(source, /SettingCard/);
  // 三张卡片标题
  assert.match(source, /title="通知通道"/);
  assert.match(source, /title="SMTP 邮件通知"/);
  assert.match(source, /title="Telegram 通知"/);
});

test('settings tab uses Flex column gap=4 wrapper like sibling settings pages', () => {
  assert.match(source, /<Flex direction="column" gap="4">/);
});

test('SMTP and Telegram cards are linked to selected channel', () => {
  assert.match(source, /const \[smtpOpen, setSmtpOpen\] = useState/);
  assert.match(source, /const \[telegramOpen, setTelegramOpen\] = useState/);
  assert.match(source, /open=\{smtpOpen\}/);
  assert.match(source, /onOpenChange=\{setSmtpOpen\}/);
  assert.match(source, /open=\{telegramOpen\}/);
  assert.match(source, /onOpenChange=\{setTelegramOpen\}/);
  assert.match(source, /handleNotificationMethodChange/);
});

test('custom notification settings skeleton classes are removed from view', () => {
  assert.doesNotMatch(source, /notification-settings-layout/);
  assert.doesNotMatch(source, /notification-settings-panel/);
  assert.doesNotMatch(source, /notification-settings-section/);
  assert.doesNotMatch(source, /notification-section-heading/);
});

test('reused field grids are preserved', () => {
  assert.match(source, /notification-email-connection-grid/);
  assert.match(source, /notification-email-identity-grid/);
  assert.match(source, /notification-telegram-grid/);
  assert.match(source, /notification-email-test-row/);
});

test('channel-only toggles are removed from notification settings', () => {
  assert.doesNotMatch(source, /IP 变更通知/);
  assert.doesNotMatch(source, /从未上报节点告警/);
  assert.doesNotMatch(source, /enable_ip_change_notification/);
  assert.doesNotMatch(source, /offline_notify_never_reported/);
});

test('test buttons live inside their provider setting cards', () => {
  const smtpCard = source.match(/title="SMTP 邮件通知"[\s\S]*?title="Telegram 通知"/)?.[0] || '';
  const telegramCard = source.match(/title="Telegram 通知"[\s\S]*?<\/SettingCard>/)?.[0] || '';
  const channelCard = source.match(/title="通知通道"[\s\S]*?title="SMTP 邮件通知"/)?.[0] || '';

  assert.match(smtpCard, /notification-email-test-row/);
  assert.match(smtpCard, /SMTP 测试/);
  assert.match(telegramCard, /notification-telegram-test-row/);
  assert.match(telegramCard, /Telegram 测试/);
  assert.doesNotMatch(channelCard, /SMTP 测试|Telegram 测试|notification-test-strip/);
});

test('provider inputs use content-sized widths instead of full-width fields', () => {
  assert.match(source, /className="notification-email-host"/);
  assert.match(source, /width="24ch"/);
  assert.match(source, /width="52ch"/);
  assert.doesNotMatch(source, /width="100%"/);
});

const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');

test('removed skeleton CSS classes no longer exist', () => {
  assert.doesNotMatch(css, /\.notification-settings-layout/);
  assert.doesNotMatch(css, /\.notification-settings-panel/);
  assert.doesNotMatch(css, /\.notification-settings-section/);
  assert.doesNotMatch(css, /\.notification-section-heading/);
});

test('reused grid CSS classes are preserved', () => {
  assert.match(css, /\.notification-channel-row\s*\{/);
  assert.match(css, /\.notification-email-connection-grid\s*\{/);
  assert.match(css, /\.notification-telegram-grid/);
  assert.match(css, /\.notification-email-test-row\s*\{/);
  assert.match(css, /\.notification-telegram-test-row\s*\{/);
  assert.match(css, /grid-template-columns:\s*24ch 8ch 15ch 10ch/);
  assert.match(css, /grid-template-columns:\s*52ch 18ch/);
});
