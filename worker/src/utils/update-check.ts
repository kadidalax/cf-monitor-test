export type UpdateCheckResult = {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_url: string;
  upgrade_url: string | null;
  actions_url: string | null;
  workflow_configured: boolean;
  update_mode: 'actions' | 'fork';
  repository_url: string | null;
  title: string;
  body: string;
  published_at: string;
};

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function parseSemver(version: string): [number, number, number] | null {
  const match = normalizeVersion(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (parsedA && parsedB) {
    for (let i = 0; i < 3; i += 1) {
      if (parsedA[i] > parsedB[i]) return 1;
      if (parsedA[i] < parsedB[i]) return -1;
    }
    return 0;
  }

  const normalizedA = normalizeVersion(a);
  const normalizedB = normalizeVersion(b);
  if (normalizedA === normalizedB) return 0;
  if (normalizedA === 'dev') return -1;
  if (normalizedB === 'dev') return 1;
  return normalizedA > normalizedB ? 1 : -1;
}

export function canonicalGitHubRepositoryUrl(repositoryUrl: string | undefined): string | null {
  if (!repositoryUrl) return null;
  const raw = repositoryUrl.trim();
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith('github.com/')
      ? `https://${raw}`
      : /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(raw)
        ? `https://github.com/${raw}`
        : raw;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return `https://github.com/${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

export function repositoryUrlFromRepositoryUrl(repositoryUrl: string | undefined): string | null {
  return canonicalGitHubRepositoryUrl(repositoryUrl);
}

export function workflowUrlFromRepositoryUrl(repositoryUrl: string | undefined): string | null {
  const repository = canonicalGitHubRepositoryUrl(repositoryUrl);
  return repository ? `${repository}/actions/workflows/update-from-upstream.yml` : null;
}

export function normalizeGitSha(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function shortGitSha(value: string | undefined): string {
  return normalizeGitSha(value).slice(0, 7);
}
