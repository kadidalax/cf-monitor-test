# 更新日志

以发布批次为单位记录，标注对应显示版本号。后台「关于 → 版本更新」比对的是
[kadidalax/cf-vps-monitor](https://github.com/kadidalax/cf-vps-monitor) `main` 分支的最新提交编码。

> 🔴 本批改动了数据库迁移，更新后须到 `/db-init` 重新应用，否则新功能静默失效；重跑不会清空已有数据与节点 Token。　🟢 无需初始化。

<details open>
<summary><b>v2.0.2 · 2026-08-14 · 🟢</b></summary>
<ul>
<li><b>修复</b> 在线节点被误报离线告警。判定不再依赖被写入节流过滤的历史记录，改用节点的实时上报时间，并要求连续多轮判定离线才发送；拿不到可信信号时整轮跳过而非误判。修复前 3.5 小时内出现 5 波误报，修复后连续 16 小时零误报。</li>
<li><b>修复</b> 网速偶发出现数百 MB/s 的荒谬值。改为按网卡分别计算增量，隧道类网卡（WireGuard、tailscale 等）中途启用时不再把其历史累计流量算进单个采样周期。<b>需重新安装或升级 Agent 后生效。</b></li>
<li><b>修复</b> 通知测试必须先保存才能生效，现在直接以表单中填写的内容测试，测试过程不写入配置。Telegram、Webhook、邮件三个渠道均适用。</li>
<li><b>修复</b> Telegram Bot Token、Chat ID 等敏感配置以明文下发到浏览器，开发者工具中可见；现在只下发掩码预览，输入框留空即保持原值不变。</li>
<li><b>修复</b> 后台节点卡片首行的国旗与「在线」标记未左对齐。</li>
<li><b>修复</b> 后台节点卡片的地区文字被右侧操作按钮挤窄而提前截断。</li>
<li><b>修复</b> 前台节点卡片的速率与流量数值放不下被省略，例如 <code>3.59 MB/s</code>。</li>
<li><b>变更</b> 默认离线宽限期由 180 秒调整为 360 秒，仅影响新建或未配置的节点，已配置节点的数值保持不变。</li>
<li><b>变更</b> 批量编辑通知时，对话框预填选中节点的当前值；数值不一致时填入出现最多的值并给出提示。</li>
<li><b>变更</b> 新增节点的流量统计口径默认为「总计」，已有节点不受影响。</li>
<li><b>变更</b> 历史写入间隔默认由 120 秒调整为 30 秒，记录容量水位由 45 万行提高到 70 万行；两者均只影响新部署，已有站点沿用原有设置。上报间隔仍为 120 秒时，实际写入量不变。</li>
<li><b>新增</b> 通用设置新增「离线确认轮数」，默认 3 轮，可设 1~10。</li>
</ul>
</details>

<details>
<summary><b>v2.0.2 · 2026-08-10 · 🟢</b></summary>
<ul>
<li><b>变更</b> 内置 Next 主题替换为 Aurora 极光玻璃主题：极光渐变背景配半透明玻璃卡片，浅深色独立配色，移动端降级为不透明面板。已选 Next 的用户与站点自动迁移。</li>
<li><b>修复</b> 毛玻璃效果在正式部署中完全失效，所有 Chromium 内核浏览器均看不到；该问题自导航栏引入毛玻璃起一直存在。</li>
<li><b>修复</b> 主题页面背景未渲染，包括 404 页。</li>
<li><b>破坏</b> 自定义主题包中的 <code>.node-card-next-layout</code> 需改为 <code>.node-card-tile-layout</code>；曾为 Next 配置的自定义 CSS 不再生效。</li>
</ul>
</details>

<details>
<summary><b>v2.0.1 · 2026-08-04 · 🔴</b></summary>
<ul>
<li><b>新增</b> 网站监控支持「对游客隐藏地址」：游客只见名称与状态，管理员不受影响。</li>
<li><b>修复</b> 已隐藏的网站地址仍经 WebSocket 推送给游客，开发者工具中可见。</li>
<li><b>修复</b> 实时通道断开后，标签页切至后台仍持续重连与轮询空转，配额消耗大幅降低。</li>
<li><b>修复</b> 跨标签页事件的重复投递与重复取数。</li>
<li><b>修复</b> 部署脚本在更新部署时未复用线上已有的 <code>SUPABASE_URL</code>。</li>
</ul>
</details>

<details>
<summary><b>v2.0.1 · 2026-07-12 · 🔴</b></summary>
<ul>
<li><b>新增</b> 节点恢复上线通知；离线告警改为每次故障仅发送一次。</li>
<li><b>修复</b> 新增节点的 Agent Token 保存后读取为空。</li>
<li><b>修复</b> 中文地区名与云厂商区域标识（如 <code>ap-seoul-1</code>）的国旗解析。</li>
<li><b>修复</b> 朝鲜（KP）等明确国家代码被语义别名误判。</li>
</ul>
</details>

<details>
<summary><b>v2.0.1 · 2026-07-10 · 🔴</b></summary>
<ul>
<li><b>新增</b> 管理员双重身份验证（TOTP）：支持动态验证码与一次性恢复码，敏感操作统一要求二次验证。</li>
<li><b>新增</b> Webhook 通知：支持 Slack、Discord、飞书、钉钉、企业微信及自定义 GET/POST。</li>
<li><b>新增</b> Unix 通用安装脚本 <code>install.sh</code>，覆盖 Linux、Alpine/OpenRC、macOS、FreeBSD。</li>
</ul>
</details>

<details>
<summary><b>v2.0.0 · 2026-07-05 ~ 07-08 · 🔴</b></summary>
<ul>
<li><b>新增</b> 支持 Supabase Secret key。</li>
<li><b>新增</b> 可配置站点 Logo。</li>
<li><b>新增</b> 节点标签显示于卡片标题。</li>
<li><b>新增</b> 后台上游更新入口。</li>
<li><b>修复</b> 隐藏节点的可见性与排序，以及管理员会话恢复后的隐藏状态。</li>
<li><b>修复</b> 隐藏节点的 Ping 历史。</li>
<li><b>修复</b> 节点卡片的 CPU 型号显示。</li>
<li><b>修复</b> Agent 上报数据未正确解包。</li>
<li><b>修复</b> 数据库初始化与清理节奏。</li>
<li><b>修复</b> Cloudflare 部署按钮的密钥上传。</li>
<li><b>移除</b> 重置功能。</li>
</ul>
</details>

<details>
<summary><b>v2.0.0 · 2026-07-04</b></summary>
<p>首个公开版本。</p>
<ul>
<li><b>修复</b> Agent 重启后流量总计归零。</li>
<li><b>修复</b> 实时更新后公开页节点排序错乱。</li>
</ul>
</details>
