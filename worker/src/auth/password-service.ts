import type { Bindings } from '../index';

function passwordStub(env: Bindings, account: string) {
  if (typeof account !== 'string' || !account || account.length > 256) {
    throw new Error('Invalid password account');
  }
  return env.RATE_LIMIT.getByName(`password:${account}`);
}

export async function hashAdminPassword(env: Bindings, account: string, password: string): Promise<string> {
  try {
    const hash = await passwordStub(env, account).hashPassword(password);
    if (typeof hash !== 'string' || !hash || hash.length > 1024) throw new Error('Invalid password RPC result');
    return hash;
  } catch {
    // RPC failures must not run the KDF in the entry Worker or expose its inputs.
    throw new Error('Password service unavailable');
  }
}

export async function verifyAdminPassword(env: Bindings, account: string, password: string, hash: string): Promise<boolean> {
  try {
    const valid = await passwordStub(env, account).verifyPassword(password, hash);
    if (typeof valid !== 'boolean') throw new Error('Invalid password RPC result');
    return valid;
  } catch {
    throw new Error('Password service unavailable');
  }
}
