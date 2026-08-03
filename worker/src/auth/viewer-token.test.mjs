import assert from 'node:assert/strict';

const { normalizeIpForBinding, createViewerToken, verifyViewerToken } = await import('./viewer-token.ts');

const SECRET = 'test-secret-that-is-at-least-32-bytes-long!!';

// --- IPv4 → /24 ---
assert.equal(normalizeIpForBinding('1.2.3.4'), '1.2.3.0/24');
assert.equal(normalizeIpForBinding('203.0.113.255'), '203.0.113.0/24');
assert.equal(
  normalizeIpForBinding('1.2.3.4'),
  normalizeIpForBinding('1.2.3.200'),
  '同 /24 内不同主机位必须归一到同一网段',
);
assert.notEqual(
  normalizeIpForBinding('1.2.3.4'),
  normalizeIpForBinding('1.2.4.4'),
  '不同 /24 必须区分开',
);

// --- IPv6 → /64，必须正确展开 `::` ---
assert.equal(normalizeIpForBinding('2a01:4f8:c17:b8f::1'), '2a01:4f8:c17:b8f::/64');
assert.equal(
  normalizeIpForBinding('2a01::1'),
  '2a01:0:0:0::/64',
  '`::` 必须先展开——朴素 split 会把这里误算成 2a01:0:1:0',
);
assert.equal(normalizeIpForBinding('::1'), '0:0:0:0::/64');
assert.equal(
  normalizeIpForBinding('2001:0db8:0000:0000:0000:0000:0000:0001'),
  '2001:db8:0:0::/64',
  '未压缩写法要归一到同一规范形式',
);
assert.equal(
  normalizeIpForBinding('2001:db8::1'),
  normalizeIpForBinding('2001:0db8:0000:0000:0000:0000:0000:0001'),
  '压缩与未压缩写法必须归一到同一结果',
);
assert.equal(
  normalizeIpForBinding('2A01:4F8:C17:B8F::1'),
  '2a01:4f8:c17:b8f::/64',
  '大小写不敏感',
);
assert.equal(normalizeIpForBinding('fe80::1%eth0'), 'fe80:0:0:0::/64', 'zone id 要剥掉');
assert.equal(normalizeIpForBinding('[2a01:4f8:c17:b8f::1]'), '2a01:4f8:c17:b8f::/64', '方括号要剥掉');
assert.equal(
  normalizeIpForBinding('2a01:4f8:c17:b8f::1'),
  normalizeIpForBinding('2a01:4f8:c17:b8f:aaaa:bbbb:cccc:dddd'),
  '同 /64 内不同接口标识必须归一到同一网段',
);
assert.notEqual(
  normalizeIpForBinding('2a01:4f8:c17:b8f::1'),
  normalizeIpForBinding('2a01:4f8:c17:b90::1'),
  '不同 /64 必须区分开',
);

// --- 退化输入 ---
assert.equal(normalizeIpForBinding(''), '');
assert.equal(normalizeIpForBinding('   '), '');
assert.equal(normalizeIpForBinding('unknown'), 'unknown', '非 IP 值原样返回，仍可精确比对');
assert.equal(normalizeIpForBinding('1.2.3'), '1.2.3', '残缺 IPv4 原样返回');

// --- 端到端：同网段放行，跨网段拒绝 ---
const { token } = await createViewerToken({ ip: '1.2.3.4', secret: SECRET, ttlMs: 60_000 });

assert.equal(
  await verifyViewerToken({ token, ip: '1.2.3.4', secret: SECRET }),
  true,
  '同一 IP 必须放行',
);
assert.equal(
  await verifyViewerToken({ token, ip: '1.2.3.99', secret: SECRET }),
  true,
  '同 /24 内换 IP 必须放行——这正是双栈/CGNAT 用户被误伤的场景',
);
assert.equal(
  await verifyViewerToken({ token, ip: '1.2.9.4', secret: SECRET }),
  false,
  '跨网段必须拒绝——防滥用能力要保留',
);
assert.equal(
  await verifyViewerToken({ token, ip: '1.2.3.4', secret: 'a-different-secret-of-sufficient-length!!' }),
  false,
  '签名不符必须拒绝',
);
assert.equal(
  await verifyViewerToken({ token, ip: '1.2.3.4', secret: SECRET, now: Date.now() + 120_000 }),
  false,
  '过期必须拒绝',
);

// --- 旧格式 token（明文 IP）应失败一次，前端重连即恢复 ---
const legacy = await createViewerToken({ ip: '1.2.3.4', secret: SECRET, ttlMs: 60_000 });
const legacyPayload = JSON.parse(
  Buffer.from(legacy.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
);
assert.equal(legacyPayload.ip, '1.2.3.0/24', '新签发的 token 内嵌的应是网段而非明文 IP');

console.log('viewer-token.test.mjs: all assertions passed');
