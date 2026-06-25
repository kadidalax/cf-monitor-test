import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');
const nodeCardSource = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'NodeCard.tsx'), 'utf8');
const usageBarSource = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'UsageBar.tsx'), 'utf8');

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 's'));
  assert.ok(match?.groups?.body, `Missing CSS rule: ${selector}`);
  return match.groups.body;
}

test('node metrics chase every load change at a short pace', () => {
  const fillRule = rule('.node-metric-bar span');
  const ringRule = rule('.node-resource-ring-chart');

  assert.match(fillRule, /width:\s*100%/);
  assert.match(fillRule, /transform-origin:\s*left center/);
  assert.match(fillRule, /transition:[^;]*transform\s+800ms\s+cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/);
  assert.match(fillRule, /background\s+0\.8s\s+ease/);
  assert.match(fillRule, /box-shadow\s+0\.8s\s+ease/);
  assert.match(fillRule, /filter\s+0\.8s\s+ease/);
  assert.match(nodeCardSource, /transform:\s*`scaleX\(\$\{clampPercent\(percent\) \/ 100\}\)`/);
  assert.match(css, /@property\s+--metric-percent\s*\{/);
  assert.match(ringRule, /--metric-percent\s+800ms\s+cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/);
});

test('node network summary gives desktop values more horizontal room', () => {
  const rowRule = rule('.node-network-summary-row');
  const valuesRule = rule('.node-network-summary-values');

  assert.match(rowRule, /grid-template-columns:\s*70px minmax\(0,\s*1fr\)/);
  assert.match(valuesRule, /grid-template-columns:\s*repeat\(2,\s*minmax\(105px,\s*1fr\)\)/);
});

test('node metric bar keeps the track muted and the filled segment gradient colored', () => {
  const trackRule = rule('.node-metric-bar');
  const fillRule = rule('.node-metric-bar span');

  assert.match(trackRule, /background:\s*color-mix\(in srgb,\s*var\(--monitor-ring-track\)/);
  assert.doesNotMatch(trackRule, /linear-gradient/);
  assert.match(fillRule, /background:\s*var\(--monitor-load-cool,\s*linear-gradient/);
});

test('node resource rings use the same short load transition', () => {
  const ringRule = rule('.node-resource-ring-chart');

  assert.match(ringRule, /transition:[^;]*--metric-percent\s+800ms\s+cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/);
});

test('monitor resource rings omit detail values below cpu ram and disk', () => {
  assert.doesNotMatch(nodeCardSource, /node-resource-ring-detail/);
  assert.doesNotMatch(nodeCardSource, /<RingMetric[^>]*detail=/);
  assert.match(nodeCardSource, /<RingMetric label="CPU" percent=\{cpuPct\} \/>/);
  assert.match(nodeCardSource, /<RingMetric label="RAM" percent=\{memPct\} \/>/);
  assert.match(nodeCardSource, /<RingMetric label="Disk" percent=\{diskPct\} \/>/);
});

test('monitor billing row is full width and shows ip family badges at the card right edge', () => {
  assert.match(nodeCardSource, /className="node-card-header"[\s\S]*className="node-card-status-row"[\s\S]*<\/Flex>\s*<\/Flex>\s*<Flex className="node-card-title-meta"/);
  assert.match(nodeCardSource, /className="node-card-title-meta"[\s\S]*<NodeIpBadges client=\{client\} className="node-card-title-ip-badges" \/>/);
  assert.match(nodeCardSource, /function NodeIpBadges\(\{ client, className \}/);
  assert.match(css, /\.node-card-title-ip-badges\s*\{[\s\S]{0,120}margin-left:\s*auto;[\s\S]{0,120}flex:\s*0 0 auto;/);
});

test('node metric motion keeps a brief chase under reduced motion', () => {
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.node-metric-bar span\s*\{[\s\S]*transform\s+120ms\s+linear/,
  );
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.node-resource-ring-chart\s*\{[\s\S]*--metric-percent\s+120ms\s+linear/,
  );
});

test('shared usage bars animate at the calmer node metric pace', () => {
  const fillRule = rule('.usage-bar-fill');

  assert.match(fillRule, /width:\s*100%/);
  assert.match(fillRule, /transform-origin:\s*left center/);
  assert.match(fillRule, /transition:[^;]*transform\s+800ms\s+cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/);
  assert.match(fillRule, /background\s+0\.8s\s+ease/);
  assert.match(fillRule, /box-shadow\s+0\.8s\s+ease/);
  assert.match(usageBarSource, /transform:\s*`scaleX\(\$\{pct \/ 100\}\)`/);
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.usage-bar-fill\s*\{[\s\S]*transform\s+120ms\s+linear\s*!important;/,
  );
});

test('shared usage bars gradient to the current load level color only', () => {
  assert.doesNotMatch(usageBarSource, /monitor-resource-progress-gradient/);
  assert.match(usageBarSource, /background:\s*barGradient/);
  assert.ok(usageBarSource.includes('linear-gradient(90deg, color-mix(in srgb, var(--monitor-success, #22c55e) 55%, transparent), var(--monitor-success, #22c55e))'));
  assert.ok(usageBarSource.includes('linear-gradient(90deg, var(--monitor-success, #22c55e), var(--monitor-warning, #f59e0b))'));
  assert.ok(usageBarSource.includes('linear-gradient(90deg, var(--monitor-warning, #f59e0b), var(--monitor-danger, #ef4444))'));
});
