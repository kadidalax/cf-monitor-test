import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { readAcceptedCount, readClientReportResult, readLiveSnapshot, readRateLimitResult } from '../src/utils/do-response.ts';
import { redactDatabaseSecrets, sanitizeSetupDiagnosticDetail } from '../src/utils/setup-diagnostics.ts';
import { generateAgentToken, hashAgentToken, isAgentTokenHash, isAgentTokenShape, validateClientCreateInput } from '../src/utils/client.ts';
import { getCloudflareClientIp, isPublicIpAddress } from '../src/utils/request-ip.ts';
import { TELEGRAM_MESSAGE_MAX_CHARS, formatTelegramHtmlText } from '../src/utils/telegram.ts';

const dbQueries = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'queries.ts'), 'utf8');
const supabaseClient = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'supabase-api', 'client.ts'), 'utf8');
const providerSource = readFileSync(join(import.meta.dirname, '..', 'src', 'db', 'provider.ts'), 'utf8');
const publicRoutes = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'public.ts'), 'utf8');
const clientRoutes = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'client.ts'), 'utf8');
const themeRoutes = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'theme.ts'), 'utf8');
const setupRoutes = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'setup.ts'), 'utf8');
const adminRoutes = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8');
const workerIndex = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
const liveDataDo = readFileSync(join(import.meta.dirname, '..', 'src', 'do', 'live-data.ts'), 'utf8');
const observabilitySource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'observability.ts'), 'utf8');
const requestIpSource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'request-ip.ts'), 'utf8');
const agentTokenPolicySource = readFileSync(join(import.meta.dirname, '..', 'src', 'utils', 'agent-token-policy.ts'), 'utf8');
const staticHeaders = readFileSync(join(import.meta.dirname, '..', '..', 'frontend', 'public', '_headers'), 'utf8');

test('setup diagnostics redact database URLs, Supabase keys, tokens, and bearer headers', () => {
  const secret = 'service-role-secret';
  const databaseUrl = `${'postgres'}://admin:${'secret-pass'}@db.example.com:5432/app?sslmode=require`;
  const error = new Error([
    `connect ${databaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${secret}`,
    'Authorization: Bearer bearer-secret-token',
    'https://example.com/api?setup_token=setup-secret&viewer_token=viewer-secret',
    'telegram_bot_token=telegram-secret',
  ].join(' '));
  const detail = sanitizeSetupDiagnosticDetail(error);

  for (const leaked of ['secret-pass', secret, 'bearer-secret-token', 'setup-secret', 'viewer-secret', 'telegram-secret']) {
    assert.equal(detail.includes(leaked), false);
  }
  assert.match(detail, /\[DATABASE_CONNECTION\]/);
  assert.match(detail, /SUPABASE_SERVICE_ROLE_KEY=\[REDACTED\]/i);
  assert.match(detail, /Authorization: Bearer \[REDACTED\]/i);
  assert.match(detail, /setup_token=\[REDACTED\]/);
  assert.match(detail, /viewer_token=\[REDACTED\]/);
});

test('JSON-shaped audit details are redacted before persistence', () => {
  const detail = redactDatabaseSecrets(JSON.stringify({
    token: 'plain-token-value',
    token_hash: 'sha256:abcdef',
    client_secret: 'oauth-secret-value',
    telegram_chat_id: 'chat-secret-value',
    note: 'safe-note',
  }));

  for (const leaked of ['plain-token-value', 'sha256:abcdef', 'oauth-secret-value', 'chat-secret-value']) {
    assert.equal(detail.includes(leaked), false);
  }
  assert.equal(detail.includes('safe-note'), true);
  assert.match(dbQueries, /redactDatabaseSecrets\(detail\)/);
});

test('database facade is Supabase HTTP RPC only', () => {
  assert.match(providerSource, /export type DatabaseProvider = 'supabase-api'/);
  assert.match(dbQueries, /import \* as sba from '\.\/supabase-api\/client'/);
  assert.match(supabaseClient, /\/rest\/v1\/rpc\//);
  for (const source of [providerSource, dbQueries, supabaseClient]) {
    assert.doesNotMatch(source, /database\.sql|pg\.|from '\.\/postgres|from '\.\.\/db\/postgres/);
  }
});

test('agent policy keeps realtime and background upload intervals distinct', () => {
  assert.match(liveDataDo, /activeIntervalSec: 3/);
  assert.match(liveDataDo, /idleIntervalSec: 120/);
  assert.match(liveDataDo, /viewerCount > 0 \? 'active' : 'idle'/);
  assert.match(liveDataDo, /sample_interval_sec: mode === 'active' \? settings\.activeIntervalSec : settings\.idleIntervalSec/);
  assert.match(liveDataDo, /report_interval_sec: mode === 'active' \? settings\.activeIntervalSec : settings\.idleIntervalSec/);
  assert.match(liveDataDo, /pingIntervalSec: 120/);
  assert.match(clientRoutes, /sample_interval_sec: Math\.floor\(reportIntervalSec\)/);
  assert.match(clientRoutes, /report_interval_sec: Math\.floor\(reportIntervalSec\)/);
  assert.match(clientRoutes, /ping_interval_sec: Math\.floor\(pingIntervalSec\)/);
});

test('Durable Object JSON responses are parsed through typed helpers', async () => {
  assert.match(clientRoutes, /readClientReportResult\(response\)/);
  assert.match(clientRoutes, /readAcceptedCount\(doResponse\)/);
  assert.match(publicRoutes, /readLiveSnapshot\(response\)/);

  assert.deepEqual(await readLiveSnapshot(new Response(JSON.stringify({ online: [], count: 0 }))), { online: [], count: 0 });
  assert.equal(await readLiveSnapshot(new Response(JSON.stringify({ online: {}, count: 0 }))), null);
  assert.deepEqual(await readClientReportResult(new Response(JSON.stringify({ persisted: true }))), { persisted: true });
  assert.equal(await readClientReportResult(new Response(JSON.stringify({ persisted: 'true' }))), null);
  assert.equal(await readAcceptedCount(new Response(JSON.stringify({ accepted: '2.9' }))), 2);
  assert.equal(await readAcceptedCount(new Response(JSON.stringify({ accepted: -1 }))), null);
  assert.deepEqual(
    await readRateLimitResult(new Response(JSON.stringify({
      allowed: false,
      limit: '0',
      remaining: '-2',
      retry_after: '2.2',
      reset: '3.1',
    })), { limit: 10, remaining: 10 }),
    { allowed: false, limit: 1, remaining: 0, retryAfter: 3, reset: 4 },
  );
});

test('admin and public write routes use bounded JSON parsers', () => {
  assert.match(adminRoutes, /const MAX_ADMIN_JSON_BYTES = 256 \* 1024/);
  assert.match(adminRoutes, /function isJsonObjectBody/);
  assert.match(adminRoutes, /readJsonWithLimit\(c\.req\.raw, maxBytes\)/);
  assert.match(publicRoutes, /const MAX_PUBLIC_JSON_BYTES = 8 \* 1024/);
  assert.match(publicRoutes, /readJsonWithLimit\(c\.req\.raw, MAX_PUBLIC_JSON_BYTES\)/);
  assert.match(themeRoutes, /const MAX_THEME_JSON_BYTES = 256 \* 1024/);
  assert.match(themeRoutes, /readRequestBytesWithLimit\(c\.req\.raw, MAX_THEME_ZIP_BYTES \+ 4096\)/);
  for (const source of [adminRoutes, publicRoutes, themeRoutes]) {
    assert.doesNotMatch(source, /await c\.req\.json\(\)/);
  }
});

test('agent token utilities generate opaque hashed credentials', async () => {
  const token = generateAgentToken();
  assert.equal(isAgentTokenShape(token), true);
  const hash = await hashAgentToken(token);
  assert.equal(isAgentTokenHash(hash), true);
  assert.equal(hash.includes(token), false);
  assert.equal(validateClientCreateInput({ uuid: 'node-1', name: 'Node 1', token }).ok, true);
});

test('request IP and telegram helpers keep public boundaries explicit', () => {
  assert.match(requestIpSource, /CF-Connecting-IP/);
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('10.0.0.1'), false);
  const request = new Request('https://example.test', {
    headers: { 'CF-Connecting-IP': '8.8.8.8' },
  });
  const fakeContext = { req: { header: (name: string) => request.headers.get(name) || undefined } };
  assert.equal(getCloudflareClientIp(fakeContext, ''), '8.8.8.8');

  const formatted = formatTelegramHtmlText('<b>x</b>');
  assert.match(formatted, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(TELEGRAM_MESSAGE_MAX_CHARS > 0);
});

test('Worker startup and health paths sanitize details and expose Supabase mode', () => {
  assert.match(workerIndex, /sanitizeSetupDiagnosticDetail\(error\)/);
  assert.match(setupRoutes, /Supabase RPC/);
  assert.match(adminRoutes, /Supabase HTTP API\/RPC configured/);
  assert.match(observabilitySource, /sanitizeSetupDiagnosticDetail\(error\)/);
  assert.match(agentTokenPolicySource, /AGENT_TOKEN_MAX_AGE_DAYS/);
});

test('browser-facing static headers keep a conservative security baseline', () => {
  assert.match(staticHeaders, /X-Content-Type-Options: nosniff/);
  assert.match(staticHeaders, /Referrer-Policy:/);
  assert.match(staticHeaders, /Permissions-Policy:/);
});
