const encoder = new TextEncoder();
const TOKEN_TTL_MS = 60_000;

type ViewerTokenPayload = {
  exp: number;
  ip: string;
  nonce: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

function randomNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * 把出口 IP 归一化到网段再做绑定。
 *
 * 严格相等会误伤双栈（浏览器可能一次走 IPv4、一次走 IPv6）、多出口 VPN、
 * CGNAT 与移动网络切换的用户——取证与建连之间换了出口就必然 403，
 * 前端随即永久退化为 HTTP 轮询。
 *
 * 该 token 不是权限边界（隐藏客户端另行校验管理员会话），仅用于防滥用，
 * 因此放宽到网段仍保留"证不可跨网络转发"的核心能力。
 */
export function normalizeIpForBinding(ip: string): string {
  const value = (ip || '').trim().toLowerCase();
  if (!value) return '';

  if (value.includes(':')) {
    // IPv6 → /64。必须先把 `::` 展开，否则 `2a01::1` 会被误算成 `2a01:0:1:0`。
    const addr = value.split('%')[0].replace(/^\[|\]$/g, '');
    const compressed = addr.includes('::');
    const [headText, tailText] = addr.split('::');
    const head = (headText || '').split(':').filter(Boolean);
    const tail = compressed ? (tailText || '').split(':').filter(Boolean) : [];
    const groups = compressed
      ? [...head, ...new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
      : head;

    const prefix: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const hextet = Number.parseInt(groups[i] ?? '0', 16);
      prefix.push(Number.isFinite(hextet) ? hextet.toString(16) : '0');
    }
    return `${prefix.join(':')}::/64`;
  }

  const octets = value.split('.');
  if (octets.length !== 4) return value;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

export async function createViewerToken({
  ip,
  secret,
  ttlMs = TOKEN_TTL_MS,
  now = Date.now(),
}: {
  ip: string;
  secret: string;
  ttlMs?: number;
  now?: number;
}): Promise<{ token: string; expires_at: number }> {
  const boundedTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : TOKEN_TTL_MS;
  const payload: ViewerTokenPayload = {
    exp: now + boundedTtlMs,
    ip: normalizeIpForBinding(ip),
    nonce: randomNonce(),
  };
  const payloadText = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signPayload(payloadText, secret);
  return {
    token: `${payloadText}.${signature}`,
    expires_at: payload.exp,
  };
}

export async function verifyViewerToken({
  token,
  ip,
  secret,
  now = Date.now(),
}: {
  token: string;
  ip: string;
  secret: string;
  now?: number;
}): Promise<boolean> {
  const [payloadText, signature, extra] = token.split('.');
  if (!payloadText || !signature || extra !== undefined) return false;

  const expectedSignature = await signPayload(payloadText, secret);
  if (!constantTimeEqual(signature, expectedSignature)) return false;

  const payloadBytes = base64UrlToBytes(payloadText);
  if (!payloadBytes) return false;

  let payload: ViewerTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return false;
  }

  if (typeof payload.exp !== 'number' || payload.exp < now) return false;
  // 网段绑定：旧格式（明文 IP）的 token 会在此失败一次，前端重连即恢复。
  if (typeof payload.ip !== 'string' || payload.ip !== normalizeIpForBinding(ip)) return false;
  if (typeof payload.nonce !== 'string' || payload.nonce.length < 16) return false;
  return true;
}
