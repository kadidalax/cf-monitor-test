# CF VPS Monitor

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kadidalax/cf-monitor-test)

CF VPS Monitor 是一个基于 Cloudflare Workers 和 Supabase 的轻量 VPS 探针系统。前端沿用原项目的页面结构和布局，Worker 负责公开页、后台、Agent 上报、实时连接和安全校验，Supabase 只通过 HTTP Data API/RPC 被 Worker 访问。

## 功能特点

- 前台节点卡片、列表模式、实时页、后台管理、Ping 任务、通知和站点监控。
- Go Agent 自动采集 CPU、内存、磁盘、网络、系统信息和 Ping 结果。
- 有实时观看者时 3 秒上报并显示；无人观看时 120 秒批量上报；Ping 默认 120 秒并入 report。
- Worker 使用 Durable Objects 保存实时状态，减少数据库写入。
- Supabase service role key 只放在 Worker Secret 中，浏览器不会拿到数据库密钥。

## 项目结构

- `frontend/`: React 前端。
- `worker/`: Cloudflare Worker API、Durable Objects、Supabase RPC 访问层。
- `agent/`: Go Agent 和安装脚本。
- `supabase/migrations/`: 数据表、策略、RPC 和安全授权。
- `.github/workflows/`: CI 和 Agent Release。

## 一键部署到 Cloudflare

Cloudflare 官方 Deploy Button 会克隆公开 GitHub/GitLab 仓库，读取 Wrangler 配置，自动构建并部署 Worker 和静态资源。

### 1. 准备 Supabase

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard/projects)。
2. 创建项目。
3. 进入 **Project Settings** -> **API**。
4. 复制 **Project URL**，部署时填到 `SUPABASE_URL`。
5. 复制 **Secret key** 或 **service_role key**，部署时填到 `SUPABASE_SERVICE_ROLE_KEY`。
6. 打开 [Supabase Access Tokens](https://supabase.com/dashboard/account/tokens)，创建 Personal Access Token。这个值只用于自动推送 migration，部署时可填到 `SUPABASE_ACCESS_TOKEN`。

### 2. 点击部署按钮

点击 README 顶部的 **Deploy to Cloudflare**。

Cloudflare 页面会让你：

1. 登录 Cloudflare。
2. 选择账号。
3. 授权克隆仓库到你的 GitHub/GitLab。
4. 设置仓库名和 Worker 名称。
5. 填写变量和 secrets。
6. 点击部署。

### 3. 填写变量

必须填写：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | Supabase Project URL，例如 `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Supabase secret/service role key |
| `JWT_SECRET` | Secret | 后台登录签名密钥，建议 32 位以上随机字符串 |
| `ADMIN_USERNAME` | Secret | 初始后台用户名 |
| `ADMIN_PASSWORD` | Secret | 初始后台密码 |

可选填写：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Secret | 用于部署时自动执行 `supabase db push --linked` |

如果部署页面没有显示 `SUPABASE_ACCESS_TOKEN`，可以先完成 Worker 部署，再按“数据库迁移兜底”执行一次迁移。

### 4. 数据库自动迁移

本项目的 `npm run deploy` 会先部署 Worker，再在检测到 `SUPABASE_ACCESS_TOKEN` 时自动执行 Supabase migration。Cloudflare Deploy Button 会自动读取项目的 build/deploy scripts；如果你在部署页面提供了 `SUPABASE_ACCESS_TOKEN` 和 `SUPABASE_URL`，数据库会尽量自动完成初始化。

数据库迁移兜底：

```bash
npm ci
npx supabase link --project-ref 你的项目ref --yes --workdir .
npx supabase db push --linked --workdir . --yes
```

## 部署后初始化

1. 打开 Worker 地址，例如 `https://你的项目名.你的账号.workers.dev`。
2. 进入 `/admin/login`。
3. 使用部署时设置的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。
4. 在后台添加节点，复制 Agent 安装命令。
5. 到 VPS 上执行安装命令，等待节点上线。

Linux Agent 使用 `install-linux.sh`，Windows 使用 `install-windows.ps1`。发布新 Agent 时，进入 GitHub 仓库的 **Actions** -> **Agent Release**，手动输入版本号，例如 `v2.0.1`。

## 本地部署

需要本地调试时使用：

```bash
npm ci
npx wrangler login
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

Windows PowerShell 自动迁移：

```powershell
$env:SUPABASE_URL = "https://你的项目ref.supabase.co"
$env:SUPABASE_ACCESS_TOKEN = "你的token"
npm run deploy
```

## 日常维护

常用检查：

```bash
npm run verify
npm run verify:cloudflare
cd agent && go test ./...
```

清理本地生成物：

```bash
git clean -fdX frontend/dist worker/.tmp worker/.wrangler agent/.tmp release
```

不要清理 `supabase/migrations/`、`package-lock.json`、`frontend/public/` 或 `worker/worker-configuration.d.ts`。

## 安全说明

- `SUPABASE_SERVICE_ROLE_KEY` 只能放在 Worker Secret。
- `SUPABASE_ACCESS_TOKEN` 只用于部署时迁移数据库，不需要给前端。
- 前端不需要 Supabase key。
- 数据库只走 Supabase HTTP Data API/RPC，不走数据库直连。
- Cloudflare 文档建议敏感信息使用 Secret；本项目的 `wrangler.toml` 只保留非敏感变量。
- Supabase migration 中的 RPC 会显式 revoke/grant，必要的 security definer 函数固定 `search_path`。

## 配额策略

- 实时页有人看：Agent 3 秒上报，主要用于实时显示。
- 无实时观看者：Agent 120 秒批量上报。
- Ping 默认 120 秒，并入最近一次 metrics report。
- 历史数据默认保留 120 秒粒度，减少 Worker 和 Supabase 调用。

## 官方文档

- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
