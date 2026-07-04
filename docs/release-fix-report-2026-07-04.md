# CF VPS Monitor 发布前修复与回归报告（2026-07-04）

## 结论

本轮已修复发布前测试报告中影响发布判断的主要问题，并已部署到演示 Worker。线上验证结果显示：后台登录与核心后台 API 正常，VPS Agent 能重新获取网站探测任务，Supabase 审计日志未再新增 `agent_policy_website_probe_tasks_error`。

内置浏览器插件在本轮收尾验证时出现会话/快照能力异常，因此页面级回归以代码检查、构建产物、线上 HTTP/API 验证和 VPS 实机请求为准。

## 已修复问题

### 1. Supabase 分组迁移被旧 checksum 跳过

- 修复文件：`worker/src/routes/setup.ts`
- 问题：数据库初始化只按 migration `version` 判断是否已执行。项目使用分组迁移后，同一个版本文件追加 SQL 会改变 checksum，但线上旧 checksum 仍会被跳过，导致 RPC 缺失。
- 修复：迁移记录改为按 `version + checksum` 判断；SQL 执行成功后使用 `on conflict(version) do update` 刷新 checksum、name、applied_at。
- 回归检查：`scripts/check-setup-migration-checksum.mjs`

### 2. 缺失的 Agent 网站探测 RPC

- 修复文件：`supabase/migrations/20260622000000_rpc_api.sql`
- 问题：线上缺失 `public.cfm_agent_website_probe_tasks(text,text,integer)`，Agent policy 无法下发网站探测任务。
- 修复：线上 Supabase 已补齐该函数、授权并刷新 PostgREST schema cache。
- 额外修复：RPC 内部 `union` 不再混用 `wm.*`，改为所有分支显式列清单，避免列顺序变化导致 `UNION types integer and text cannot be matched`。
- 回归检查：`scripts/check-agent-website-probe-rpc-shape.mjs`

### 3. Agent 内存日志显示 0GB/0GB

- 修复文件：`agent/main.go`
- 问题：512MB LXC 环境中，采集值正常，但日志以 GiB 整数格式输出，导致小于 1GiB 的内存显示为 `0GB/0GB`。
- 修复：新增 `formatMemoryBytes`，小于 1GiB 显示 MiB，大于等于 1GiB 显示 GiB。
- 回归测试：`agent/main_test.go`

### 4. 正式版本仍显示 dev build 标识

- 修复文件：`worker/src/index.ts`
- 问题：`/api/version` 硬编码开发 build 标识。
- 修复：返回 `build: release-${appVersion}`。
- 线上验证：`/api/version` 返回 `version=2.0.0`、`build=release-2.0.0`。
- 回归检查：`scripts/check-release-version-build.mjs`

### 5. 备份与恢复入口不易发现

- 修复文件：`frontend/src/pages/admin/SettingsSite.tsx`
- 问题：备份与恢复功能位于默认折叠卡片中，测试时只看到标题。
- 修复：该卡片默认展开。
- 回归检查：`scripts/check-site-backup-visible.mjs`

### 6. 通知页新旧路由混用

- 修复文件：`frontend/src/App.tsx`
- 问题：旧路由 `/admin/notification/:tab` 与新路由 `/admin/notifications/:tab` 并存，可能造成标签状态混乱。
- 修复：旧路由统一重定向到 canonical 新路由。
- 回归检查：`scripts/check-notification-canonical-routes.mjs`

### 7. Windows 下迁移生成 checksum 不稳定

- 修复文件：`scripts/generate-migrations.mjs`
- 问题：CRLF/LF 差异可能导致生成迁移 checksum 不稳定。
- 修复：生成前统一规范化为 LF。

## 部署结果

- Worker：`cf-vps-monitor-demo`
- 部署地址：`https://cf-vps-monitor-demo.work-631.workers.dev`
- Wrangler 部署结果：成功
- 当前 Worker Version ID：`622036a7-2832-4663-b3c1-b85418b12142`
- 部署绑定确认：`SUPABASE_URL` 指向演示 Supabase 项目；Secrets 使用 `--keep-vars` 保留线上配置。

## 线上回归验证

### API 与后台

- `GET /api/version`：200，返回 `version=2.0.0`、`build=release-2.0.0`
- `POST /api/login`：200
- `GET /api/me`：200，返回当前管理员
- `GET /api/admin/settings`：200
- `GET /api/admin/clients`：200，返回 3 台客户端
- `GET /api/admin/websites`：200，返回 3 个网站监控

### VPS Agent policy

从目标 VPS 使用 Agent 本机配置请求线上 Worker：

- `type=policy`
- `mode=idle`
- `sample_interval_sec=120`
- `report_interval_sec=120`
- `ping_tasks=5`
- `website_probe_tasks=3`

结论：Agent 网站探测任务已可下发。

### Supabase 审计日志

查询 `agent_policy_website_probe_tasks_error` 最近记录：

- 最新错误时间停留在 `2026-07-04 08:39:33 UTC`
- 线上补函数、部署和 VPS policy 验证后未再新增同类错误

## 本地验证

已执行：

```bash
npm run verify
```

结果：通过。覆盖内容包括：

- frontend TypeScript 检查
- Worker `wrangler types --check`
- Worker TypeScript 检查
- frontend build
- Worker build
- 全部 `scripts/check-*.mjs`
- Agent `go test ./...`

已执行敏感信息扫描，未发现本次使用的真实密码、Supabase secret、Supabase access token 写入代码或文档。命中项仅为示例占位符、脱敏逻辑和前端占位提示。

## 仍受限项

- 本轮未执行真实删除服务器、重置 Agent Token、修改管理员密码、发送 Telegram/SMTP 测试消息、导入备份等有副作用操作。
- 收尾阶段内置浏览器插件异常，未能重新做可视化页面截图回归；页面相关修复已通过静态检查、构建和线上后台 API 验证覆盖。
