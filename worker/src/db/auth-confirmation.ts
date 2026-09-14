import type { AppDatabase } from './provider';
import { callSupabaseRpc } from './supabase-api/client';

export interface MfaFactorConfirmation {
  verified: boolean;
  verified_at?: string;
}

export async function consumeMfaFactor(database: AppDatabase, input: {
  userId: string; sessionVersion: number; operationId: string; factorKey: string;
  method: 'totp' | 'recovery_code'; step?: number; codeHashes?: string[];
}): Promise<MfaFactorConfirmation> {
  const result = await callSupabaseRpc<unknown>(database.env, 'cfm_consume_mfa_factor', {
    input_uuid: input.userId, input_session_version: input.sessionVersion,
    input_operation_id: input.operationId, input_factor_key: input.factorKey,
    input_method: input.method, input_step: input.step, input_code_hashes: input.codeHashes,
  });
  if (!result || typeof result !== 'object' || !('verified' in result) || typeof result.verified !== 'boolean') {
    throw new Error('MFA confirmation was not acknowledged');
  }
  if (!result.verified) return { verified: false };
  if (!('verified_at' in result) || typeof result.verified_at !== 'string' || !Number.isFinite(Date.parse(result.verified_at))) {
    throw new Error('MFA confirmation timestamp is invalid');
  }
  return { verified: true, verified_at: result.verified_at };
}

export async function rehashUserPassword(database: AppDatabase, uuid: string, expectedHash: string, nextHash: string): Promise<boolean> {
  return await callSupabaseRpc<unknown>(database.env, 'cfm_rehash_user_password', {
    input_uuid: uuid, input_expected_passwd: expectedHash, input_passwd: nextHash,
  }) === true;
}

export async function reencryptTotpSecret(database: AppDatabase, uuid: string, expectedSecret: string, nextSecret: string): Promise<boolean> {
  return await callSupabaseRpc<unknown>(database.env, 'cfm_reencrypt_totp_secret', {
    input_uuid: uuid, input_expected_secret: expectedSecret, input_secret_enc: nextSecret,
  }) === true;
}
