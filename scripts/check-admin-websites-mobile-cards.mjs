import { readFileSync } from 'node:fs';

const page = readFileSync('frontend/src/pages/admin/Websites.tsx', 'utf8');
const css = readFileSync('frontend/src/index.css', 'utf8');

const checks = [
  [page.includes('function SortableWebsiteCard'), 'missing SortableWebsiteCard mobile component'],
  [page.includes('admin-website-table-wrap'), 'missing desktop table wrapper'],
  [page.includes('admin-website-card-grid'), 'missing mobile website card grid'],
  [page.includes('admin-website-dialog-scroll'), 'missing mobile dialog scroll wrapper'],
  [css.includes('.admin-website-table-wrap'), 'missing desktop table CSS'],
  [css.includes('.admin-website-card-grid'), 'missing mobile card CSS'],
  [css.includes('.admin-website-dialog-scroll'), 'missing mobile dialog CSS'],
  [css.includes('@media (max-width: 760px)') && css.includes('.admin-website-table-wrap'), 'missing mobile table/card media switch'],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
