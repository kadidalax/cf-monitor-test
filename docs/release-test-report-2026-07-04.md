# CF VPS Monitor 发布前测试报告（2026-07-04）

## 结论摘要

本次对演示站、公开前台、后台页面、公开 API、后台 API、Supabase 数据库、Cloudflare Worker、VPS Agent 链路和本地自动化测试做了发布前复测。当前主要阻断项已修复，演示环境可作为 `2.0.0` 发布候选继续推进。

最新线上证据显示：

- `/api/version` 返回 `version=2.0.0`、`build=release-2.0.0`。
- 公开首页显示 3 台节点在线，目标 LXC 节点内存显示为 `28 MB / 488 MB` 级别，不再是 `0GB/0GB`。
- 公开网站监控显示 3 个站点正常。
- 后台登录态 API、后台页面和核心配置页面可访问。
- Supabase 已存在 `public.cfm_agent_website_probe_tasks(text,text,integer)`。
- 直接调用 Agent 网站探测 RPC 可返回 3 个网站探测任务。
- `2026-07-04 09:42:00 UTC` 后未再出现 `agent_policy_website_probe_tasks_error`。

## 测试环境

- 测试时间：2026-07-04（Asia/Shanghai）
- 测试站点：`https://cf-vps-monitor-demo.work-631.workers.dev/`
- Worker：`cf-vps-monitor-demo`
- 数据库：Supabase 项目 `airwgcvmetaobzjabefo`
- 目标 VPS：`23.95.84.106:32222`
- 测试账号：管理员账号（密码未写入本文档）
- 本地工作区：`C:\工作区\cf-vps-monitor`

## 覆盖范围

- 本地验证：前端 lint、Worker 类型检查、前端构建、Worker 构建、脚本化回归、Agent Go 测试。
- 浏览器：公开服务器监控、公开网站监控、后台服务器、后台网站、Ping 任务、站点设置、通用设置、通知设置、离线通知、到期通知、负载通知、主题、审计日志、账户、关于。
- API：公开 API、登录态后台 API、未登录后台 API、健康检查、版本接口。
- 数据库：RPC 存在性、RPC 直接调用、表行数、schema 版本、审计错误日志。
- VPS Agent：通过线上数据和 RPC/策略链路验证 Agent 相关修复；未重新执行破坏性 Agent 重装。
- Cloudflare Worker：线上 API、后台健康接口、部署后版本标识。

## 自动化验证

已执行 `npm run verify`，退出码为 0。覆盖内容包括：

- frontend TypeScript lint
- Worker `wrangler types --check`
- Worker TypeScript 检查
- frontend build
- Worker build
- 全部 `scripts/check-*.mjs`
- Agent `go test ./...`

## 公开前台测试

公开首页加载成功，显示：

- 站点标题：`CF VPS Monitor 演示站`
- 当前在线：`3 / 3`
- 服务器结果：3 台
- 目标节点：`test2-LXC`
- 目标节点 IP：`23.95.84.106`
- 目标节点 Agent：前台卡片显示在线，后台显示 `v2.0.1`
- 目标节点内存：约 `28 MB / 488 MB`

已验证：

- `服务器监控 / 网站监控` 页签可切换。
- `全部 / 在线 / 离线` 过滤控件可见。
- 网站监控页显示 `3 正常 / 0 失效 / 3 总数`。
- 网站监控显示 `gayhub`、`ITdog`、`谷哥` 三个站点，当前均正常。
- 网站监控 `1小时 / 24小时 / 72小时` 控件可见。

## 登录与权限

浏览器会话已进入后台登录态，后台首页可访问。

未登录直接访问后台 API，均返回 401：

- `/api/me`
- `/api/admin/clients`
- `/api/admin/settings`
- `/api/admin/ping`
- `/api/admin/websites`
- `/api/admin/logs`

登录态后台 API 验证，均返回 200：

- `/api/me`
- `/api/admin/clients`
- `/api/admin/health`
- `/api/admin/capacity`
- `/api/admin/settings`
- `/api/admin/settings?scope=site`
- `/api/admin/settings?scope=general`
- `/api/admin/settings?scope=notification`
- `/api/admin/ping`
- `/api/admin/websites`
- `/api/admin/logs`
- `/api/admin/themes`

## API 验证

公开 API：

- `/ping`：200，返回 `pong`
- `/api/version`：200，返回 `version=2.0.0`、`build=release-2.0.0`
- `/api/public/bootstrap`：200
- `/api/public`：200
- `/api/clients`：200，返回 3 台客户端
- `/api/websites?hours=24`：200
- `/api/websites?hours=72`：200
- `/api/live/clients`：200，在线客户端 3 台
- `/api/ws/live-token`：200

后台 API：

- `/api/admin/clients`：200，返回 3 台客户端
- `/api/admin/health`：200，`ok=true`
- `/api/admin/capacity`：200
- `/api/admin/ping`：200，返回 5 个 Ping 任务
- `/api/admin/websites`：200，返回 3 个网站监控
- `/api/admin/logs`：200，返回审计日志
- `/api/admin/themes`：200，当前主题为 `next`

## 后台功能测试

### 服务器管理

后台服务器页加载正常：

- 服务器总数：3
- 在线节点：3 / 3
- 节点分组：1
- 隐藏节点：0
- 添加服务器按钮可见
- 过滤、排序、分组控件可见

目标节点 `test2-LXC` 显示在线，IP 为 `23.95.84.106`，Agent 为 `v2.0.1`。

### 网站监控

后台网站页加载正常：

- 全部：3
- 正常：3
- 失效：0
- 隐藏：0
- 添加网站按钮可见
- 每行可见检测、隐藏、停用、编辑、删除操作

当前网站：

- `gayhub`：HTTP 200
- `ITdog`：HTTP 200
- `谷哥`：HTTP 302，仍在期望状态范围内

### Ping 任务

后台 Ping 任务页加载正常：

- 当前结果：5
- 全局任务：5
- 定向任务：0
- 任务视图 / 服务器视图可切换控件可见
- 添加任务按钮可见
- 每行可见上移、下移、编辑、删除操作

当前任务包含北京移动、北京联通、北京电信、biance、poly。

### 设置

站点设置页加载正常，可见：

- 站点标题、站点副标题、站点描述、语言、脚本域名
- 保存按钮
- `备份与恢复` 区域
- `导出加密完整备份`
- `导入备份`

通用设置页加载正常，可见：

- 启用数据记录
- 数据保留时间
- 采集间隔
- 历史写入间隔
- Ping 采集与写入间隔
- 历史高水位
- 用量实时估算
- 维护清理
- 刷新实际行数

未执行维护清理、导入备份等破坏性操作。

### 通知

通知设置页加载正常，可见：

- 通知设置 / 离线通知 / 到期通知 / 负载通知标签
- Telegram 配置
- SMTP 邮件通知配置
- Telegram 测试按钮
- 保存设置按钮

离线通知页加载正常，显示 3 台服务器配置行。

到期通知页加载正常，显示 3 台服务器配置行。

负载通知页加载正常，显示：

- `负载通知 (0 条)`
- `暂无负载通知规则`
- `新建规则`

未发送 Telegram / SMTP 测试消息。

### 主题

主题页加载正常：

- 当前主题：`Next`
- 内置主题：`Monitor`、`Next`
- 上传主题包按钮可见
- 启用、配置、删除按钮可见

未上传外部主题包，未删除内置主题。

### 审计日志

审计日志页加载正常：

- 当前页日志：50
- 活跃用户：2
- 今日操作：50
- 高风险动作：0
- 操作筛选与每页数量控件可见

日志中的客户端 Token 相关详情已显示为 `[REDACTED]`。

### 账户与关于

账户页加载正常：

- 更改用户名标签可见
- 更改密码标签可见
- 修改用户名按钮可见

未修改真实账号。

关于页加载正常：

- 显示 `CF VPS Monitor`
- 显示版本 `v2.0.0`
- 显示 Cloudflare Workers、Supabase HTTP API、Durable Objects、React + Radix UI 等技术信息

## 数据库验证

使用 Supabase Management API 执行只读 SQL，结果：

- `public.cfm_agent_website_probe_tasks(text,text,integer)` 存在。
- `settings.schema_bootstrap_version` 为 `postgres-2026-07-03-v1`。
- 直接调用 `cfm_agent_website_probe_tasks` 可返回 3 个网站探测任务。
- `2026-07-04 09:42:00 UTC` 后 `agent_policy_website_probe_tasks_error` 数量为 0。
- 最新一条 `agent_policy_website_probe_tasks_error` 停留在 `2026-07-04 08:39:33 UTC`。

主要表行数：

- `clients`：3
- `website_monitors`：3
- `ping_tasks`：5
- `audit_logs`：5463
- `records`：3829
- `ping_records`：0
- `website_checks`：6356

## VPS Agent 验证

本轮复测通过线上数据、后台页面和数据库 RPC 验证 Agent 链路：

- 目标节点 `test2-LXC` 在线。
- 后台显示目标节点 Agent 为 `v2.0.1`。
- 前台内存展示为 MB 级真实值，不再显示 `0GB/0GB`。
- Agent 网站探测 RPC 可返回 3 个任务。
- 修复后审计日志没有新的 Agent 网站探测任务错误。

未重新执行 Agent 卸载、重装、重置 Token 或破坏性服务操作。

## Cloudflare Worker 验证

线上 Worker 验证结果：

- `/ping` 正常。
- `/api/version` 正常，构建标识为 `release-2.0.0`。
- `/api/admin/health` 正常，`ok=true`。
- 后台 API 均能通过登录态访问。

仓库配置仍以 `wrangler.toml` 为准：

- Worker 入口：`worker/src/index.ts`
- Durable Objects：`LIVE_DATA`、`RATE_LIMIT`
- Cron：`*/2 * * * *`
- Assets：`frontend/dist`
- `run_worker_first`：`/api/*`、`/ping`、`/agent/*`
- 必需 Secrets：`JWT_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`

## 已关闭的问题

### 原 P0：线上缺失 `cfm_agent_website_probe_tasks` RPC

状态：已关闭。

证据：

- `to_regprocedure('public.cfm_agent_website_probe_tasks(text,text,integer)')` 返回函数签名。
- 直接调用 RPC 返回 3 个网站探测任务。
- 修复后时间窗口内无新增 `agent_policy_website_probe_tasks_error`。

### 原 P1：LXC 内存显示 `0GB/0GB`

状态：已关闭。

证据：

- 公开前台目标节点显示约 `28 MB / 488 MB`。
- 后台目标节点在线，Agent 版本为 `v2.0.1`。

### 原 P1：版本 build 仍带 dev 信息

状态：已关闭。

证据：

- `/api/version` 返回 `build=release-2.0.0`。

### 原 P2：通知页负载标签切换/路由疑点

状态：已关闭。

证据：

- `/admin/notifications/load` 加载正常。
- 页面显示 `负载通知 (0 条)`、`暂无负载通知规则`、`新建规则`。

### 原 P2：备份与恢复入口不明显

状态：已关闭。

证据：

- `/admin/settings` 默认可见 `备份与恢复`、`导出加密完整备份`、`导入备份`。

## 仍受限项

- 未执行真实删除服务器、重置 Agent Token、修改管理员密码、发送 Telegram/SMTP 测试消息、上传主题包、导入备份、维护清理等有副作用操作。
- 未做高并发、长时间稳定性、断网重连、Agent 自动升级/卸载重装破坏性测试。
- 未使用 Cloudflare 控制台查看 Secrets 或实时日志；本轮以线上 Worker API、后台健康检查、部署结果和数据库证据为准。
- 未对移动端所有断点逐页截图，只做了桌面浏览器和 API/数据库复测。

## 发布建议

当前演示环境已通过发布前核心测试。建议发布前再做一次最终门禁：

1. 保持 `npm run verify` 通过。
2. 确认 Worker 部署使用 `--keep-vars` 保留线上 Secrets。
3. 发布后立即检查 `/api/version`、`/api/admin/health`、公开首页、后台网站页和 Supabase 审计日志。
4. 若要声明完整 Agent 生命周期支持，再单独安排重装、升级、断网重连和恢复类测试。
