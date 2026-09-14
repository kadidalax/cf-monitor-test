import { base32Encode } from './totp.ts';
import { requireJwtSecret } from './jwt.ts';

const encoder = new TextEncoder();
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_BYTES = 15;
const AES_IV_BYTES = 12;
const MFA_KDF_SALT = encoder.encode('cf-vps-monitor/mfa-key/v1');
const MFA_V2_KDF_SALT = encoder.encode('cf-vps-monitor/mfa-key/v2');

export type MfaEnv = { JWT_SECRET?: string; MFA_SECRET?: string; MFA_PREVIOUS_SECRET?: string; MFA_LEGACY_SECRET?: string };

export class MfaConfigurationError extends Error {
  constructor() {
    super('MFA encryption material is unavailable; verify the configured data keys');
    this.name = 'MfaConfigurationError';
  }
}

function configuredKey(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  const key = value.trim();
  if (encoder.encode(key).byteLength < 32) throw new MfaConfigurationError();
  return key;
}

function legacyKey(env: MfaEnv): string {
  return configuredKey(env.MFA_LEGACY_SECRET) || requireJwtSecret(env);
}

async function keyId(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
  return Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function independentKeys(env: MfaEnv): Promise<Array<{ id: string; secret: string }>> {
  const current = configuredKey(env.MFA_SECRET), previous = configuredKey(env.MFA_PREVIOUS_SECRET);
  if (previous && !current) throw new MfaConfigurationError();
  return Promise.all([...new Set([current, previous].filter((key): key is string => Boolean(key)))].map(async secret => ({ id: await keyId(secret), secret })));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function deriveKey(secret: string, version: 'v1' | 'v2', info: string, usages: Array<'encrypt' | 'decrypt' | 'sign'>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  const algorithm = info === 'totp-secret-encryption'
    ? { name: 'AES-GCM', length: 256 }
    : { name: 'HMAC', hash: 'SHA-256', length: 256 };
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: version === 'v2' ? MFA_V2_KDF_SALT : MFA_KDF_SALT, info: encoder.encode(info) },
    material,
    algorithm,
    false,
    usages,
  );
}

export async function encryptTotpSecret(secret: string, userId: string, env: MfaEnv): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const current = (await independentKeys(env))[0];
  const version = current ? 'v2' : 'v1';
  const prefix = current ? `v2.${current.id}` : 'v1';
  const key = await deriveKey(current?.secret || legacyKey(env), version, 'totp-secret-encryption', ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(current ? `${prefix}:${userId}` : userId), tagLength: 128 },
    key,
    encoder.encode(secret),
  ));
  return `${prefix}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

export async function decryptTotpSecret(ciphertext: string, userId: string, env: MfaEnv): Promise<string> {
  const parts = ciphertext.split('.');
  const version = parts[0];
  let secret: string, ivText: string, dataText: string, aad = userId;
  if (version === 'v1' && parts.length === 3) {
    secret = legacyKey(env); [, ivText, dataText] = parts;
  } else if (version === 'v2' && parts.length === 4 && /^[a-f0-9]{16}$/.test(parts[1])) {
    const selected = (await independentKeys(env)).find(key => key.id === parts[1]);
    if (!selected) throw new MfaConfigurationError();
    secret = selected.secret; [, , ivText, dataText] = parts; aad = `v2.${selected.id}:${userId}`;
  } else throw new MfaConfigurationError();
  try {
    if (!ivText || !dataText) throw new MfaConfigurationError();
    const iv = base64UrlToBytes(ivText);
    if (iv.length !== AES_IV_BYTES) throw new MfaConfigurationError();
    const key = await deriveKey(secret, version as 'v1' | 'v2', 'totp-secret-encryption', ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 }, key, base64UrlToBytes(dataText));
    return new TextDecoder().decode(plaintext);
  } catch { throw new MfaConfigurationError(); }
}

export async function needsTotpReencryption(ciphertext: string, env: MfaEnv): Promise<boolean> {
  const current = (await independentKeys(env))[0];
  return Boolean(current && !ciphertext.startsWith(`v2.${current.id}.`));
}

export function normalizeRecoveryCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z2-7]{24}$/.test(normalized)) throw new Error('恢复码格式无效');
  return normalized;
}

export async function hashRecoveryCode(code: string, env: MfaEnv): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  const current = (await independentKeys(env))[0];
  return recoveryHash(normalized, current?.secret || legacyKey(env), current?.id);
}

async function recoveryHash(normalized: string, secret: string, id?: string): Promise<string> {
  const key = await deriveKey(secret, id ? 'v2' : 'v1', 'totp-recovery-code-hmac', ['sign']);
  const digest = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(normalized))));
  return id ? `v2.${id}.${digest}` : digest;
}

export async function hashRecoveryCodeCandidates(code: string, env: MfaEnv): Promise<string[]> {
  const normalized = normalizeRecoveryCode(code);
  const keys = await independentKeys(env);
  const hashes = await Promise.all(keys.map(key => recoveryHash(normalized, key.secret, key.id)));
  // One-way legacy hashes cannot be re-encrypted. Retain this key until those
  // recovery codes are replaced, even after the TOTP ciphertext has migrated.
  hashes.push(await recoveryHash(normalized, legacyKey(env)));
  return [...new Set(hashes)];
}

function formatRecoveryCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join('-') || raw;
}

export async function generateRecoveryCodes(env: MfaEnv): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    formatRecoveryCode(base32Encode(crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES)))),
  );
  return { codes, hashes: await Promise.all(codes.map(code => hashRecoveryCode(code, env))) };
}
