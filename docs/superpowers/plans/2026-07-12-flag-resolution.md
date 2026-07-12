# Flag Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correctly resolve combined Chinese location names and cloud region identifiers to existing country flag assets.

**Architecture:** Keep the existing `Flag.tsx` component and alias table. Change only resolver precedence and matching rules, with one executable regression test that transpiles the non-JSX resolver portion using the already-installed TypeScript compiler.

**Tech Stack:** React, TypeScript, Node.js assert, Vite.

---

### Task 1: Add resolver regression coverage

**Files:**
- Create: `frontend/src/components/Flag.test.mjs`
- Modify: `frontend/src/components/Flag.tsx:102-123`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('./Flag.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const DEFAULT_FLAG_CODE');
const end = source.indexOf('interface FlagProps', start);
assert.ok(start >= 0 && end > start);

const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exports = {};
new Function('exports', compiled)(exports);
const { resolveFlagCode } = exports;

assert.equal(resolveFlagCode('韩国首尔'), 'KR');
assert.equal(resolveFlagCode('甲骨文韩国首尔'), 'KR');
assert.equal(resolveFlagCode('ap-seoul-1'), 'KR');
assert.equal(resolveFlagCode('Seoul, Seoul, KR'), 'KR');
assert.equal(resolveFlagCode('ap-tokyo-1'), 'JP');
assert.equal(resolveFlagCode('eu-frankfurt-1'), 'DE');
assert.equal(resolveFlagCode('未知地区'), 'UN');
```

- [ ] **Step 2: Run the test and verify the current bug**

Run:

```bash
node frontend/src/components/Flag.test.mjs
```

Expected: FAIL because `韩国首尔` resolves to `UN` or `ap-seoul-1` resolves to `AP`.

- [ ] **Step 3: Apply the minimal resolver fix**

Replace the matching section after `directAlias` with:

```ts
  for (const [alias, code] of aliasToCountryCode.entries()) {
    if (/^[a-z]{2}$/i.test(alias)) continue;
    if (normalized.includes(alias)) return code;
  }

  const standaloneCode = raw.match(/(?:^|[^a-zA-Z])([a-zA-Z]{2})(?=$|[^a-zA-Z])/);
  if (standaloneCode) {
    const normalizedCode = standaloneCode[1].toUpperCase();
    return aliasToCountryCode.get(normalizeAlias(normalizedCode)) || normalizedCode;
  }
```

This keeps exact matches first, prioritizes semantic aliases such as `首尔`/`seoul`, skips only ASCII ISO-style aliases, and removes reverse substring matching.

- [ ] **Step 4: Run focused and frontend verification**

Run:

```bash
node frontend/src/components/Flag.test.mjs
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the flag fix**

```bash
git add frontend/src/components/Flag.tsx frontend/src/components/Flag.test.mjs
git commit -m "fix: 修复节点地区国旗解析"
```

