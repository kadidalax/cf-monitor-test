import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = await readFile(new URL('../.github/workflows/release-agent.yml', import.meta.url), 'utf8');
function job(source, name) {
  const start = source.indexOf(`  ${name}:`);
  if (start < 0) return '';
  const rest = source.slice(start + 1);
  const next = /\n  [a-z][a-z0-9-]*:\s*\r?\n/.exec(rest);
  return next ? source.slice(start, start + 1 + next.index) : source.slice(start);
}

test('CI02 every external Action is selected by a complete immutable commit', () => {
  const references = [...`${ci}\n${release}`.matchAll(/^\s+uses:\s*(\S+)/gm)].map(match => match[1]);
  assert.ok(references.length >= 8, 'inspect the actual CI and release workflow dependencies');
  for (const reference of references.filter(value => !value.startsWith('./'))) {
    assert.match(reference, /^[a-z0-9_.-]+\/[a-z0-9_./-]+@[a-f0-9]{40}$/i,
      `${reference} must not drift when a mutable version tag moves`);
  }
});

test('CI02 Windows and macOS execute native Go tests and built executables, with real Windows installation lifecycle', () => {
  const native = job(ci, 'native-smoke');
  assert.ok(native, 'native platform checks must be actual CI jobs');
  assert.match(native, /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
  assert.match(native, /windows-latest/);
  assert.match(native, /macos-latest/);
  assert.match(native, /go test \.\/\.\.\./);
  assert.match(native, /go build .* -o /);
  assert.match(native, /"\$output" -h/);
  assert.match(native, /if:\s*runner\.os == 'Windows'/);
  assert.match(native, /run:\s*\.\/scripts\/ci-windows-installer\.ps1/);
  assert.doesNotMatch(native, /continue-on-error:\s*true/);
});

test('CI02 FreeBSD runs inside its native VM and remains part of the release prerequisite', () => {
  const freebsd = job(ci, 'freebsd-smoke');
  assert.ok(freebsd, 'FreeBSD execution cannot be represented by cross-compilation alone');
  assert.match(freebsd, /uses:\s*vmactions\/freebsd-vm@[a-f0-9]{40}/);
  assert.match(freebsd, /go test \.\/\.\.\./);
  assert.match(freebsd, /go build /);
  assert.match(freebsd, /"\$smoke_dir\/agent" -h/);
  assert.match(job(ci, 'verify'), /go test -race \.\/\.\.\./);
  assert.match(job(ci, 'verify'), /Installer service account permissions/);
  assert.match(job(release, 'verify'), /uses:\s*\.\/\.github\/workflows\/ci\.yml/);
  assert.match(job(release, 'release-agent'), /needs:\s*verify/);
  assert.doesNotMatch(freebsd, /continue-on-error:\s*true/);
});

test('CI02 root collector permission selection includes current Go checks', async () => {
  const permissions = job(ci, 'verify').match(/- name: Agent root collector permissions\r?\n([\s\S]*?)(?=\r?\n      - name:|$)/)?.[1];
  assert.ok(permissions, 'inspect the actual privileged collector check step');
  const selection = permissions.match(/-test\.run\s+(['"])([^'"]+)\1/)?.[2];
  assert.ok(selection, 'the privileged step must select Go permission tests');
  const source = await readFile(new URL('../agent/container_disk_usage_linux_test.go', import.meta.url), 'utf8');
  const names = [...source.matchAll(/^func (Test\w+)\(t \*testing\.T\)/gm)].map(match => match[1]);
  const collectorLog = names.filter(name => name.endsWith('CollectorLogRequiresRootControlledFiles'));
  const native = names.filter(name => name.startsWith('TestDirectoryDiskNative'));
  assert.equal(collectorLog.length, 1, 'the real collector log permission check must exist');
  assert.ok(native.length >= 2, 'retain the existing native cache permission checks');
  for (const name of new Set([...native, ...collectorLog])) {
    assert.match(name, new RegExp(selection), `${name} must run in the actual privileged CI step`);
  }
});

test('CI02 pinned Actions have an automatic update proposal schedule', async () => {
  const url = new URL('../.github/dependabot.yml', import.meta.url);
  assert.ok(existsSync(url), 'an immutable pin still needs a maintained update process');
  const config = await readFile(url, 'utf8');
  assert.match(config, /package-ecosystem:\s*['"]?github-actions['"]?/);
  assert.match(config, /interval:\s*['"]?weekly['"]?/);
});

test('CI02 native Windows fixture refuses a local invocation before creating system tasks', () => {
  const path = fileURLToPath(new URL('./ci-windows-installer.ps1', import.meta.url));
  assert.ok(existsSync(path), 'the configured native installer check must exist');
  const child = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, GITHUB_ACTIONS: 'false' },
  });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /only runs on a GitHub-hosted Windows runner/);
  assert.doesNotMatch(child.stdout, /Installing|Upgrading|Uninstalled/);
});
