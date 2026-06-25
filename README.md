# CF VPS Monitor

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kadidalax/cf-monitor-test)

CF VPS Monitor 是一个基于 Cloudflare Workers、Durable Objects、Workers Static Assets 和 Supabase 的轻量 VPS 探针系统。Worker 负责页面、API、实时连接、定时任务和安全校验；Supabase 只通过 HTTP Data API/RPC 访问；Go Agent 在服务器上采集指标并按需上报。

## 功能总览

- 前台看板：节点卡片、节点列表、实时状态、地区概览、流量概览、网络速率、节点详情页。
- 节点指标：CPU、GPU、内存、Swap、磁盘、负载、温度、网络上下行、月度流量、进程数、TCP/UDP 连接数、运行时间、系统版本、IPv4/IPv6。
- 账单与流量：支持价格、币种、账单周期、到期时间、流量限额和带宽模式展示。
- Ping 延迟监控：支持 ICMP、TCP、HTTP/HTTPS 任务，可按全部节点或指定节点分配，历史曲线在前台展示。
- 网站监控：支持 GET、HEAD、TCP 检测，支持状态码范围、超时、检测间隔、宽限期、手动检测、隐藏、停用、排序和恢复通知。
- 后台节点管理：添加、编辑、删除、批量隐藏、批量删除、拖拽排序、清空记录、Token 生成、安装 Token、Token 轮换。
- Agent 安装命令：后台生成 Linux/Windows 安装、卸载命令，支持下载代理、GitHub 代理、安装目录、服务名、Release Tag、磁盘/网卡筛选和流量重置日。
- 通知管理：支持 Telegram、SMTP Email、测试发送、离线通知、到期提醒、负载通知规则。
- 主题管理：内置主题、主题包上传、主题启用、主题配置、自定义 CSS、图片和字体资源。
- 系统设置：站点标题、副标题、描述、语言、脚本域名、采集间隔、历史保留时间、容量估算参数。
- 审计与维护：登录、节点、Ping、网站监控、通知、主题、备份恢复等操作写入审计日志；后台提供健康检查、容量估算、手动清理。
- 备份恢复：支持加密导出和恢复，备份内容可包含设置、节点、Ping 任务和通知规则。
- 版本信息：前端从 Worker `/api/version` 获取 GitHub 最新 Release 版本；未发布时显示开发版本。

## 配额策略

- 有实时观看者时，Agent 按 3 秒采样并上报，主要服务实时页面。
- 无实时观看者时，Agent 按 120 秒批量上报，减少 Worker 请求和 Supabase 写入。
- Ping 默认 120 秒执行，并入最近一次指标 report，不单独频繁请求。
- Worker 使用 Durable Objects 保存实时快照、观看者状态、Agent 策略和限流状态。
- 公开元数据、历史数据和实时快照有短缓存，降低重复读取。
- 历史记录、Ping 记录、网站检测记录和审计日志会按设置定期清理。

## 技术架构

- `frontend/`: React、Vite、Radix UI、Tailwind，构建后由 Workers Static Assets 托管。
- `worker/`: Hono API、Cloudflare Worker、Durable Objects、Cron Triggers、Supabase HTTP Data API/RPC。
- `agent/`: Go Agent，支持 WebSocket 和 HTTP 上报，支持 Linux/Windows 安装脚本。
- `supabase/migrations/`: 数据表、索引、RLS、RPC、授权和安全函数。
- `.github/workflows/`: 测试和 Agent Release，不负责部署到 Cloudflare。

## 安全设计

- `SUPABASE_SERVICE_ROLE_KEY` 只放在 Worker Secret，前端不会拿到 Supabase key。
- Worker 不使用数据库直连，只访问 Supabase HTTP Data API/RPC。
- 后台使用 HttpOnly Cookie 保存会话，并对写请求校验 CSRF Token。
- 登录失败有限流和审计，限流状态优先走 Durable Object。
- Agent 使用独立 Token，上报接口会做 Token 校验、来源记录、过期策略和速率限制。
- 网站监控和 Ping 会拦截内网、回环、链路本地、元数据地址等危险目标，减少 SSRF 风险。
- Worker 默认返回安全响应头，包括 CSP、HSTS、X-Frame-Options、nosniff 等。
- Supabase 函数显式 revoke/grant；必要的 `security definer` 函数固定 `search_path`。

## 一键部署到 Cloudflare

推荐使用 README 顶部的 **Deploy to Cloudflare** 按钮部署。Cloudflare 会读取仓库配置，安装依赖，构建前端和 Worker，然后发布到你的 Cloudflare 账号。

### 1. 准备账号

1. 准备一个 Cloudflare 账号，并确认可以使用 Workers。
2. 准备一个 Supabase 项目。
3. 准备一个 GitHub 或 GitLab 账号，用于让 Cloudflare 克隆本仓库到你的账号下。

### 2. 准备 Supabase

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard/projects)。
2. 创建或选择一个项目。
3. 进入 **Project Settings** -> **API**。
4. 复制 **Project URL**，部署时填入 `SUPABASE_URL`。
5. 复制 **Secret key** 或 **service_role key**，部署时填入 `SUPABASE_SERVICE_ROLE_KEY`。
6. 打开 [Supabase Access Tokens](https://supabase.com/dashboard/account/tokens)，创建 Personal Access Token。它只用于部署时自动初始化数据库，可填入 `SUPABASE_ACCESS_TOKEN`。

### 3. 点击部署按钮

1. 点击 README 顶部的 **Deploy to Cloudflare**。
2. 登录 Cloudflare。
3. 选择 Cloudflare 账号。
4. 授权 Cloudflare 克隆仓库。
5. 设置仓库名和 Worker 名称。
6. 填写变量和 Secrets。
7. 点击部署，等待构建完成。

### 4. 填写变量和 Secrets

必须填写：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | Supabase Project URL，例如 `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Supabase secret/service role key |
| `JWT_SECRET` | Secret | 后台会话签名密钥，建议使用 32 位以上随机字符串 |
| `ADMIN_USERNAME` | Secret | 初始后台用户名 |
| `ADMIN_PASSWORD` | Secret | 初始后台密码 |

可选填写：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Secret | 用于部署时自动初始化 Supabase 数据库 |

如果 Cloudflare 部署页面没有显示 `SUPABASE_ACCESS_TOKEN`，可以先完成 Worker 部署，再按下面的“数据库初始化兜底”执行一次。

### 5. 数据库自动初始化

项目的 `npm run deploy` 会先构建并部署 Worker；如果环境里存在 `SUPABASE_ACCESS_TOKEN` 和 `SUPABASE_URL`，随后会自动执行 Supabase 初始化脚本。

数据库初始化兜底：

```bash
npm ci
npx supabase link --project-ref 你的项目ref --yes --workdir .
npx supabase db push --linked --workdir . --yes
```

`项目ref` 是 Supabase URL 中的子域名，例如 `https://abcd1234.supabase.co` 的项目 ref 是 `abcd1234`。

## 部署后使用

1. 打开 Worker 地址，例如 `https://你的项目名.你的账号.workers.dev`。
2. 进入 `/admin/login`。
3. 使用部署时设置的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。
4. 进入后台“服务器”，添加节点。
5. 打开节点的安装命令窗口，选择 Linux 或 Windows。
6. 复制命令到 VPS 执行，等待 Agent 上线。
7. 需要监控网站时，进入后台“网站”，添加 HTTP/HTTPS 或 TCP 检测目标。
8. 需要通知时，进入后台“通知管理”，配置 Telegram 或 SMTP Email，再启用离线、到期或负载规则。

Linux Agent 使用 `install-linux.sh`，Windows Agent 使用 `install-windows.ps1`。发布新的 Agent 二进制时，进入 GitHub 仓库 **Actions** -> **Agent Release**，手动输入版本号，例如 `v2.0.1`。

## 本地开发

安装依赖：

```bash
npm ci
```

启动前端：

```bash
npm run dev:frontend
```

启动 Worker：

```bash
npm run dev:worker
```

本地部署到 Cloudflare：

```bash
npx wrangler login
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

Windows PowerShell 自动初始化数据库：

```powershell
$env:SUPABASE_URL = "https://你的项目ref.supabase.co"
$env:SUPABASE_ACCESS_TOKEN = "你的token"
npm run deploy
```

## 常用命令

完整检查：

```bash
npm run verify
```

Cloudflare 部署配置 dry run：

```bash
npm run verify:cloudflare
```

Agent 测试：

```bash
cd agent
go test ./...
```

清理本地生成物：

```bash
git clean -fdX frontend/dist worker/.tmp worker/.wrangler agent/.tmp release
```

不要清理 `supabase/migrations/`、`package-lock.json`、`frontend/public/` 或 `worker/worker-configuration.d.ts`。

## 官方文档

- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase Data API Security](https://supabase.com/docs/guides/api/securing-your-api)
