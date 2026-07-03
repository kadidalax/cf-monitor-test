import { readFileSync } from 'node:fs';

const requiredTemplateKeys = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
];

const checks = [
  ['.dev.vars.example', requiredTemplateKeys],
  ['worker/.dev.vars.example', requiredTemplateKeys],
  ['README.md', [
    'Deploy to Cloudflare',
    'Dashboard 连接 GitHub 仓库部署',
    'Settings -> Variables & Secrets',
    '`SUPABASE_URL` | Variable',
    '`SUPABASE_SERVICE_ROLE_KEY` | Secret',
  ]],
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

if (failed) process.exit(1);
console.log('cloudflare deploy onboarding check passed');
