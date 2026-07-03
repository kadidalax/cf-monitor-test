# CF VPS Monitor

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
- CF免费配额在默认配置下可足够监控50台vps节点。


## 技术架构

- `frontend/`: React、Vite、Radix UI、Tailwind，构建后由 Workers Static Assets 托管。
- `worker/`: Hono API、Cloudflare Worker、Durable Objects、Cron Triggers、Supabase HTTP Data API/RPC。
- `agent/`: Go Agent，支持 WebSocket 和 HTTP 上报，支持 Linux/Windows 安装脚本。
- `supabase/migrations/`: 数据表、索引、RLS、RPC、授权和安全函数。
- `.github/workflows/`: Agent Release，不负责部署到 Cloudflare。

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

推荐使用下面第 3 步的 **Deploy to Cloudflare** 按钮部署。Cloudflare 会读取仓库配置，安装依赖，构建前端和 Worker，然后发布到你的 Cloudflare 账号。

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

### 3. 点击部署按钮

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kadidalax/cf-monitor-test/tree/dev)

1. 点击上方的 **Deploy to Cloudflare**。
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

可选：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `DEMO_RESET_ENABLED` | Variable | 公开演示站使用。设为 `true` 后，Worker 会每 30 分钟恢复一次已保存的演示快照。默认关闭。 |

如果你不是点击上面的 **Deploy to Cloudflare** 按钮，而是在 Cloudflare Worker 页面里选择 **Dashboard 连接 GitHub 仓库部署**，Cloudflare 可能不会在选择仓库时自动弹出这些运行时变量输入框。请在第一次部署前或部署失败后，进入该 Worker 的 **Settings -> Variables & Secrets** 手动添加：

- Variable: `SUPABASE_URL`
- Secret: `SUPABASE_SERVICE_ROLE_KEY`
- Secret: `JWT_SECRET`

注意不要把 Secret 填到 Build variables。Cloudflare 文档说明 Build variables 只在构建命令中可用，不会作为 Worker 运行时变量传给项目。

后台账号不再作为 Cloudflare 变量配置。首次访问登录页创建管理员；忘记密码时，在登录页点击 **忘记密码**，输入 Supabase `service_role` key、新用户名和新密码即可重置唯一管理员账号。

### 5. 一键初始化数据库

1. 打开 [Supabase Access Tokens](https://supabase.com/dashboard/account/tokens)。
2. 创建一个 **1 hour** 有效期的 Personal Access Token。
3. 打开 `https://你的 Worker 域名/db-init`。
4. 粘贴 Access Token，点击 **一键初始化数据库**。
5. 页面提示完成后，删除或等待该 Access Token 过期即可。

Access Token 只会在本次初始化请求中使用，不会写入 Worker 变量、Supabase 数据库或浏览器存储。

### 公开演示站自动回档

如果你公开了演示站，可以在 Cloudflare Worker 变量里设置 `DEMO_RESET_ENABLED=true`。先把站点调整成希望展示的状态，然后打开 `/db-init`，粘贴 1 小时有效期的 Supabase Access Token，点击 **保存当前演示快照**。之后 Worker 定时任务会每 30 分钟恢复这份快照。管理员账号不再依赖 Worker 账号密码变量；忘记密码时，在登录页用 Supabase `service_role` key 重置。

这个 Access Token 只用于当次保存快照，不会保存到 Worker、Supabase 或浏览器。普通后台管理员无法覆盖演示快照。

## 部署后使用

1. 打开 Worker 地址，例如 `https://你的项目名.你的账号.workers.dev`。
2. 第一次部署后先进入 `/db-init` 初始化数据库。
3. 进入 `/admin/login`。
4. 首次访问登录页创建管理员，然后使用新账号密码登录。
5. 进入后台“服务器”，添加节点。
6. 打开节点的安装命令窗口，选择 Linux 或 Windows。
7. 复制命令到 VPS 执行，等待 Agent 上线。
8. 需要监控网站时，进入后台“网站”，添加 HTTP/HTTPS 或 TCP 检测目标。
9. 需要通知时，进入后台“通知管理”，配置 Telegram 或 SMTP Email，再启用离线、到期或负载规则。

同一台服务器可以安装多个 Agent 实例。每个节点的安装命令会带独立 `instance-id`，默认生成独立的服务名和安装目录，因此互不覆盖。只卸载某一个实例时，使用对应节点的卸载命令或手动指定 `instance-id`：

```bash
sudo ./install-linux.sh --uninstall -i 实例ID
```

```powershell
.\install-windows.ps1 -Uninstall -i '实例ID'
```

只有执行 `--uninstall-all --yes` 或 `-UninstallAll -Yes` 才会清理本机全部 CF VPS Monitor Agent 实例。


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
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
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
- [Supabase Management API](https://supabase.com/docs/reference/api/introduction)
- [Supabase Data API Security](https://supabase.com/docs/guides/api/securing-your-api)
