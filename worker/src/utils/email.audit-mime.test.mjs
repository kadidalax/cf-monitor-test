import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailMessage, sendSmtpCommands } from './email.ts';
import { buildNodeRecoveryNotification } from './notification-templates.ts';

const envelope = {
  fromAddress: 'from@example.test', fromName: 'Synthetic monitor',
  recipients: ['to@example.test'], host: 'smtp.example.test',
};

function messageParts(wire) {
  const separator = wire.indexOf('\r\n\r\n');
  assert.ok(separator >= 0);
  return [wire.slice(0, separator), wire.slice(separator + 4)];
}

function assertSmtpLines(wire) {
  assert.doesNotMatch(wire, /(?<!\r)\n|\r(?!\n)/, 'SMTP line endings must be CRLF');
  for (const line of wire.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 998, 'SMTP line must fit 1000 bytes including CRLF');
  }
  assert.match(wire, /^[\x09\x0d\x0a\x20-\x7e]*$/, 'serialization must work without 8BITMIME');
}

for (const [label, body, expected] of [
  ['mixed newlines', '第一行\n第二行\r第三行\r\n第四行🚀', '第一行\r\n第二行\r\n第三行\r\n第四行🚀'],
  ['long URL', 'https://site.example.test/path?q=' + 'x'.repeat(1300), 'https://site.example.test/path?q=' + 'x'.repeat(1300)],
  ['dot-leading lines', '.first\n.\nlast\n', '.first\r\n.\r\nlast\r\n'],
  ['emoji at body cut', 'a'.repeat(4095) + '🚀', 'a'.repeat(4095)],
]) {
  test(`N03 MIME serializes ${label} as bounded reversible 7bit data`, () => {
    const wire = buildEmailMessage({ ...envelope, subject: 'Synthetic', body });
    assertSmtpLines(wire);
    const [headers, encoded] = messageParts(wire);
    assert.match(headers, /^Content-Transfer-Encoding: base64$/m);
    for (const line of encoded.split('\r\n')) assert.ok(line.length <= 76);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64'));
    assert.equal(decoded, expected);
  });
}

test('N03 a normal recovery notification produces no bare LF or raw non-ASCII wire bytes', () => {
  const notification = buildNodeRecoveryNotification({ nodeName: '演示节点', recoveredAt: '2026-09-13T10:00:00Z' });
  assertSmtpLines(buildEmailMessage({ ...envelope, ...notification }));
});

test('N03 long UTF-8 Subject and From display name use independently decodable encoded words', () => {
  const subject = '监控🚀'.repeat(20);
  const fromName = '服务器🚀'.repeat(16);
  const wire = buildEmailMessage({ ...envelope, fromName, subject, body: 'test' });
  assertSmtpLines(wire);
  const [headers] = messageParts(wire);
  const fields = headers.split(/\r\n(?=[^ \t])/);
  for (const [field, expected] of [['Subject', subject], ['From', fromName]]) {
    const value = fields.find(value => value.startsWith(field + ':'));
    for (const line of value.split('\r\n')) {
      if (line.includes('=?UTF-8?B?')) assert.ok(line.length <= 76, 'header lines containing encoded words must fit 76 characters');
    }
    const words = [...value.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
    assert.ok(words.length > 1, `${field} must fold long UTF-8 content`);
    for (const word of words) assert.ok(word[0].length <= 75, 'RFC 2047 encoded-word maximum is 75 characters');
    const decoded = words.map(word => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(word[1], 'base64'))).join('');
    assert.equal(decoded, expected);
  }
});

test('N03 subject character limit never emits a replacement character for half an emoji', () => {
  const [headers] = messageParts(buildEmailMessage({ ...envelope, subject: 'a'.repeat(119) + '🚀', body: 'test' }));
  const subject = headers.split(/\r\n(?=[^ \t])/).find(value => value.startsWith('Subject:'));
  const decoded = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
    .map(word => Buffer.from(word[1], 'base64').toString('utf8')).join('');
  assert.equal(decoded, 'a'.repeat(119));
});

test('N03 many valid recipients are folded without altering recipient addresses', () => {
  const recipients = Array.from({ length: 20 }, (_, index) => `${index}${'x'.repeat(60)}@${'d'.repeat(60)}.example.test`);
  const wire = buildEmailMessage({ ...envelope, recipients, subject: 'test', body: 'test' });
  assertSmtpLines(wire);
  const [headers] = messageParts(wire);
  const to = headers.split(/\r\n(?=[^ \t])/).find(value => value.startsWith('To:'));
  assert.deepEqual(to.slice(3).replace(/\r\n[ \t]+/g, ' ').split(',').map(value => value.trim()), recipients);
});

test('N03 ordinary UTF-8 alert is accepted by a strict SMTP peer without 8BITMIME', async () => {
  const replies = ['220 ready', '250 AUTH PLAIN', '235 accepted', '250 sender ok', '250 recipient ok', '354 send content'];
  let data;
  const result = await sendSmtpCommands({
    readLine: async () => replies.shift(),
    writeLine: async () => {},
    writeData: async value => {
      data = value;
      const valid = !/(?<!\r)\n|\r(?!\n)|[^\x09\x0d\x0a\x20-\x7e]/.test(value)
        && value.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 998);
      replies.push(valid ? '250 accepted' : '554 invalid MIME');
    },
  }, { ...envelope, port: 465, security: 'tls', authMethod: 'plain', username: 'synthetic', password: 'synthetic' },
  '恢复通知🚀', '节点已恢复\nhttps://site.example.test/?q=' + 'x'.repeat(1300));
  assert.equal(result.ok, true, 'the real sender must produce valid 7bit DATA');
  assert.ok(data.endsWith('\r\n.'));
});
