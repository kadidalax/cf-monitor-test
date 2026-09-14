import type { AppDatabase } from '../db/provider';
import type { User } from '../db/types';
import { consumeMfaFactor, reencryptTotpSecret, type MfaFactorConfirmation } from '../db/auth-confirmation';
import {
  decryptTotpSecret, encryptTotpSecret, hashRecoveryCodeCandidates,
  needsTotpReencryption, normalizeRecoveryCode, type MfaEnv,
} from './mfa';
import type { MfaTokenPurpose } from './mfa-token';
import { verifyTotpCode } from './totp';

async function digest(value: unknown[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function confirmUserMfaFactor(
  database: AppDatabase,
  user: User,
  input: { method: 'totp' | 'recovery_code'; code: string; purpose: MfaTokenPurpose; operationToken: string },
  env: MfaEnv,
  nowMs = Date.now(),
): Promise<MfaFactorConfirmation> {
  if (!user.totp_enabled_at || !user.totp_secret_enc || !input.operationToken) return { verified: false };
  let normalizedCode: string;
  if (input.method === 'totp') {
    normalizedCode = input.code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) return { verified: false };
  } else {
    try { normalizedCode = normalizeRecoveryCode(input.code); }
    catch { return { verified: false }; }
  }

  // Include the high-entropy challenge/session in both digests: a stored
  // acknowledgement must not expose an enumerable hash of a six-digit OTP.
  // Raw factors and tokens never leave this verification request.
  const scope = [user.uuid, user.session_version, input.purpose, input.operationToken, input.method];
  const factorKey = await digest(['mfa-factor/v1', ...scope, normalizedCode]);
  const operationId = await digest(['mfa-confirmation/v1', ...scope, factorKey]);
  let step: number | undefined;
  let codeHashes: string[] | undefined;
  if (input.method === 'totp') {
    const secret = await decryptTotpSecret(user.totp_secret_enc, user.uuid, env);
    const result = await verifyTotpCode(secret, normalizedCode, nowMs);
    step = result.valid ? result.step : undefined;
    if (result.valid && await needsTotpReencryption(user.totp_secret_enc, env)) {
      const encrypted = await encryptTotpSecret(secret, user.uuid, env);
      if (!await reencryptTotpSecret(database, user.uuid, user.totp_secret_enc, encrypted)) {
        throw new Error('MFA state changed during verification; retry with current account state');
      }
    }
  } else {
    codeHashes = await hashRecoveryCodeCandidates(normalizedCode, env);
  }

  // No valid current step means receipt lookup only. SQL can recover this
  // exact operation after a lost response, without accepting a new replay.
  return consumeMfaFactor(database, {
    userId: user.uuid, sessionVersion: user.session_version, operationId, factorKey,
    method: input.method, step, codeHashes,
  });
}
