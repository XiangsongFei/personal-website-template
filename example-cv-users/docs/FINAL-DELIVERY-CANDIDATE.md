# S2 最终安全修复交付候选（2026-11-06）

本文件汇总最新交付状态；各轮历史报告保留当时结论。第三轮报告中的 HTTPS NOT TESTED 已由随后单独批准的双浏览器合成验收补齐，不回写原报告。业务代码、已认可布局、认证与 SQLite DO 业务逻辑未因交付整理而改变。

## 分支与版本

- 基础 main：`a0a82f30b3e5129f7a68d9e6dfe2693fb7eaa8a2`。
- 新分支：`codex/s2-users-remediation-20261105`。
- 原 S2 commit：`17f99e3d9e1a42166257cc18aceb31d302d27dee`；在新 main 上独立 cherry-pick 为 `bea1bb75d139416ea604e354fa2a81d18fd8b70f`。
- 第一轮修复：`5136030888dda7d095efa84e779e5c513a1f3107`；保留历史，本次追加第二、三轮修复，不重写原分支或 PR #31。
- 业务：`65c3afe790ece8f5616e873fd8870803d4bef0e89cdeeec528c5439a054e37fd`。
- 工具：`ca13d8df89daa6a8da4bcac0b10396c6384a2a2885763ae9884d6799d3630b74`。
- 锁：`c8cc8a0b96c76e8eec73b7c0eb17621b1580dc8488d93f09523f859073779057`。
- Node：24.22.1，内置 undici 7.30.1；darwin-arm64 二进制 SHA-256 `6f32069480ec14d52b6d7b1f3c7124cfbbc46203abf5ddf5c65b127435f3f329`。此摘要是本机 TLS 身份 pin，不能要求 Linux CI 的不同平台二进制具有相同摘要。

## 本次内容

完整 S2 独立用户应用位于 `example-cv-users/`：注册/邮箱验证、登录/会话/退出、普通改密、恢复 OTP 与一次性授权；Supabase 项目与旧 CMS 独立。未修改旧 CMS、公站源码或依赖。

三轮修复包括 React/React DOM/RSC 19.2.9，Vite8.1.6、Vinext1.0.0、RSC plugin0.5.34、Cloudflare Vite plugin1.66.0、Wrangler4.154.0、Miniflare5.20261023.1-beta，及 Satori 子树 fflate0.7.5 的精确 override。叶证书撤销依赖保存的公开快照，不要求私钥仍存在或证书未过期；UNKNOWN 与身份/用途/当前用户限制保留。

Users CI 使用 Node24.22.1、锁文件安装、构建、类型检查、完整本地测试和 npm audit。路径分类与 Required Gate 支持 Users；workflow/gate 变化保守运行相关项目检查。Admin 历史审计不被隐藏，只有其依赖文件变化才要求 Admin dependency audit，本 PR 不修改该依赖文件。

## 验证范围

| 项目 | 当前证据 |
|---|---|
| 完整/生产 npm audit | 第三轮均0项；交付前再次查询均0项 |
| 本地构建/类型检查 | 第三轮 PASS；源文件与产物 manifest 在交付前逐项吻合 |
| 完整 Node/workerd/SQLite DO 测试 | 第三轮85/85 PASS，0 fail/skip；持久化、原子授权、过期、UNKNOWN等在此套件内 |
| CI分类与Required Gate本地测试 | 28/28 PASS |
| 实际 Chrome/Safari 系统可信 HTTPS | 新候选合成登录、账户刷新/导航、主动续期、Cookie写回/后续身份、POST退出/访问拒绝均PASS |
| 合成上游 | 21次：登录2、续期2、getUser14、JWKS1、退出2；真实认证/发信/改密0 |
| 信任及服务收尾 | 显式设置与公共项恢复；证书仍有效时默认系统SSL恢复-67843；本批服务/端口/临时状态清理完成 |
| 原五项真实认证PASS | 仅绑定历史业务676c5c7c…；历史UNKNOWN与中止事件保留 |
| 新候选真实Supabase集成 | NOT TESTED，不继承旧构建真实PASS |
| 托管Worker/DO、正式域名 | 未部署、未验收 |
| 真实等待一小时自动到期续期 | NOT TESTED；主动续期不替代此项 |
| GitHub Actions | 由本次Draft PR实际运行另行记录；本地28项不能代替云端CI |

[第三轮报告](SECURITY-REMEDIATION-ROUND3.md)、[脱敏HTTPS摘要](evidence/https-session-20261106.json)及[精确业务/工具清单](evidence/security-round3-20261105/build-manifest.json)共同界定验证范围。原始运行记录继续本地保留，不随 GitHub 上传。

公开交付副本仅将第三轮文档及 verification.json 的个人 Node 绝对路径改为 `$HOME`；原文及完整哈希保存在本机忽略区。没有更改历史结果、业务或工具摘要。

## 提交与发布边界

[当前候选逐文件清单](evidence/remediation-files.json)覆盖本次相对基础main的交付内容；旧github-files.json仍是历史86文件清单，不冒充当前数量。清单文件本身不自引用，单独按Git blob审查。

排除 .runtime、原始真实记录、TLS材料、私钥/凭据、Cookie/Token/用户密码与验证码、会话数据库、node_modules、dist及其他可再生成缓存。公开合成fixture中的固定密码/OTP仅用于example.invalid离线测试，不是真实账户凭据。

新 PR 始终 Draft，不关闭或修改 PR #31，不更新 main、不 merge、不部署。新候选最小真实集成回归需另行批准：双浏览器登录/主动续期/退出，以及单浏览器恢复关键写链路；普通改密是否补一次单列批准，不自动重新注册。正式发布还须核对 CMS 独立入口、域名/Access/回调、托管DO绑定及邮件模板切换与回退。
