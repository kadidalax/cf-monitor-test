import assert from 'node:assert/strict';

const {
  compareVersions,
  canonicalGitHubRepositoryUrl,
  normalizeVersion,
  repositoryUrlFromRepositoryUrl,
  shortGitSha,
  workflowUrlFromRepositoryUrl,
} = await import('./update-check.ts');

assert.equal(normalizeVersion('v2.0.1'), '2.0.1');
assert.equal(normalizeVersion(' 2.0.1 '), '2.0.1');

assert.equal(compareVersions('2.0.1', '2.0.0'), 1);
assert.equal(compareVersions('v2.0.1', '2.0.1'), 0);
assert.equal(compareVersions('2.0.0', '2.0.1'), -1);
assert.equal(compareVersions('dev', '2.0.1'), -1);
assert.equal(compareVersions('2.0.1', 'dev'), 1);

assert.equal(canonicalGitHubRepositoryUrl('https://github.com/example/cf-vps-monitor'), 'https://github.com/example/cf-vps-monitor');
assert.equal(canonicalGitHubRepositoryUrl('https://github.com/example/cf-vps-monitor.git'), 'https://github.com/example/cf-vps-monitor');
assert.equal(canonicalGitHubRepositoryUrl('github.com/example/cf-vps-monitor'), 'https://github.com/example/cf-vps-monitor');
assert.equal(canonicalGitHubRepositoryUrl('example/cf-vps-monitor'), 'https://github.com/example/cf-vps-monitor');
assert.equal(canonicalGitHubRepositoryUrl('https://github.com/example/cf-vps-monitor/tree/main'), null);
assert.equal(canonicalGitHubRepositoryUrl('https://gitlab.com/example/cf-vps-monitor'), null);
assert.equal(canonicalGitHubRepositoryUrl('not a url'), null);

assert.equal(repositoryUrlFromRepositoryUrl('example/cf-vps-monitor'), 'https://github.com/example/cf-vps-monitor');

assert.equal(
  workflowUrlFromRepositoryUrl('https://github.com/example/cf-vps-monitor'),
  'https://github.com/example/cf-vps-monitor/actions/workflows/update-from-upstream.yml',
);
assert.equal(
  workflowUrlFromRepositoryUrl('https://github.com/example/cf-vps-monitor.git'),
  'https://github.com/example/cf-vps-monitor/actions/workflows/update-from-upstream.yml',
);
assert.equal(
  workflowUrlFromRepositoryUrl('example/cf-vps-monitor'),
  'https://github.com/example/cf-vps-monitor/actions/workflows/update-from-upstream.yml',
);
assert.equal(workflowUrlFromRepositoryUrl('https://gitlab.com/example/cf-vps-monitor'), null);
assert.equal(workflowUrlFromRepositoryUrl('not a url'), null);
assert.equal(shortGitSha('77D873F2552638E38BEBF1D18BC38DB7721042F5'), '77d873f');
assert.equal(shortGitSha(undefined), '');
