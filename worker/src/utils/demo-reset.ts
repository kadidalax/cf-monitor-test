import * as db from '../db/queries';
import { hashPassword, validateAdminPasswordStrength } from '../auth/password';
import { isDemoResetEnabled, shouldRunDemoReset } from './demo-reset-schedule';

export const DEMO_RESET_INTERVAL_MS = 30 * 60 * 1000;

type DemoResetEnv = {
  DEMO_RESET_ENABLED?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
};

function readDemoAdmin(env: DemoResetEnv): { username: string; password: string } {
  const username = env.ADMIN_USERNAME?.trim() || '';
  const password = env.ADMIN_PASSWORD || '';
  if (!username || validateAdminPasswordStrength(password, username)) {
    throw new Error('DEMO_RESET admin secrets are invalid');
  }
  return { username, password };
}

export async function runDemoResetIfDue(
  database: db.QueryDatabase,
  env: DemoResetEnv,
  now = Date.now(),
): Promise<boolean> {
  const enabled = isDemoResetEnabled(env.DEMO_RESET_ENABLED);
  if (!enabled) return false;

  const state = await db.getDemoResetState(database);
  if (!shouldRunDemoReset({
    enabled,
    snapshotExists: Boolean(state?.snapshot_exists),
    lastRestoredAt: state?.last_restored_at || null,
    now,
    intervalMs: DEMO_RESET_INTERVAL_MS,
  })) {
    return false;
  }

  const snapshot = await db.getDemoSnapshot(database);
  if (!snapshot) return false;

  const { username, password } = readDemoAdmin(env);
  await db.restoreBackupData(database, snapshot);
  await db.resetAdminUsers(database, {
    uuid: crypto.randomUUID(),
    username,
    hashedPassword: await hashPassword(password),
  });
  await db.markDemoResetRestored(database, new Date(now).toISOString());
  await db.insertAuditLog(database, 'system', 'demo_reset', 'Demo snapshot restored by scheduled reset');
  return true;
}
