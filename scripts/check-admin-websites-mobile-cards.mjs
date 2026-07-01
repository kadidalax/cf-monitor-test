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
  [css.includes('.admin-websites-page') && css.includes('min-width: 0'), 'mobile website page must be allowed to shrink'],
  [css.includes('left: 50% !important') && css.includes('transform: translateX(-50%) !important'), 'mobile website dialog must be viewport-centered'],
];

const mobileCard = page.slice(page.indexOf('function SortableWebsiteCard'), page.indexOf('export default function AdminWebsites'));
const setVisibility = page.slice(page.indexOf('const setVisibility'), page.indexOf('const setEnabled'));
const setSelectedVisibility = page.slice(page.indexOf('const setSelectedVisibility'), page.indexOf('const handleDragEnd'));
const remove = page.slice(page.indexOf('const remove'), page.indexOf('const checkNow'));

checks.push(
  [!mobileCard.includes('onVisibility(monitor'), 'mobile website card must not show the hide action'],
  [!setVisibility.includes('remove: hidden ? [monitor.id]'), 'single visibility updates must preserve admin ordering'],
  [!setSelectedVisibility.includes('remove: hidden ? targets.map'), 'bulk visibility updates must preserve admin ordering'],
  [!page.includes('window.confirm(') && page.includes('deleteMonitor'), 'website delete must use the styled delete dialog'],
  [css.includes('grid-template-columns: repeat(2, 30px)') && css.includes('height: 26px'), 'mobile website action buttons must be 30x26'],
  [page.includes('onOpenAutoFocus=') && page.includes('event.preventDefault()'), 'website edit dialog must not autofocus on mobile'],
  [page.includes('editDialogRef') && page.includes('tabIndex={-1}'), 'website edit dialog must move focus to dialog content'],
);

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
