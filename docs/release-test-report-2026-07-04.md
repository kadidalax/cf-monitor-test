# CF VPS Monitor 发布前测试报告（2026-07-04）

## 结论摘要

本次对演示环境、后台管理、公开 API、后台 API、Supabase 数据库、Cloudflare Worker、VPS Agent 和本地自动化验证做了发布前测试。整体结论：**当前版本不建议直接发布为正式版**，原因是线上数据库缺失 Agent 网站探测任务 RPC，导致网站探测任务无法下发到 VPS Agent；同时目标 VPS 的内存采集存在 0GB/0GB 异常。

已确认正常的核心能力包括：公开首页、服务器详情、后台登录与鉴权、服务器管理弹窗流、网站监控 CRUD、Ping 任务 CRUD、主题预览、审计日志列表、后台健康检查、VPS Agent WebSocket 上报和 Ping 任务策略同步。

## 测试环境

- 测试时间：2026-07-04（Asia/Shanghai）
- 测试站点：`https://cf-vps-monitor-demo.work-631.workers.dev/`
- Worker：`cf-vps-monitor-demo`
- 数据库：Supabase 项目 `airwgcvmetaobzjabefo`
- 目标 VPS：`23.95.84.106:32222`
- 测试账号：管理员账号（密码未写入本文档）
- 本地工作区：`C:\工作区\cf-vps-monitor`

## 覆盖范围

- 本地验证：前端类型检查、Worker 类型检查、前端构建、Worker 构建、脚本一致性检查、Agent Go 测试。
- 浏览器：公开首页、服务器监控、网站监控、服务器详情、登录页、后台服务器、后台网站、Ping 任务、设置、通知、主题、审计日志、账户、关于。
- API：公开 API、登录态后台 API、未登录后台 API、健康检查、版本接口。
- 数据库：函数存在性、表行数、schema 版本、临时测试数据清理、审计错误日志。
- VPS Agent：SSH 只读检查、systemd 服务、进程、日志、Worker 连通性。
- Cloudflare Worker：公开接口、后台健康接口、Wrangler 本地版本与仓库配置核对。

## 自动化验证

执行 `npm run verify`，结果通过，退出码为 0。覆盖内容包括：

- frontend TypeScript lint
- Worker `wrangler types` 与 `tsc`
- frontend build
- Worker build
- `scripts/check-*.mjs`
- `agent go test ./...`

## 公开前台测试

公开首页加载成功，显示 3 个在线节点。顶栏“服务器监控 / 网站监控”切换正常；服务器过滤“全部 / 在线 / 离线”正常；网格视图与表格视图正常；节点卡片 Ping 小图按钮可展开图表；网站监控前台视图可显示 3 个网站监控，`1h / 24h / 72h` 控件可见。

服务器详情页打开 `test2-LXC` 正常，UUID 为 `f2e3faee-ee6f-42ff-b380-f0f0b22be0a5`。详情页显示目标 VPS、Agent `v2.0.0`、在线状态；时间范围 `1小时 / 4小时 / 24小时 / 3天` 可切换；图表标签 `CPU / 内存 / 磁盘 / 网络 / 连接数 / 进程数 / 温度` 可切换；Ping 延迟图显示 5 个任务。

公开 API 验证结果：

- `/ping`：200
- `/api/version`：200，返回 `version=2.0.0`，`build=dev-agent-ws-query-token-20260701`
- `/api/public/bootstrap`：200
- `/api/public`：200
- `/api/clients`：200
- `/api/websites?hours=24`：200
- `/api/websites?hours=72`：200
- `/api/live/clients`：200
- `/api/ws/live-token`：200

## 登录与权限

登录页验证：

- 空表单提交提示“请输入用户名和密码”。
- 错误密码提示“用户名或密码错误”。
- 密码显示 / 隐藏状态可切换。
- 正确登录后进入 `/admin`。

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
- `/api/admin/ping`
- `/api/admin/websites`
- `/api/admin/logs`
- `/api/admin/themes`

低优先级体验问题：登录失败后再成功登录，旧错误 toast 文案会短暂残留。

## 后台功能测试

### 服务器管理

后台服务器页加载 3 个节点，目标 `test2-LXC` 在线，IP 为 `23.95.84.106`，Agent `v2.0.0`。

已验证：

- 过滤：全部 / 在线 / 离线
- 排序：名称 / 状态
- 刷新
- 添加服务器弹窗
- 编辑服务器弹窗
- 安装命令弹窗
- 重置 Token 确认弹窗
- 删除确认弹窗
- 复制 IP

危险操作只打开确认弹窗或取消，没有执行真实删除、重置 Token。

### 网站监控

创建临时网站监控 `codex-release-test-site`，URL 为 `https://example.com`。已验证：

- 创建成功并出现在列表。
- 手动检测成功，HTTP 200。
- 隐藏 / 公开切换正常。
- 停用 / 启用切换正常。
- 编辑弹窗可打开。
- 删除确认后可删除。
- 删除后列表中消失。
- 审计日志记录添加、手动检测、隐藏 / 显示、停用 / 启用、删除操作。

数据库复查确认临时网站监控已清理，剩余 0 条同名数据。

### Ping 任务

创建临时 Ping 任务 `codex-release-test-ping`，类型 TCP，目标 `1.1.1.1:53`。已验证：

- 创建成功，任务数从 5 变为 6。
- 编辑弹窗可打开。
- 删除确认后可删除。
- 删除后任务数回到 5。
- 任务视图 / 服务器视图可切换。
- Agent 日志显示策略曾更新为 6 个任务，删除后回到 5 个任务。

数据库复查确认临时 Ping 任务已清理，剩余 0 条同名数据。

### 设置

站点设置页加载正常，可见站点标题、副标题、描述、语言、脚本域名和保存按钮。

问题：`备份与恢复`区域只显示标题“导出或导入系统配置”，未发现明确的导出、导入、上传或下载按钮。该功能入口可发现性不足，或当前页面渲染缺失操作控件。

通用设置页加载正常，显示采集间隔、保留时间、写入间隔等设置；用量估算正常；`维护清理`、`刷新实际行数`按钮可见。未执行破坏性维护操作。

### 通知

通知设置、离线通知、到期通知标签可切换。Telegram / SMTP 配置区域可见，Telegram 测试按钮可见，但未实际发送外部消息。负载通知直接访问 `/admin/notifications/load` 正常，显示 0 条规则，新建规则弹窗可打开。

疑点：从到期通知标签点击负载通知时，页面内容疑似仍停留在到期列表；直接访问负载通知路由正常。建议复查标签切换状态同步。

### 主题

主题页显示内置主题 Monitor 与 Next，上传主题包按钮可见。当前 Next；Monitor 可启用，Next 启用按钮禁用；两个主题配置按钮可用；内置主题删除按钮禁用。

配置弹窗可打开，包含自定义 CSS、示例片段、预览、恢复 / 还原、取消、保存。预览按钮可用，并提示“已临时预览，仅当前浏览器生效”。

### 审计日志、账户、关于

审计日志页加载 50 条记录，显示当前页日志、活跃用户、今日操作、高风险动作指标，分页控件可见。

账户页用户名修改区域可见，空用户名时“修改用户名”禁用；更改密码标签可切换，显示旧密码、新密码、确认新密码、修改密码。未修改真实账号。

关于页 / 版本接口显示 `version=2.0.0`，但 build 字段仍为 `dev-agent-ws-query-token-20260701`。发布前建议改为正式构建标识，避免正式版显示 dev 构建信息。

## 数据库验证

使用 Supabase Management API 执行只读 SQL，结果：

- `public.cfm_agent_website_probe_tasks(text,text,integer)` 不存在。
- `pg_proc` 中无 `cfm_agent_website_probe_tasks` 函数。
- `settings.schema_bootstrap_version` 为 `postgres-2026-07-03-v1`。
- 主要表行数：
  - `clients`：3
  - `website_monitors`：3
  - `ping_tasks`：5
  - `audit_logs`：5378
  - `records`：3819
  - `ping_records`：0
  - `website_checks`：6356
- 临时测试数据已清理：
  - `codex-release-test-site`：0
  - `codex-release-test-ping`：0

审计日志持续出现错误：

```text
agent_policy_website_probe_tasks_error:
website probe tasks lookup failed; policy sent without website probes;
Supabase RPC cfm_agent_website_probe_tasks failed: 404 PGRST202
```

仓库迁移 `supabase/migrations/20260622000000_rpc_api.sql` 中包含该函数定义和授权，但线上数据库实际不存在该函数。说明线上 Supabase schema 与代码期望不一致，可能是迁移未完整应用、合并迁移漏项，或 PostgREST schema cache 曾未刷新；当前只读查询证明函数本身不存在，不只是缓存问题。

## VPS Agent 验证

目标 VPS 可 SSH 连接，只读检查结果：

- 系统：Debian / Linux 6.12 系列内核。
- Worker 连通性：VPS 上 `curl https://cf-vps-monitor-demo.work-631.workers.dev/ping` 返回 `pong`。
- Agent 服务：`cf-vps-monitor-agent-f2e3faee-ee6f-42ff-b380-f0f0b22be0a5.service`
- systemd 状态：loaded / enabled / active running，已运行 3 天以上。
- Agent 进程：`/opt/cf-vps-monitor/.../cf-vps-monitor-agent --interval 3 --ping-interval 120 --traffic-reset-day 1`
- 日志：持续发送 WebSocket report，并收到 ack；Ping 任务按策略执行。
- 服务安全配置：使用专用用户，含 `NoNewPrivileges`、`ProtectSystem`、`PrivateTmp` 等限制；LXC 环境下存在 systemd drop-in 放宽部分限制。

问题：Agent 日志与前台曾显示内存 `0.0GB/0GB`，但 VPS 实际内存为 512MB：

- `free -b` 显示总内存 `512000000`
- `/proc/meminfo` 显示 `MemTotal: 500000 kB`
- cgroup `memory.max` 为 `512000000`

这说明 LXC 内存采集或上报/展示链路存在异常。浏览器后续页面刷新中曾看到 `27.22 MB / 488 MB`，但 Agent 日志中仍有 `RAM 0.0GB/0GB`，建议进一步检查 Agent 上报字段与日志格式是否使用了不同来源。

## Cloudflare Worker 验证

仓库 `wrangler.toml` 配置：

- Worker 入口：`worker/src/index.ts`
- compatibility_date：`2026-06-21`
- Durable Objects：`LIVE_DATA`、`RATE_LIMIT`
- Cron：`*/2 * * * *`
- Assets：`frontend/dist`
- `run_worker_first`：`/api/*`、`/ping`、`/agent/*`
- 必需 Secrets：`JWT_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`

本地 Wrangler 版本：`4.104.0`。

线上 `/api/admin/health` 返回 200，`ok=true`。可见组件包括数据库连接探针、DO 记录持久化、Ping 持久化、Cron 清理、负载告警、离线告警、到期提醒、网站监控、Demo reset 等。Telegram 为 disabled，原因是未配置凭据。

未使用 Cloudflare 账号做部署、实时日志或生产配置变更；本次只做读测和公开/后台接口验证。

## 问题清单

### P0：线上缺失 `cfm_agent_website_probe_tasks` RPC，Agent 网站探测任务无法下发

证据：

- Supabase 只读查询 `to_regprocedure(...)` 返回 `null`。
- `pg_proc` 中无该函数。
- 审计日志持续记录 `agent_policy_website_probe_tasks_error`。
- 错误为 PostgREST `PGRST202`，Worker 发送 policy 时回退为“不带 website probes”。

影响：

- 使用 Agent 进行网站探测的功能无法正常工作。
- 前台 Worker 侧网站监控仍可运行，但发布说明中的 Agent 探测能力不完整。

建议：

- 对比线上数据库与 `supabase/migrations` / `worker/src/generated/supabase-migrations.ts`。
- 补齐 `cfm_agent_website_probe_tasks` 及相关 grant。
- 执行 `notify pgrst, 'reload schema'` 或通过 Supabase 重载 schema cache。
- 修复后用只读 SQL 和 Agent 日志验证 policy 中出现 website probe tasks。

### P1：VPS Agent 内存采集存在 0GB/0GB 异常

证据：

- Agent 日志出现 `RAM 0.0GB/0GB`。
- VPS 系统实际内存为 512MB。

影响：

- LXC / cgroup 环境下内存指标可能错误，影响前台展示、告警和容量判断。

建议：

- 检查 Agent 在 cgroup v2 / LXC 环境下读取内存总量的逻辑。
- 增加 `/proc/meminfo` 与 `/sys/fs/cgroup/memory.max` 的 fallback。
- 给 LXC 环境加 Agent 单元测试或集成测试样例。

### P1：发布构建标识仍带 dev 信息

证据：

- `/api/version` 返回 `version=2.0.0`，但 `build=dev-agent-ws-query-token-20260701`。

影响：

- 正式发布后难以区分真实发布构建与开发构建。

建议：

- 发布流水线注入正式 build id、commit hash 或 tag。
- 关于页与版本接口统一显示正式版本信息。

### P2：通知页负载通知标签切换疑似不刷新内容

证据：

- 直接访问 `/admin/notifications/load` 正常。
- 从到期通知标签点击负载通知时，页面内容疑似仍停留在到期列表。

建议：

- 检查通知页标签状态与路由同步。
- 增加从任意通知子页切到负载通知的前端测试。

### P2：站点设置“备份与恢复”缺少明确操作入口

证据：

- 页面可见“备份与恢复 / 导出或导入系统配置”。
- 未发现明确导出、导入、上传或下载按钮。

建议：

- 确认设计是否应显示按钮。
- 若已有隐藏按钮，补足可访问名称和可见文案。
- 若功能未完成，发布前隐藏该区域或标注状态。

### P3：登录成功后旧错误提示短暂残留

证据：

- 错误密码后再正确登录，旧错误 toast 文案短暂存在于页面文本中。

建议：

- 登录成功前清理登录错误 toast。

## 未覆盖或受限项

- 未执行真实删除服务器、重置 Agent Token、修改管理员密码、发送 Telegram/SMTP 测试消息、上传主题包、导入备份、维护清理等有副作用操作。
- 浏览器移动端视口能力在本次环境未实际切到 390px，真实移动断点没有可靠覆盖；仅验证了新标签加载、无控制台错误和 1280px 下无横向溢出。
- 未使用 Cloudflare 账号查看生产 Worker 部署记录、实时日志和 Secrets；本次以公开/后台接口、仓库配置和健康检查为准。
- 未对高并发、长时间稳定性、断网重连、Agent 自动升级/卸载重装做破坏性测试。

## 发布建议

发布前至少完成以下修复和回归：

1. 修复线上 Supabase 缺失 `cfm_agent_website_probe_tasks`，确认 Agent policy 能下发网站探测任务。
2. 修复或解释 LXC 内存 0GB/0GB 问题，确保发布说明中对 LXC 支持准确。
3. 将版本 build 标识改为正式发布信息。
4. 复查通知页负载标签切换和站点设置备份恢复入口。
5. 重新执行 `npm run verify`、数据库只读 SQL、目标 VPS Agent 日志检查和浏览器冒烟测试。

