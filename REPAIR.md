# 上游更新与链式代理

当前核心：`cmliu/edgetunnel@a8ab11125ece9bc27983f609a6359be81b21050c`（2026-10-08）。
`upstream.json` 记录上游版本和 SHA-256；移除带 `EDGETUNNEL2` 标记的集成代码后，核心与该提交一致。

## 使用与部署

1. 保留现有 `UUID` 环境变量（标准 v4 UUID）和管理员密码 `ADMIN`，继续绑定原有 `KV`。兼容旧的 `sub` 绑定名；同时存在时优先使用 `KV`。
2. Worker 名称为 `edgetunnel2pro`。`keep_vars = true` 保留已有变量；部署前确认 `wrangler.toml` 的 KV ID 对应当前绑定，避免连到另一份配置。
   兼容日期沿用上游的 `2025-11-04`，`no_bundle = true` 直接发布已验证的单文件产物。
3. 登录 `/admin`，打开“🔗 链式代理设置”，添加落地节点并保存。支持 SOCKS5、HTTP（TLS 可选）、VLESS、VMess、Trojan、Shadowsocks。高级传输参数可通过 JSON 编辑。
4. 更新 Clash Meta / Mihomo 订阅，在主策略组选择“🔗 链式模式”，再选择落地节点及“🛫 链式中转”中的 CF 节点。启用后链式模式排在主策略组首位；客户端已有选择可能仍会保留。

连接顺序：**本机 → CF 节点 → 落地节点 → 目标网站**。中转组不添加 `DIRECT`。此扩展用于支持 `dialer-proxy` 的 Clash Meta / Mihomo；其他订阅类型继续使用上游行为。

配置继续保存在 `chain-proxy.json`，保留 `启用`、`当前选择`、`中转节点列表` 字段。历史字段名“中转节点列表”实际保存的是落地节点。初始化或重置主配置不会删除该文件。旧的多用户 KV 文件不会被读取或删除。

管理 API 为 `/admin/chain-proxy.json`：GET 读取、POST 保存；沿用上游管理员 Cookie 验证。配置错误返回 400；配置损坏导致无法生成链式订阅时返回 422，防止静默生成直接连接落地的配置。

默认使用上游最新管理页面，Worker 会注入链式代理界面。可选设置 `PAGES_URL=https://edgetunnel2-pages.pages.dev` 使用配套更新后的自有 Pages；不设置时无需先部署 Pages。仓库中的 `admin/index.html`、`admin_page.html` 也同步提供新版模板。

## 修改和验证

```sh
node scripts/build.mjs
node scripts/build-pages.mjs
npm run check
```

扩展源码在 `extensions/`，YAML 解析器在 `vendor/`（js-yaml，MIT，许可随附）。构建生成可直接粘贴到 Cloudflare 的单文件 `_worker.js`，运行时不加载外部 JS 包。YAML 会重新序列化，注释与原来的排版不会保留。

测试覆盖不同 YAML 排版、嵌套参数、特殊字符、名称冲突、认证、KV 保存和重置、历史绑定以及完整订阅请求。测试模拟 Cloudflare 的 MD5 和 KV；真正的代理连通性仍需部署后使用你的 CF 和落地节点验证。

## 以后同步上游

```sh
node scripts/update-upstream.mjs <上游完整40位commit SHA>
npm run check
git diff
```

更新脚本先构建并验证候选版本，验证通过后才替换本地文件；上游集成位置发生变化时会停止并要求人工核对。旧的每日直接同步工作流已改为验证工作流，避免未经链式代理测试就覆盖定制代码。

网络限制导致 Node 无法直连 GitHub 时，可先下载对应提交的 `_worker.js`，再追加 `--source <下载文件>` 使用同一套验证流程。
