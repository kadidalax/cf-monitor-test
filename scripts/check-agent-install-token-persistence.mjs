import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const adminRoutes = readFileSync('worker/src/routes/admin.ts', 'utf8');
const supabaseClient = readFileSync('worker/src/db/supabase-api/client.ts', 'utf8');
const migration = readdirSync('supabase/migrations')
  .filter(file => file.endsWith('.sql'))
  .sort()
  .map(file => readFileSync(join('supabase/migrations', file), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n');

assert.doesNotMatch(
  adminRoutes,
  /setClientInstallToken|function getOrCreateInstallToken[\s\S]*?generateUniqueClientToken/,
  'viewing an install command must not silently create a new token',
);

assert.match(
  supabaseClient,
  /input_client:\s*{[\s\S]*token,\s*[\s\S]*token_hash:\s*client\.token_hash\s*\|\|\s*await hashAgentToken\(token\)/,
  'client creation must persist the plaintext install token with its hash',
);

assert.match(
  supabaseClient,
  /cfm_rotate_client_token'[\s\S]*input_token:\s*token,[\s\S]*input_token_hash:\s*await hashAgentToken\(token\)/,
  'manual token rotation must persist the plaintext install token with its hash',
);

assert.match(
  migration,
  /create or replace function public\.cfm_create_client\([\s\S]*insert into clients \(uuid, token, token_hash[\s\S]*input_client->>'token'[\s\S]*input_client->>'token_hash'/i,
  'create client RPC must store token and token_hash from the Worker',
);

assert.match(
  migration,
  /create or replace function public\.cfm_rotate_client_token\(input_uuid text, input_token text, input_token_hash text\)[\s\S]*set token = input_token,[\s\S]*token_hash = input_token_hash/i,
  'rotate token RPC must store token and token_hash from the Worker',
);

console.log('agent install token persistence check passed');
