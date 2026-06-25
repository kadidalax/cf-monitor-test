import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import test from 'node:test';

const srcDir = join(import.meta.dirname, '..', 'src');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (stats.isFile() && sourceExtensions.has(extname(path))) {
      files.push(path);
    }
  }
  return files;
}

test('frontend avoids dangerous HTML and dynamic code execution APIs', () => {
  const findings: string[] = [];
  const patterns = [
    [/\bdangerouslySetInnerHTML\b/, 'dangerouslySetInnerHTML'],
    [/\beval\s*\(/, 'eval'],
    [/\bnew\s+Function\s*\(/, 'new Function'],
    [/\bFunction\s*\(/, 'Function constructor'],
  ] as const;

  for (const file of listSourceFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, '/');
    const source = readFileSync(file, 'utf8');
    for (const [pattern, label] of patterns) {
      if (pattern.test(source)) findings.push(`${rel}: ${label}`);
    }
  }

  assert.deepEqual(findings, []);
});

test('frontend does not persist auth secrets in browser storage', () => {
  const findings: string[] = [];
  const storageWritePattern = /\b(?:localStorage|sessionStorage)\.setItem\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const sensitiveKeyPattern = /\b(?:auth|jwt|password|secret|session|token|csrf)\b/i;

  for (const file of listSourceFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, '/');
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(storageWritePattern)) {
      const key = match[1] || '';
      if (sensitiveKeyPattern.test(key)) findings.push(`${rel}: ${key}`);
    }
  }

  assert.deepEqual(findings, []);
});

test('logout request sends CSRF header without storing auth secrets', () => {
  const authContext = readFileSync(join(srcDir, 'contexts', 'AuthContext.tsx'), 'utf8');
  assert.match(authContext, /const csrfToken = readCookie\(CSRF_COOKIE_NAME\)/);
  assert.match(authContext, /headers\.set\('X-CSRF-Token', csrfToken\)/);
  assert.match(authContext, /fetch\(`\$\{API_BASE\}\/logout`, \{[\s\S]*?headers,/);
});

test('admin API callers share the common request builder', () => {
  const authContext = readFileSync(join(srcDir, 'contexts', 'AuthContext.tsx'), 'utf8');
  const settingsSite = readFileSync(join(srcDir, 'pages', 'admin', 'SettingsSite.tsx'), 'utf8');
  const api = readFileSync(join(srcDir, 'utils', 'api.ts'), 'utf8');

  assert.match(api, /export function buildApiRequest/);
  assert.match(authContext, /buildApiRequest\(path, options\)/);
  assert.doesNotMatch(authContext, /function isUnsafeMethod/);
  assert.match(settingsSite, /buildApiRequest\('\/admin\/download\/backup'/);
  assert.doesNotMatch(settingsSite, /function readCookie/);
});

test('auth session probe uses one server validation request', () => {
  const authContext = readFileSync(join(srcDir, 'contexts', 'AuthContext.tsx'), 'utf8');
  assert.doesNotMatch(authContext, /method: 'HEAD'/);
  assert.doesNotMatch(authContext, /X-CF-Monitor-Authenticated/);
  assert.match(authContext, /fetch\(`\$\{API_BASE\}\/me`, \{[\s\S]*?credentials: 'same-origin'/);
  assert.match(authContext, /const nextUser = normalizeAuthUser\(data\)/);
  assert.match(authContext, /\}, \[clearAuth, location\.pathname\]\)/);
  assert.doesNotMatch(authContext, /\}, \[clearAuth, location\.pathname, user\]\)/);
});

test('logged-in admin pages warm start from non-secret cached user state', () => {
  const authContext = readFileSync(join(srcDir, 'contexts', 'AuthContext.tsx'), 'utf8');
  const login = readFileSync(join(srcDir, 'pages', 'Login.tsx'), 'utf8');
  assert.match(authContext, /AUTH_USER_STORAGE_KEY = 'cf_monitor_user'/);
  assert.match(authContext, /const initialUser = readStoredUser\(\)/);
  assert.match(authContext, /useState<User \| null>\(initialUser\)/);
  assert.match(authContext, /useState\(!initialUser\)/);
  assert.match(authContext, /writeStoredUser\(nextUser\)/);
  assert.match(authContext, /clearStoredUser\(\)/);
  assert.match(login, /authLoading/);
  assert.match(login, /if \(authLoading\) return <Loading \/>/);
});

test('cached admin user avoids login flash but still validates the server session', () => {
  const authContext = readFileSync(join(srcDir, 'contexts', 'AuthContext.tsx'), 'utf8');
  assert.match(authContext, /setAuthLoading\(true\)/);
  assert.doesNotMatch(authContext, /pathname\.startsWith\('\/admin'\) && user[\s\S]*?return/);
  assert.match(authContext, /fetch\(`\$\{API_BASE\}\/me`, \{[\s\S]*?credentials: 'same-origin'/);
  assert.match(authContext, /setUser\(\(current\) => current && current\.uuid === nextUser\.uuid && current\.username === nextUser\.username \? current : nextUser\)/);
});

test('public backend shortcut goes through admin guard instead of flashing login', () => {
  const layout = readFileSync(join(srcDir, 'pages', 'Layout.tsx'), 'utf8');
  assert.match(layout, /const enterBackend = \(\) => \{[\s\S]*navigate\("\/admin"\);[\s\S]*\};/);
  assert.doesNotMatch(layout, /navigate\(isAuthenticated \? "\/admin" : "\/login"\)/);
});

test('toast notifications avoid top-right admin action buttons', () => {
  const app = readFileSync(join(srcDir, 'App.tsx'), 'utf8');
  assert.match(app, /<Toaster[\s\S]{0,120}position="bottom-right"/);
  assert.doesNotMatch(app, /position="top-right"/);
});

test('route chunks preload after public data loads instead of competing with first-page API', () => {
  const app = readFileSync(join(srcDir, 'App.tsx'), 'utf8');
  const publicDataEvents = readFileSync(join(srcDir, 'utils', 'publicDataEvents.ts'), 'utf8');
  assert.match(app, /const loadIndex = \(\) => import\('\.\/pages\/Index'\)/);
  assert.match(app, /const Index = lazy\(loadIndex\)/);
  assert.match(app, /function preloadRouteChunks\(\)/);
  assert.match(app, /requestIdleCallback/);
  assert.match(app, /void loadAdminDashboard\(\)/);
  assert.match(app, /PUBLIC_DATA_READY_EVENT/);
  assert.match(app, /window\.addEventListener\(PUBLIC_DATA_READY_EVENT, schedulePreload/);
  assert.match(app, /window\.setTimeout\(schedulePreload, 30_000\)/);
  assert.doesNotMatch(app, /const preload = \(\) => preloadRouteChunks\(\)/);
  assert.match(publicDataEvents, /PUBLIC_DATA_READY_EVENT/);
});

test('public bootstrap reads retry while the Worker initializes Postgres', () => {
  const api = readFileSync(join(srcDir, 'utils', 'api.ts'), 'utf8');
  const publicBootstrap = readFileSync(join(srcDir, 'utils', 'publicBootstrap.ts'), 'utf8');
  const publicSettings = readFileSync(join(srcDir, 'utils', 'publicSettings.ts'), 'utf8');
  const indexPage = readFileSync(join(srcDir, 'pages', 'Index.tsx'), 'utf8');

  assert.match(api, /export async function fetchWithBootstrapRetry/);
  assert.match(api, /response\.status !== 202 && response\.status !== 503/);
  assert.match(api, /bootstrap\|Database is not ready/i);
  assert.match(publicBootstrap, /fetchWithBootstrapRetry\(`\$\{url\.pathname\}\$\{url\.search\}`/);
  assert.match(publicSettings, /fetchWithBootstrapRetry\(publicSettingsUrl/);
  assert.match(indexPage, /fetchWithBootstrapRetry\('\/api\/clients'/);
});

test('backup export UI communicates the six-character password requirement', () => {
  const settingsSite = readFileSync(join(srcDir, 'pages', 'admin', 'SettingsSite.tsx'), 'utf8');
  assert.match(settingsSite, /至少 6 位/);
  assert.doesNotMatch(settingsSite, /至少 12 字节|至少 16 字节/);
});

test('notification admin page keeps response list state typed', () => {
  const notifications = readFileSync(join(srcDir, 'pages', 'admin', 'Notifications.tsx'), 'utf8');
  assert.match(notifications, /type OfflineNotification/);
  assert.match(notifications, /type ExpiryNotification/);
  assert.match(notifications, /type LoadNotification/);
  assert.doesNotMatch(notifications, /useState<any\[\]>/);
  assert.doesNotMatch(notifications, /\(item: any\)/);
  assert.doesNotMatch(notifications, /\(n: any\)/);
});
