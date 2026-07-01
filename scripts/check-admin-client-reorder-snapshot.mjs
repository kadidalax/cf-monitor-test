import { readFileSync } from 'node:fs';

const source = readFileSync('worker/src/routes/admin.ts', 'utf8');
const route = source.slice(source.indexOf("adminRoutes.post('/clients/reorder'"), source.indexOf("adminRoutes.post('/clients/batch-hide'"));

const checks = [
  [route.includes('listAdminClientsCached(database, true)'), 'client reorder must reload fresh admin clients'],
  [route.includes('writeAdminClientsSnapshot(c, refreshedClients)'), 'client reorder must refresh the admin clients snapshot'],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
