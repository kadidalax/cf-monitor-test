import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260702010000_public_website_order.sql', 'utf8');
const generated = readFileSync('worker/src/generated/supabase-migrations.ts', 'utf8');

const required = 'order by m.sort_order asc, m.id asc';
const failures = [
  [migration.includes(required), 'public website migration must order final jsonb_agg by sort_order'],
  [generated.includes('"version": "20260702010000_public_website_order"') && generated.includes(required), 'generated migrations must include public website order fix'],
].filter(([ok]) => !ok).map(([, message]) => message);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
