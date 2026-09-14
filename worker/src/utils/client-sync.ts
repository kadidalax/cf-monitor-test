import type { Bindings } from '../index';
import * as db from '../db/queries';

export class ClientSynchronizationError extends Error {
  constructor() {
    super('Client changes are saved; durable synchronization is pending');
    this.name = 'ClientSynchronizationError';
  }
}

/** SQL records the intent in the same transaction as the client mutation. */
export async function synchronizePendingClientChanges(
  database: db.QueryDatabase,
  env: Pick<Bindings, 'LIVE_DATA'>,
  options: { uuids?: string[]; limit?: number; drain?: boolean } = {},
): Promise<number> {
  let synchronized = 0;
  const stub = env.LIVE_DATA.get(env.LIVE_DATA.idFromName('global'));
  const limit = Math.min(200, options.limit ?? options.uuids?.length ?? (options.drain ? 200 : 10));
  for (let batch = 0; batch < (options.drain ? 10 : 1); batch++) {
    const pending = await db.listPendingClientSyncs(database, { uuids: options.uuids, limit });
    if (pending.length === 0) return synchronized;
    const response = await stub.fetch(new Request('https://do/client-sync/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: pending }),
    }));
    const body = await response.json().catch(() => null) as { success?: unknown; applied?: Array<{ uuid?: unknown; revision?: unknown }> } | null;
    if (!response.ok || body?.success !== true || !Array.isArray(body.applied) || body.applied.length !== pending.length ||
      body.applied.some((item, index) => item.uuid !== pending[index].uuid || item.revision !== pending[index].revision)) {
      throw new ClientSynchronizationError();
    }
    // An old response must not clear a newer change queued during the await.
    if (await db.acknowledgeClientSyncs(database, pending.map(({ uuid, revision }) => ({ uuid, revision }))) !== pending.length) {
      throw new ClientSynchronizationError();
    }
    synchronized += pending.length;
  }
  if ((options.uuids || options.drain) && (await db.listPendingClientSyncs(database, { uuids: options.uuids, limit: 1 })).length > 0) {
    throw new ClientSynchronizationError();
  }
  return synchronized;
}
