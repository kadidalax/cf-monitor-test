# 更新日志

以发布批次为单位记录，标注对应显示版本号。后台「关于 → 版本更新」比对的是
[kadidalax/cf-vps-monitor](https://github.com/kadidalax/cf-vps-monitor) `main` 分支的最新提交编码。

> 🔴 本批改动了数据库迁移，更新后须到 `/db-init` 重新应用，否则新功能静默失效；重跑不会清空已有数据与节点 Token。　🟢 无需初始化。

<details open>
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
