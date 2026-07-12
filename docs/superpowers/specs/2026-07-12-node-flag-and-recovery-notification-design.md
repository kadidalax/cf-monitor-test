# 节点国旗与恢复上线通知设计

日期：2026-07-12

## 目标

在 dev 分支修复两个已确认问题：

- `韩国首尔`、`甲骨文韩国首尔`、`ap-seoul-1` 等地区文本无法解析为韩国国旗。
- 节点离线告警后恢复上报时不发送恢复上线通知。

删除网站问题不在本次范围内。

## 非目标

- 不修改网站删除接口或部署逻辑。
- 不新增通知事件表、队列、重试系统或规则引擎。
- 不从 Agent 上报路径直接发送恢复通知。
- 不新增精确的 `offline_since` 字段，不在恢复消息中承诺精确故障时长。

## 国旗解析

### 根因

当前 `resolveFlagCode` 先提取任意独立两字母片段，再扫描地区别名，并用 `alias.length > 2` 排除短别名。这会造成：

- `ap-seoul-1` 先匹配为 `AP`，不会继续识别 `seoul`。
- `韩国`、`首尔` 都是两个汉字，被长度条件排除。
- `alias.includes(normalized)` 允许反向模糊匹配，可能把短输入错误映射到较长别名。

### 设计

解析顺序调整为：

1. 空值返回 `UN`。
2. 国旗 Emoji 转换为两字母代码。
3. 完整别名精确匹配。
4. 扫描输入中包含的语义别名：只跳过纯 ASCII 两字母代码，保留两个汉字别名；只允许 `normalized.includes(alias)`。
5. 最后识别独立两字母代码。
6. 无匹配返回 `UN`。

不增加地区库依赖，继续复用现有别名和静态 SVG。

### 验收样例

| 输入 | 结果 |
| --- | --- |
| `韩国首尔` | `KR` |
| `甲骨文韩国首尔` | `KR` |
| `ap-seoul-1` | `KR` |
| `Seoul, Seoul, KR` | `KR` |
| `ap-tokyo-1` | `JP` |
| `eu-frankfurt-1` | `DE` |
| 未知文本 | `UN` |

解析逻辑应移到无 JSX 的纯 TypeScript 工具文件，以便用现有 Node assert 测试直接执行；`Flag.tsx` 只负责渲染。

### Komari 对照后的优先级修正

Komari 后端将 GeoIP 返回的 ISO 两字母代码转换为国旗 Emoji，前端只处理 Emoji 或精确两字母代码，不从国家名称做模糊推断。当前项目需要保留城市、州和国家组成的完整地区文本，因此不改变数据库结构，借鉴其“明确 ISO 代码优先”原则：

1. 完整别名精确匹配后，优先提取输入末尾的独立两字母代码。
2. 末尾代码视为 GeoIP 的权威国家代码，例如 `North Korea, KP` 必须返回 `KP`。
3. 只有不存在末尾代码时才扫描语义别名，因此 `ap-seoul-1`、`eu-frankfurt-1` 仍分别返回 `KR`、`DE`。
4. 保留最后的通用独立代码回退和未知地区 `UN` 回退。

新增验收样例：

| 输入 | 结果 |
| --- | --- |
| `North Korea, KP` | `KP` |
| `KP` | `KP` |
| `South Korea, KR` | `KR` |

## 恢复上线通知

### 根因

当前 Cron 仅判断节点是否超过离线宽限期。`last_notified` 被当作重复提醒冷却时间：持续离线超过一个宽限期会再次告警；恢复在线时判定函数只返回 `null`，没有恢复事件、恢复模板或状态清理。

### 状态模型

复用 `offline_notifications.last_notified` 作为“离线事件已告警”的持久化标记：

| 当前状态 | `last_notified` | 动作 |
| --- | --- | --- |
| 在线 | `NULL` | 无 |
| 离线 | `NULL` | 发送离线通知，写入当前时间 |
| 离线 | 非 `NULL` | 无，避免重复提醒 |
| 在线 | 非 `NULL` | 发送恢复通知，清空为 `NULL` |

离线判定继续使用现有数据库最新上报时间和 `grace_period`，Cron 继续每两分钟执行。Cloudflare 官方文档说明 Scheduled Handler 会等待返回的 Promise，因此保持当前 `await runScheduled()` 路径。

### 数据流

1. Cron 读取启用的离线通知规则、节点资料和最新上报时间。
2. 纯函数根据 `now`、最新上报时间、宽限期和 `last_notified` 返回 `offline`、`recovery` 或 `none`。
3. `offline` 使用现有 `buildOfflineNotification` 和公共 `dispatchNotification`。
4. `recovery` 使用新增的节点恢复模板，并通过同一公共分发入口发送 Telegram、Email 或 Webhook。
5. 事件处理后更新 `last_notified`；关闭规则时清空旧标记，避免重新启用后发送过期恢复通知。
6. 写入 `offline_notify` 或 `online_notify` 审计日志。

### 数据库兼容

不新增表和列。

现有 RPC `cfm_mark_offline_notification_sent` 只能写入非空时间。升级迁移应允许清空状态，使用 `nullif(input_time, '')::timestamptz`，并保持现有 `set search_path`、`revoke`、`grant service_role` 约束。

新部署的基础迁移和升级迁移必须产生一致状态；更新后重新生成 `worker/src/generated/supabase-migrations.ts`。

### 通知语义

- 只有已发送/记录过离线事件的节点才发送恢复通知。
- 宽限期内恢复，不发送离线或恢复通知。
- “从未上报”节点触发离线告警后首次上报，视为恢复上线。
- 通知通道关闭或发送失败时，沿用当前“记录事件并推进状态”的 best-effort 语义，不引入重试队列。
- 恢复消息包含节点名和恢复时间，不显示不准确的故障持续时长。

## 测试

新增最小可执行测试：

- 国旗解析：覆盖表格中的主要输入及未知回退。
- 状态转换：覆盖四种核心状态组合。
- 宽限期内恢复不通知。
- “从未上报”告警后首次上线产生恢复事件。
- 规则关闭清空 `last_notified`。
- 节点恢复模板包含正确的事件、节点和时间字段。
- Supabase 迁移与生成迁移包含可清空 `last_notified` 的 RPC，并保留函数权限。

dev 验证命令：

```bash
node frontend/src/utils/flag.test.mjs
node worker/src/index.offline-notification.test.mjs
node worker/src/utils/notification-templates.test.mjs
npm run build:migrations
npm run verify
npm run verify:cloudflare
```

外网依赖通过 `127.0.0.1:10808` 代理访问。

## 发布顺序

1. 仅在 `C:\工作区\cf-vps-monitor-dev` 的 dev 分支实现。
2. 本地测试与 Cloudflare dry-run 全部通过。
3. 恢复或确认测试仓库远程 dev 分支，部署到 `cf-monitor-test`。
4. 测试韩国首尔国旗、离线告警、持续离线不重复、恢复上线通知。
5. 验证 `/api/version` 对应 dev commit。
6. dev 验收后再决定是否同步 main。
