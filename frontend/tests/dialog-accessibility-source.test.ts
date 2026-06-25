import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const adminDir = join(import.meta.dirname, '..', 'src', 'pages', 'admin');

test('admin dialogs either describe their content or opt out explicitly', () => {
  const offenders: string[] = [];

  for (const file of readdirSync(adminDir).filter(name => name.endsWith('.tsx'))) {
    const source = readFileSync(join(adminDir, file), 'utf8');
    const dialogs = source.matchAll(/<Dialog\.Content\b([^>]*)>([\s\S]*?)<\/Dialog\.Content>/g);

    for (const match of dialogs) {
      const openTag = match[1];
      const body = match[2];
      if (!/aria-describedby=\{undefined\}/.test(openTag) && !/<Dialog\.Description\b/.test(body)) {
        offenders.push(`${file}: ${match[0].split('\n')[0].trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
