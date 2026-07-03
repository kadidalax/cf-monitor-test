import { readFileSync } from 'node:fs';

const rpc = readFileSync('supabase/migrations/20260622000000_rpc_api.sql', 'utf8');
const generated = readFileSync('worker/src/generated/supabase-migrations.ts', 'utf8');
const page = readFileSync('frontend/src/pages/admin/Websites.tsx', 'utf8');

const rpcStart = rpc.lastIndexOf('create or replace function public.cfm_reorder_website_monitors');
const rpcEnd = rpc.indexOf('create or replace function public.cfm_set_website_monitor_visibility', rpcStart);
const rpcBody = rpc.slice(rpcStart, rpcEnd);

const frontendStart = page.indexOf('const handleDragEnd = async');
const frontendEnd = page.indexOf('const remove = async');
const frontendBody = page.slice(frontendStart, frontendEnd);

const checks = [
  [rpcBody.includes('with ordinality'), 'website reorder RPC must preserve input order with ordinality'],
  [rpcBody.includes('min(ord)::integer as ord'), 'website reorder RPC must de-duplicate ids without losing first position'],
  [rpcBody.includes('order by i.ord asc'), 'website reorder RPC must write sort_order in submitted order'],
  [generated.includes('"version": "20260622000000_rpc_api"'), 'generated migrations must include website reorder order fix'],
  [frontendBody.includes('sort_order: index + 1'), 'website drag state must update local sort_order after reorder'],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
