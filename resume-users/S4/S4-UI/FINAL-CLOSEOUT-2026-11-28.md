# S4-UI 最终结项 · 2026-11-28

本记录补充 [FINAL-DELIVERY.md](FINAL-DELIVERY.md)。Cloudflare 只读回执确认 `example-cv-users` 的 Deployment `9af7cb4e-3e42-4a7a-bbf3-c6e2f4fafadd` 将 100% 流量交给 Version 15。发布注解将源码和工件绑定到下列值，GitHub `origin/main` 与源码 SHA 一致。

| 版本 | 版本 ID | 源码和范围 |
| --- | --- | --- |
| 12 | `ca001c03-a7fe-4db0-885c-8393dce671c4` | `c3c728a`，[#75](https://github.com/XiangsongFei/personal-website-template/pull/75) 完成编辑器与工作台 |
| 13 | `3adb2fdd-95a2-401b-af4e-a2104a689981` | `f5b3387`，[#76](https://github.com/XiangsongFei/personal-website-template/pull/76) 填写指导及 Safari 平滑导航 |
| 14 | `48cb89c8-2c12-4c0c-bba0-8de81c10bdc9` | `c041c2d`，[#77](https://github.com/XiangsongFei/personal-website-template/pull/77) 预览链接。Version 15 的回退候选 |
| 15 | `08768067-69e7-4e7c-8813-12cf7b8ccc0e` | `37aebfd2f7e11820309cd16ff1ea6fd06ccd23bf`，包含 [#78](https://github.com/XiangsongFei/personal-website-template/pull/78) 的导航、指导和标题调整，以及 [#79](https://github.com/XiangsongFei/personal-website-template/pull/79) 的 Safari 绘制及标题同步 |

Version 15 工件 SHA-256 为 `dee693f0f5232e4116759f1ca61030458374abafe6bc0d9681582aacedb1cfe2`，来源为 Cloudflare 版本注解。最终 PR 的 Users 构建、类型检查、本地 Worker 测试、Required gate 和最新提交的官方 Codex Review 均已完成。浏览器范围沿用原交付和各热修 PR 的记录。此次复核范围为 GitHub、Cloudflare 元数据和匿名站点读取闭态。生产未进行真实用户履历操作、真实草稿写入或新的发布快照验收。

Version 14 的源 SHA 为 `c041c2dfb60192bc000048a9566f23b00d8ddb1b`，工件 SHA-256 为 `421fff193e1c81e54ee0a8486538df8a0c6f7fabce0c3f7fc62bdcf0ef171922`。回退仍需独立审批。本次文档交付只读核对既有版本。
