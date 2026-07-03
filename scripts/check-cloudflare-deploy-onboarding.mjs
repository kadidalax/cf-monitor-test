import { existsSync, readFileSync } from 'node:fs';

const requiredTemplateKeys = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
];

const checks = [
  ['.dev.vars.example', requiredTemplateKeys],
  ['worker/.dev.vars.example', requiredTemplateKeys],
  ['README.md', [
    'Deploy to Cloudflare',
    'Settings -> Variables & Secrets',
    '`SUPABASE_URL` | Variable',
    '`SUPABASE_SERVICE_ROLE_KEY` | Secret',
    '首次部署后访问 `/admin/login`',
    '忘记账号或密码',
    'MIT License',
  ]],
  ['package.json', [
    '"license": "MIT"',
    'Supabase 项目的 Project URL',
    '后台登录会话签名密钥',
  ]],
  ['wrangler.toml', ['SUPABASE_URL = "https://PROJECT_REF.supabase.co"']],
  ['worker/wrangler.toml', ['SUPABASE_URL = "https://PROJECT_REF.supabase.co"']],
  ['frontend/package.json', ['"license": "MIT"']],
  ['worker/package.json', ['"license": "MIT"']],
  ['LICENSE', ['MIT License', 'CF VPS Monitor contributors']],
];

const forbiddenReadmeNeedles = [
  'DATABASE_URL',
  'POSTGRES_*',
  'Hyperdrive',
  '创建应用程序 -> Continue with GitHub',
  '变量输入框',
  'Agent Token 最大有效天数',
  '初始化后仍允许查看完整',
];

const removedRuntimeEnvKeys = [
  'AGENT_TOKEN_' + 'MAX_AGE_DAYS',
  'SETUP_DIAGNOSTICS_' + 'TOKEN',
];

const removedRuntimeFiles = [
  'worker/src/utils/agent-token-policy.ts',
  'worker/src/utils/setup-diagnostics-token.ts',
];

const runtimeConfigFiles = [
  '.dev.vars.example',
  'worker/.dev.vars.example',
  'worker/src/index.ts',
  'worker/src/routes/setup.ts',
  'worker/src/routes/admin.ts',
  'package.json',
];

let failed = false;
for (const [file, needles] of checks) {
  const text = readFileSync(file, 'utf8');
  for (const needle of needles) {
    if (!text.includes(needle)) {
      console.error(`${file} is missing ${needle}`);
      failed = true;
    }
  }
}

const readme = readFileSync('README.md', 'utf8');
for (const needle of forbiddenReadmeNeedles) {
  if (readme.includes(needle)) {
    console.error(`README.md must not mention ${needle}`);
    failed = true;
  }
}

for (const file of removedRuntimeFiles) {
  if (existsSync(file)) {
    console.error(`${file} should be removed`);
    failed = true;
  }
}

for (const file of runtimeConfigFiles) {
  const text = readFileSync(file, 'utf8');
  for (const key of removedRuntimeEnvKeys) {
    if (text.includes(key)) {
      console.error(`${file} must not reference removed runtime setting ${key}`);
      failed = true;
    }
  }
}

for (const file of ['.dev.vars.example', 'worker/.dev.vars.example']) {
  const text = readFileSync(file, 'utf8');
  if (/^SUPABASE_URL\s*=/m.test(text)) {
    console.error(`${file} must not define SUPABASE_URL; wrangler.toml [vars] already defines it`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('cloudflare deploy onboarding check passed');
