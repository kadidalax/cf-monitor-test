# Worker 配额消耗 — 实施方案（v2，从头重审）

修订日期：2026-08-03
前置调查：`docs/quota-burn-investigation.md`

> **本文是 v1 的完全重写，不是修订。** v1 的核心叙事（"根因是 viewer token 的
> IP 严格绑定"）在本次从头重审中被降级为"若干可能触发原因之一"，且 v1 提出的
> 4 条改动里有 2 条被证明是错的。变更理由见文末"v1 错误存档"。

---

## 一、本次重审推翻了什么

v1 是在"挂后台几乎免费"这个实验结论上建起来的。本次从源码重读，发现
**那个实验只覆盖了一半的状态空间**。

`frontend/src/contexts/livePolling.ts` 里有一整条**从头死到尾的链**：

```
shouldReconnectLiveWebSocket({expired, hidden})   hidden 在类型里，但从未被解构
        └─→ return !expired                       document.hidden 传进来了，被忽略

getFallbackViewerExpiry({currentExpiresAt, ...})  void now; void config;
        └─→ return currentExpiresAt ?? null       恒等函数
                ↓  调用点只在 ref === null 时触发，传入 null，拿回 null
        isViewerWindowExpired(null)   →  恒 false
                ↓
        expireViewerSession()         →  永不调用
                ↓
        wsExpiredRef.current          →  恒 false（文件内所有相关分支皆为死分支）
                ↓
        viewerExpired (Context 导出)   →  恒 false，且无任何组件消费
```

两处都是"保留签名、掏空实现"的手法。`worker/src/routes/websocket.ts:35`
还留着同一批改动的第三处痕迹：

```ts
export function invalidateLiveViewerSettingsCache(): void {
  // Kept for the settings save path; viewer tokens stay on the fast default.
}
```

**根本原因（为什么能一路上线）**：`frontend/package.json` 没有 `test` 脚本，
`lint` 就是 `tsc --noEmit`。TypeScript 对"解构时少写一个参数"和 `void x;`
完全无感。

### 这解释了此前的分歧

| | WebSocket 正常 | WebSocket 坏掉 |
|---|---|---|
| **挂后台（hidden）** | ~12 请求/小时 ← **对照实验只测了这一格** | **~510 请求/小时** |
| 前台但无操作 | ~12/小时 | ~510/小时 |
| 前台且在操作 | ~12/小时 | **~1,680/小时** |

对照变量实验的四个阶段**全部落在左列**（WS 一直是好的），所以测出
"挂后台几乎免费"。用户观测到的配额飙升在右列。

**510/小时 与 07-30 实测平台 413–575/小时 吻合**：
其中 480 来自重连循环（每 30 秒 4 个请求），30 来自 idle 轮询。

**结论：用户的原始判断是对的 —— 挂在后台确实会烧配额，
而本该阻止它的 `hidden` 守卫是死代码。**

---

## 二、已确认的事实（标注证据来源）

### 源码确认

| 事实 | 位置 |
|------|------|
| `hidden` 守卫从未生效 | `livePolling.ts:61-68` |
| fallback 过期链整条为死 | `livePolling.ts:70-82` → `LiveDataContext.tsx:248-254` |
| 重连固定 30 秒，无退避、无上限、无熔断 | `LiveDataContext.tsx:526-531` |
| `onerror` 与 `onclose` 各调一次 `fetchLiveData()` | `LiveDataContext.tsx:512, 523` |
| `viewer_expired` 续期路径绕过 `hidden` 判断 | `LiveDataContext.tsx:493-497` → `535-551` |
| 通行证有效期与 viewer 窗口共用同一常量 | `websocket.ts:308` 与 `:353` 同调 `viewerTtlMs()` |
| DO 对外宣称的窗口 ≠ 实际执行的窗口 | `live-data.ts:803`（读设置）vs `websocket.ts:204`（写死 120） |
| 通行证不构成权限边界 | `websocket.ts:346` — 隐藏机器另验 `hasAdminSession()` |
| 估算器把 WS 消息当 Worker 请求 | `admin.ts:1150` |
| **DO 使用休眠版 API，无 setTimeout/setInterval** | `live-data.ts:1736` `acceptWebSocket()`；全文件 0 处定时器 |

### 官方文档确认（`developers.cloudflare.com/durable-objects/platform/pricing`）

- 入站 WebSocket 消息按 **20:1** 折算计费；**出站消息与协议 ping 免费**
- `state.setWebSocketAutoResponse()` 不产生 wall-clock，不计费
- **"空闲且符合休眠条件"即不计 duration，无需真正进入休眠**
- 建立一条 WebSocket 连接算 1 个请求
- 用 `accept()`（非休眠版）会导致连接存续期间全程计 duration
  → **本项目用的是 `acceptWebSocket()`，不受此影响**

### 实测确认

- 通行证实际 TTL = **122 秒**（非代码默认的 60 秒），印证耦合
- 账户全局用量：Worker 4,085/天（免费额度 4%）、DO duration 124 GB-s/天（1%）
- 空闲基线 767/天，其中 cron 占 720/天（94%）

### 无法证实也无法证伪

- **真实用户是否因 IP 漂移触发 403**。调查环境走单一出口代理（5 次取证 IP
  完全一致），而单出口恰恰是最不可能漂移的环境。双栈家宽 / 多出口 VPN /
  CGNAT / 移动网络切换均无法从此处复现。
  → IP 绑定的改动按**风险权衡**处理，不按"已证实的根因"处理。

---

## 三、八条决策

| # | 决策 | 状态 |
|---|------|------|
| 1 | 恢复 `hidden` 守卫：隐藏时不重连，切回可见立刻重连 | 已定 |
| 2 | 重连退避 `5s→10s→30s→60s` 封顶，`open` 成功归零 | 已定 |
| 3 | 连续失败 10 次熔断；**轮询不降速**（体验优先）；切回前台免费重试一次 | 已定 |
| 4 | 隐藏且 WS 未连通 → **完全不轮询**；切回可见立刻拉一次 + 立刻重连 | 已定 |
| 5 | 隐藏时收到 `viewer_expired` **不续期**，让探针回落到 2 分钟上报 | 已定 |
| 6 | 通行证有效期（固定 60s）与 viewer 窗口（DO 读自己的设置，默认 120s）拆开 | 已定 |
| 7 | IP 绑定放宽到 IPv4 `/24` + IPv6 `/64` | 已定 |
| 8 | 范围：修复 + 清理死代码 + 引入 vitest 单测 | 已定 |

**决策 2 的反直觉之处**（记录理由，避免日后误改）：可见状态下 HTTP 轮询
已在以 3 秒兑现实时体验，所以重连**不影响体验，只影响多久能从 1,200/小时
的 HTTP 路径切回 ~60/小时 的 WS 路径**。退避过狠会让系统在贵路径上滞留更久，
**总账反而更差**。故封顶 60 秒而非 5 分钟。

---

## 四、变更清单

### 1. `frontend/src/contexts/livePolling.ts`

```ts
// 决策 1：让 hidden 真正生效
export function shouldReconnectLiveWebSocket({ expired, hidden }: {
  expired: boolean; hidden: boolean;
}) {
  return !expired && !hidden;
}

// 决策 2：退避序列（纯函数，便于测试）
export const LIVE_WS_RECONNECT_BACKOFF_MS = [5_000, 10_000, 30_000, 60_000] as const;
export const LIVE_WS_FAILURE_CIRCUIT_BREAK = 10;

export function getLiveWsReconnectDelay(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), LIVE_WS_RECONNECT_BACKOFF_MS.length - 1);
  return LIVE_WS_RECONNECT_BACKOFF_MS[i];
}

export function isLiveWsCircuitOpen(failStreak: number): boolean {
  return failStreak >= LIVE_WS_FAILURE_CIRCUIT_BREAK;
}

// 决策 4：隐藏且未连通 → 不排期轮询
export function shouldPollLiveData({ hidden, wsOpen }: {
  hidden: boolean; wsOpen: boolean;
}) {
  return !(hidden && !wsOpen);
}

// 决策 8：删除 getFallbackViewerExpiry 与 isViewerWindowExpired
```

### 2. `frontend/src/contexts/LiveDataContext.tsx`

| 位置 | 改动 | 对应决策 |
|------|------|---------|
| `~527` 重连排期 | 固定 30s → `getLiveWsReconnectDelay(failStreakRef.current)` | 2 |
| `~445` `open` 处理 | 新增 `failStreakRef.current = 0` | 2 |
| `~516` `close` 处理 | 新增 `failStreakRef.current += 1`；熔断则不再排期 | 3 |
| `~493` `viewer_expired` | `if (document.hidden) { wsRef.current = null; return; }` 再走续期 | 5 |
| `~634` `scheduleNextPoll` | 开头加 `if (!shouldPollLiveData({hidden: document.hidden, wsOpen: wsOpenRef.current})) return;` | 4 |
| `~691` `handleVisibility` | 转为可见时：立刻 `fetchLiveData()` + 立刻 `connect()` + 熔断计数归零重试一次 | 3, 4 |
| 全文件 | 删除 `wsExpiredRef` / `viewerExpired` / `viewerExpiresAt` / `expireViewerSession` 及其死分支 | 8 |
| `~512` `onerror` | **保持不变**（见下方说明） | — |
| `~717` `scroll` 监听 | **保持不变**（见下方说明） | — |

**为什么 `onerror` 里的 `fetchLiveData()` 不删**（v1 说要删，是错的）：
`onclose` 那次调用有实际作用 —— WS 开着时轮询器按 120 秒排期，WS 一断，
下一次轮询可能还有两分钟才到，`onclose` 这次 fetch 正好补上空档。
删掉会造成最长 120 秒的数据断档。只有 `onerror` 那次是纯重复，
但删它只省每轮 1 个请求，而退避已把每轮频率降了一个量级，收益不足以
承担"error 未必总是先于 close 触发"的边界风险。**两个都保留。**

**为什么 `scroll` 监听不删**（v1 说要删，是错的）：滚动就是"人在看"的信号
（读长列表时只滚不点是常态）。删掉会让这类用户 2 分钟后被误判为无人，
实时性从 3 秒掉到 2 分钟 —— **直接违反"有人看 = 3 秒"的产品约束**。
它已是 `{ passive: true }`，无性能问题。

### 3. `worker/src/auth/viewer-token.ts` — 决策 7

```ts
export function normalizeIpForBinding(ip: string): string {
  const v = (ip || '').trim();
  if (!v) return '';
  if (v.includes(':')) {                          // IPv6 → /64
    const head = v.split('%')[0].split(':');
    return head.slice(0, 4).join(':').toLowerCase() + '::/64';
  }
  const o = v.split('.');                          // IPv4 → /24
  return o.length === 4 ? `${o[0]}.${o[1]}.${o[2]}.0/24` : v;
}
```

- `createViewerToken`：`ip: normalizeIpForBinding(ip)`
- `verifyViewerToken`：`payload.ip !== normalizeIpForBinding(ip)` 才拒绝

旧 token 验签失败一次，前端重连即恢复，无需迁移。

**安全影响评估**：通行证不是权限边界 —— 隐藏机器需 `hasAdminSession()`
（`websocket.ts:346`），拿证经 WS 看到的数据与免证访问 `/api/live/clients`
完全一致。放宽后仍保留"证不能跨网段转发"的防滥用能力。

**⚠️ 覆盖范围修正（实施后经本地端到端实测）**：本改动**不覆盖
IPv4 ↔ IPv6 协议族切换** —— `/24` 与 `/64` 是完全不同的字符串，
族一换照样 403（实测：IPv4 证 → IPv6 建连 = 403）。

实际覆盖的是：

| 场景 | 覆盖 |
|------|------|
| IPv6 隐私扩展（临时地址在同 /64 内轮换）| ✅ 很可能是最常见的真实触发因素 |
| 多出口 VPN / CGNAT 在同网段内换主机位 | ✅ |
| 移动网络在子网内重新分配 | ✅ |
| IPv4 ↔ IPv6 协议族切换 | ❌ **未覆盖** |

该遗漏不改变整体结论：即使协议族切换仍会失败，损失也已被放大器修复限制在
"挂后台 0/小时、前台连败 10 次熔断后靠 HTTP 轮询照常兑现 3 秒实时"。
**这正是"先修放大器、后修触发"这一优先级的价值所在。**

### 4. `worker/src/routes/websocket.ts` + `worker/src/do/live-data.ts` — 决策 6

```ts
// websocket.ts:308  通行证固定 60 秒，与 viewer 窗口解耦
return c.json(await createViewerToken({ ip, secret, ttlMs: VIEWER_TOKEN_TTL_MS })); // 60_000

// websocket.ts:353  不再传 viewer_ttl_ms，交给 DO 用自己的设置
// - url.searchParams.set('viewer_ttl_ms', String(await viewerTtlMs(c)));

// live-data.ts:1730  DO 用已加载的设置（无额外 DB 读取）
viewerExpiresAt: now + this.settings.viewerTtlSec * 1000
```

**默认行为零变化**（窗口仍 120 秒）。收益：通行证有效期 122s → 60s；
后台设置项 `live_poll_active_max_duration_sec` 对 viewer 窗口终于真正生效，
消除"对外宣称 X 秒、实际执行 120 秒"的不一致。

### 5. `worker/src/routes/admin.ts:1150` — 修正估算器

现状把 WS 消息当 Worker 请求，且完全漏掉 cron 与浏览器侧，
面板显示 **5,956/天**，实测 **1,474/天**。

```ts
const CRON_INTERVAL_SEC = 120;
const workerRequestBreakdown = {
  cron_invocations:         Math.floor(86400 / CRON_INTERVAL_SEC),  // 720，占空闲基线 94%
  agent_websocket_connects: agentWebsocketConnectsPerDay,           // 每 agent 每天约 1
  per_admin_tour:           23,                                     // 实测：走遍所有后台页面
  per_watching_hour_ws:     60,                                     // WS 正常，窗口续期开销
  per_watching_hour_http:   1200,                                   // WS 不通时的 3 秒降级轮询
  note: 'agent ping/report traffic rides the WebSocket and bills as DO messages at 20:1, not Worker requests',
};
```

### 6. 新增测试 — 决策 8

`frontend` 引入 `vitest`，新增 `frontend/src/contexts/livePolling.test.ts`：

- `shouldReconnectLiveWebSocket` — `hidden: true` 必须返回 `false`（**回归锁**）
- `getLiveWsReconnectDelay` — 序列为 5/10/30/60/60/60…，`attempt` 越界不崩
- `isLiveWsCircuitOpen` — 第 10 次触发，第 9 次不触发
- `shouldPollLiveData` — 仅 `hidden && !wsOpen` 时返回 `false`
- `getLivePollDelay` — `hidden` 返回 idle；超 `activeMaxDuration` 返回 idle
- `normalizeLivePollConfig` — 边界裁剪（3–300 / 60–3600）

`package.json` 增 `"test": "vitest run"`。

> **⚠️ 实施时已推翻本节。** 仓库其实已有 38 个 `.test.mjs` 测试文件（前端也有），
> 用 `node <file>` 直接跑，Node 24 原生 import `.ts`。此前误判为"前端没有测试"，
> 只是因为 `package.json` 里没有 `test` 脚本。
> **实际按既有约定编写，零新依赖，未引入 vitest。**
>
> 实际落地：
> - `frontend/src/contexts/livePolling.test.mjs` —— 上述全部断言，
>   外加"退避上限 ≤ 60 秒"（锁住决策 2 的反直觉理由）与
>   `DEFAULT_LIVE_POLL_CONFIG === normalizeLivePollConfig(undefined)`
>   （两者此前在 `activeMaxDurationMs` 上不一致：常量 10 分钟 vs 设置默认
>   2 分钟，已统一到 2 分钟）
> - `worker/src/auth/viewer-token.test.mjs` —— 网段归一化（含 `::` 展开：
>   `2a01::1` 必须是 `2a01:0:0:0::/64`，朴素 split 会误算成 `2a01:0:1:0`）
>   与签发/校验端到端
>
> `livePolling.ts` 全是纯函数、零依赖，测试成本极低。**这是本次唯一
> 能防止同类死代码再次上线的措施** —— 其余七条都只修当下这一批。

---

## 五、预期效果

**每个标签页**（cron 的 720/天 不含在内，按用户要求保持 `*/2` 不动）：

| 场景 | 现状 | 改后 |
|------|------|------|
| 挂后台，WS 正常 | ~12/小时 | ~0/小时（窗口过期后不续期） |
| **挂后台，WS 坏掉** | **~510/小时** | **0/小时** |
| 前台无操作，WS 坏掉 | ~510/小时 | ~30/小时 |
| 前台在操作，WS 坏掉 | ~1,680/小时 | ~1,200/小时（**兑现 3 秒实时，这笔钱花得值**）+ ≤180/小时重连，熔断后归零 |
| 前台在看，WS 正常 | ~60/小时 | ~60/小时（不变） |

**探针侧**（决策 5，4 台 agent）：

| | 探针上报 | DO 请求 | 用户 VPS 开销 |
|---|---|---|---|
| 挂后台（现状）| 每 3 秒 | ~240/小时 | 4 台机器持续采集+上传 |
| 挂后台（改后）| 每 2 分钟 | ~6/小时 | 近乎为零 |

**核心体验保持不变**：`live_poll_active_interval_sec=3`、
`live_poll_idle_interval_sec=120`、有人/无人切换语义、agent 逻辑、
cron `*/2` —— 全部原样。切回标签页反而比现在**更快**刷新
（立刻拉，而非等最多 120 秒）。

---

## 六、验证方式

### 已完成（本地，`wrangler dev --local`）

| 项 | 结果 |
|----|------|
| `npm run lint`（frontend + worker）| ✅ |
| `npm run build`（frontend + worker）| ✅ |
| 全部 `.test.mjs`（38 个既有 + 2 个新增）| ✅ 40/40 |
| 通行证内嵌网段而非明文 IP | ✅ `1.2.3.4` → `1.2.3.0/24`；`2a01:4f8:c17:b8f::1` → `2a01:4f8:c17:b8f::/64` |
| 通行证 TTL 与 viewer 窗口解耦 | ✅ 实测 60 秒（改前 122 秒）|
| viewer 窗口来自 DO 设置项 | ✅ 实测 `viewer_expired` 恰在 +120 秒 |
| 同网段换出口 IP 可建连 | ✅ IPv4 `.99`/`.250`、IPv6 换接口标识与未压缩写法均 101 |
| 跨网段被拒绝（防滥用未削弱）| ✅ 跨 /24、相邻 /64、跨协议族均 403 |

> 本地验证通过设置 `CF-Connecting-IP` 请求头精确复现"取证与建连出口 IP 不同"，
> 这是线上环境无法可控复现的场景。

### 待完成（需部署，且必须覆盖故障态）

3. 四格状态矩阵各测 5 分钟，用 GraphQL 读实际计费：

### 已完成（线上，`cf-vps-monitor-demo`，最终 version `1052121d`）

**四格状态矩阵**——CDP 驱动真实 Chromium，用 `Network.setBlockedURLs`
阻断 `*/api/ws/live` 制造故障态，逐条统计 `/api/` 请求：

| 象限 | `document.hidden` | 修前 | 最终 | 判定 |
|------|---|---|---|---|
| A. WS 正常 × 前台 | false ✓ | 720/h | **80/h** | ✅ −89% |
| B. WS 正常 × 后台 | true ✓ | 288/h | **0/h** | ✅ −100% |
| C. WS 坏掉 × 前台 | false ✓ | 1,280/h | 1,680/h | ✅ 其中 1,120/h 是 3.2 秒一跳的实时数据（体验兑现）；重连仅 2 次/90s |
| **D. WS 坏掉 × 后台** | true ✓ | **~510/h** | **0/h** | ✅ **归零，用户最初的抱怨** |

> C 格数值上升是观测窗口内 `metadata_version` 变化次数的差异，非回归：
> 实测该值 90 秒变 3–5 次，每次触发一轮 `{force:true}` 全量刷新。
> 该路径（`LiveDataContext.tsx:241`）为既有行为，仅在 HTTP 降级态频繁触发。

其他线上验证：

- `/api/ws/live-token` → `payload.ip = "23.82.96.0/24"`（网段绑定生效）
- token TTL = 62 秒（改前 122 秒，已与 viewer 窗口解耦）
- 部署后 4 台探针持续在线，Supabase 正常，全部端点 200
- **网站监控回归测试**：`?view=websites` 下 120 秒内 `/api/websites` 刷新 5 次
  （≈2.5 次/分，与 `metadata_changed{websites}` 频率吻合），更新链路完好，
  且每次事件从 4 个请求降为 1 个
- `/api/version` → `hash: "dev"`（父仓库 `C:/工作区/cf-vps-monitor` 已不存在，
  `git rev-parse HEAD` 失败导致 `CURRENT_GIT_COMMIT` 为空。纯展示层降级，
  下次从完整 checkout 部署即自动恢复）

### 实测驱动的三轮追加修复（超出原八条）

均为运行时测量发现，本地单测与类型检查都发现不了：

**第一轮**（D 格 3 → 0）

1. `Index.tsx:304` / `:377` 的 `loadWhenVisible` —— 函数名承诺"只在可见时加载"，
   函数体不读 `document.hidden`，挂在 `setInterval(60_000)` 上前后台照跑。
   **本仓库第四、第五例"函数名承诺了并不存在的守卫"。**
2. `scheduleReconnect` 只在**排期时**判 `document.hidden`，未在**触发时**判 ——
   切后台前已排期的那一次仍会执行。实测正好漏 1 次。

**第二轮**（A 720→80，B 288→0）

3. `LiveDataContext.tsx` 的 `metadata_changed` 处理无条件调用
   `notifyPublicDataUpdated`。而 `live-data.ts:1610` 的
   `broadcastMetadataChanged({ websites: true })` 是**纯网站探测结果**，
   与客户端列表无关：`/api/public/bootstrap` 的内容是"设置 + 客户端快照 +
   实时快照"，**不含网站数据**，网站已由 `notifyWebsiteMonitorsUpdated`
   经 `/api/websites` 单独刷新。
   一次 `notifyPublicDataUpdated` 会扇出到 4 个订阅者
   （Layout 主题+站点设置、LiveDataContext bootstrap、Index 客户端列表、
   Dashboard 管理端列表）。实测 2 次/分 × 3 请求 = 360 请求/小时/标签页，
   且与可见性无关。已改为仅在消息确实涉及客户端时才广播。
   核实过三个 `broadcastLiveMetadataChanged` 调用点，无一依赖此副作用。

**第三轮**（C 格 bootstrap 10→4）

4. `publicBootstrap.ts` 的并发去重条件把 `cacheBust` 排除在外，
   而两个订阅者恰好都传 `cacheBust: true` —— 于是同一毫秒对同一端点发两次
   完全相同的请求。改为按"在途请求本身是否新鲜"判断，并按
   `include_hidden` 分槽。

---

## 七、明确不做

| 项目 | 理由 |
|------|------|
| 改 cron 频率 | 用户约束：通知功能依赖，`*/2` 不动 |
| 改 3 秒 / 120 秒 的实时性配置 | 不是成本来源；改了直接违反核心体验约束 |
| 熔断后给轮询降速 | 决策 3：体验优先。停手 2 分钟后已自动降到 30/小时 |
| 延长 viewer 窗口到 15 分钟 | v1 的错误提案，见下 |
| 删 `scroll` 监听 | v1 的错误提案，见下 |
| 删 `onerror` 里的 `fetchLiveData()` | v1 的错误提案，见下 |
| 针对 DO duration 做优化 | 已确认使用休眠版 API 且无定时器，结构上不计费 |
| 给 fallback 加会话过期 | 会误伤"面板挂副屏当监控墙"的合理场景 |

---

## 八、v1 错误存档（供追溯，勿采信）

### ✗ v1 错误 1：把 IP 绑定当作"已闭环验证的根因"

v1 写道"根因（已闭环验证）"。实际只验证了两件事：
(a) 换 IP 的 token 会被拒 —— 证明**机制存在**；
(b) 推算的 480/小时 与观测平台吻合 —— 这是**数值巧合论证，不是因果论证**。
从未在真实流量中观测到一次 403。触发 WS 失败的可能还包括代理阻断
WebSocket、边缘抖动、DO 过载等。

**修正**：IP 绑定降级为"降低触发概率"的风险权衡项；真正的缺陷是
**放大器**（死掉的 `hidden` 守卫 + 无退避 + 无熔断），它对触发原因免疫。

### ✗ v1 错误 2：`DEFAULT_VIEWER_TTL_SECONDS` 120 → 900

两个问题：
1. **未察觉耦合** —— 该常量同时决定通行证有效期（`websocket.ts:308`），
   改完会把被盗证的可用窗口从 2 分钟拉到 15 分钟，安全性无谓下降。
2. **与决策 5 冲突** —— 窗口正是"隐藏后释放 viewer 身份"的机制，
   拉长到 15 分钟会让探针在无人观看时多保持 3 秒上报长达 15 分钟。

按用户实际习惯（"只在需要时打开，看几分钟就关"），看 5 分钟仅续期 2 次
= 4 个请求，延长窗口能省的微乎其微。**改为：默认值不动，只拆耦合。**

### ✗ v1 错误 3：删 `scroll` 监听

滚动是"人在看"的有效信号。删掉会让只滚不点的用户被误判为无人，
实时性掉到 2 分钟，直接违反核心体验约束。

### ✗ v1 错误 4：删 `onerror` 里的 `fetchLiveData()`

v1 称 `onclose` 那次是"与 3 重复"。实际 `onclose` 那次填补了轮询器
最长 120 秒的排期空档，删错会造成数据断档。

### ✗ 更早的错误（已在 v1 中存档，此处保留索引）

- "DO 永不休眠 → 10,800 GB-s/天" —— 误读定价文档；"空闲且**符合**休眠条件"
  即不计费。本次已从源码二次确认（`acceptWebSocket` + 零定时器）。
- "挂在后台是主因，40 倍放大" —— 当时因 20:1 折算被推翻；
  **但本次发现该结论在 WS 坏掉的状态下重新成立**，只是机制完全不同
  （不是消息密度，是重连循环）。
- "Notifications 页面触发 18 个 API 调用" —— 误把全文件 `apiFetch`
  出现次数当作挂载开销。
