# KP Flag Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure detailed GeoIP text ending in an ISO country code uses that code for its flag without breaking cloud-region semantic aliases.

**Architecture:** Keep the existing `Flag.tsx` resolver and static SVG assets. Add one authoritative trailing-code check before semantic alias scanning, while retaining the existing generic standalone-code fallback after semantic matching.

**Tech Stack:** React, TypeScript, Node.js assert, Vite.

---

### Task 1: Prioritize trailing ISO country codes

**Files:**
- Modify: `frontend/src/components/Flag.test.mjs`
- Modify: `frontend/src/components/Flag.tsx:102-126`

- [ ] **Step 1: Write the failing regression test**

Add these assertions after the existing Seoul assertions:

```js
assert.equal(resolveFlagCode('North Korea, KP'), 'KP');
assert.equal(resolveFlagCode('KP'), 'KP');
assert.equal(resolveFlagCode('South Korea, KR'), 'KR');
```

- [ ] **Step 2: Run the test and verify the current regression**

Run:

```bash
node frontend/src/components/Flag.test.mjs
```

Expected: FAIL because `North Korea, KP` currently resolves to `KR`.

- [ ] **Step 3: Add the minimal trailing-code priority**

Add this block after `directAlias` and before semantic alias scanning:

```ts
  const trailingCode = raw.match(/(?:^|[^a-zA-Z])([a-zA-Z]{2})\s*$/);
  if (trailingCode) {
    const normalizedCode = trailingCode[1].toUpperCase();
    return aliasToCountryCode.get(normalizeAlias(normalizedCode)) || normalizedCode;
  }
```

Do not change the existing semantic alias loop or final standalone-code fallback.

- [ ] **Step 4: Run focused and frontend verification**

Run:

```bash
node frontend/src/components/Flag.test.mjs
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: all commands exit 0. Existing `ap-seoul-1 → KR` and `eu-frankfurt-1 → DE` assertions remain green.

- [ ] **Step 5: Commit the fix**

```bash
git add frontend/src/components/Flag.tsx frontend/src/components/Flag.test.mjs
git commit -m "fix: 优先识别明确国家代码"
```
