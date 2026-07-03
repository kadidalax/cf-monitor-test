import { readFileSync } from 'node:fs';

const files = {
  rootVars: readFileSync('.dev.vars.example', 'utf8'),
  workerVars: readFileSync('worker/.dev.vars.example', 'utf8'),
  rootWrangler: readFileSync('wrangler.toml', 'utf8'),
  workerWrangler: readFileSync('worker/wrangler.toml', 'utf8'),
  deploy: readFileSync('scripts/deploy-cloudflare.mjs', 'utf8'),
  onboarding: readFileSync('scripts/check-cloudflare-deploy-onboarding.mjs', 'utf8'),
  packageJson: readFileSync('package.json', 'utf8'),
  publicRoutes: readFileSync('worker/src/routes/public.ts', 'utf8'),
  queries: readFileSync('worker/src/db/queries.ts', 'utf8'),
  supabaseClient: readFileSync('worker/src/db/supabase-api/client.ts', 'utf8'),
  loginPage: readFileSync('frontend/src/pages/Login.tsx', 'utf8'),
  readme: readFileSync('README.md', 'utf8'),
};

const forbiddenDeploymentAdminSecrets = [
  ['.dev.vars.example', files.rootVars],
  ['worker/.dev.vars.example', files.workerVars],
  ['wrangler.toml', files.rootWrangler],
  ['worker/wrangler.toml', files.workerWrangler],
  ['scripts/deploy-cloudflare.mjs', files.deploy],
  ['scripts/check-cloudflare-deploy-onboarding.mjs', files.onboarding],
  ['package.json cloudflare.bindings', files.packageJson],
];

let failed = false;

for (const [name, text] of forbiddenDeploymentAdminSecrets) {
  for (const secret of ['ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
    if (text.includes(secret)) {
      console.error(`${name} must not require ${secret} for deployment`);
      failed = true;
    }
  }
}

const requiredNeedles = [
  ['worker/src/routes/public.ts', files.publicRoutes, '/admin/recovery/status'],
  ['worker/src/routes/public.ts', files.publicRoutes, '/admin/recovery'],
  ['worker/src/routes/public.ts', files.publicRoutes, 'timingSafeEqualString'],
  ['worker/src/routes/public.ts', files.publicRoutes, 'admin_recovery'],
  ['worker/src/db/queries.ts', files.queries, 'recoverSingleAdmin'],
  ['worker/src/db/supabase-api/client.ts', files.supabaseClient, 'recoverSupabaseSingleAdmin'],
  ['frontend/src/pages/Login.tsx', files.loginPage, '创建管理员'],
  ['frontend/src/pages/Login.tsx', files.loginPage, '忘记密码'],
  ['frontend/src/pages/Login.tsx', files.loginPage, 'service_role'],
  ['frontend/src/pages/Login.tsx', files.loginPage, 'const needsServiceRoleKey = recoveryStatus?.admin_present === true'],
  ['frontend/src/pages/Login.tsx', files.loginPage, 'if (needsServiceRoleKey) payload.supabase_service_role_key = recoveryKey'],
  ['worker/src/routes/public.ts', files.publicRoutes, 'if (userCount === 1)'],
  ['README.md', files.readme, '首次部署后访问 `/admin/login`'],
  ['README.md', files.readme, '忘记账号或密码'],
];

for (const [name, text, needle] of requiredNeedles) {
  if (!text.includes(needle)) {
    console.error(`${name} is missing ${needle}`);
    failed = true;
  }
}

const userCountCheckIndex = files.publicRoutes.indexOf('const userCount = await db.countUsers(database);');
const serviceRoleCheckIndex = files.publicRoutes.indexOf('timingSafeEqualString(serviceRoleKey');
if (userCountCheckIndex < 0 || serviceRoleCheckIndex < userCountCheckIndex) {
  console.error('admin recovery must only require service_role key after counting existing admins');
  failed = true;
}

const migration = readFileSync('worker/src/generated/supabase-migrations.ts', 'utf8');
for (const needle of [
  'cfm_recover_single_admin',
  'revoke all on function public.cfm_recover_single_admin',
  'grant execute on function public.cfm_recover_single_admin',
]) {
  if (!migration.includes(needle)) {
    console.error(`generated migrations are missing ${needle}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('admin recovery flow check passed');
