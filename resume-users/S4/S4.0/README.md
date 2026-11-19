# S4.0 — 普通用户 Dashboard 最小实施方案

项目为 `XiangsongFei/personal-website-template`。本页保留 2026-11-18 的 S4.0 规划。公开替代版从 `main`（`e137f553469e9ace26bbfcd8a0359e4e1160ad9d`）单独交付，范围仍为 S4.0 文档。

## 结论

建议 S4.1 在现有 `example-cv-users/` 应用内新增受 S2 服务端会话保护的 Dashboard 外壳和导航，先展示准确的空态、加载、错误及能力未开放状态。新界面借鉴旧 CMS 的视觉与交互，通过 Users 专用 ViewModel 和适配层逐步接入。原 `App`、Repository、管理员认证和 Supabase 客户端不纳入复用范围。

真实保存、文件、发布和 AI 各有独立门槛。S3.3/S3.4 有历史隔离验收证据。S3.5 仍为 `HOLD`，S3.6 仍为 `REAL_NOT_RUN`。PR #40 原依赖审计失败与同一 HEAD 的成功复跑见[依赖矩阵](04-dependencies-and-s3-handoff.md)。

## 目录与交付索引

应用源码仍在 `example-cv-users/`。阶段材料位于同一 Git 仓库的 `resume-users/S4/S4.0/`。

| 文件 | 内容 |
| --- | --- |
| [01-repository-and-directory.md](01-repository-and-directory.md) | 历史工作区检查摘要、目录及 Git 归属 |
| [02-cms-review-and-reuse.md](02-cms-review-and-reuse.md) | 七类旧 CMS 界面审查、复用清单与权限边界 |
| [03-minimum-implementation-plan.md](03-minimum-implementation-plan.md) | Dashboard 结构、S4.1–S4.12 最小范围及 S4.2 站点读取合同补注 |
| [04-dependencies-and-s3-handoff.md](04-dependencies-and-s3-handoff.md) | S3 状态、真实能力依赖和验收条件 |
| [05-verification-and-review.md](05-verification-and-review.md) | 交付者检查、独立审查证据和 CI 说明 |

本次交付为上述六份 Markdown。S2 账户功能、旧 CMS、Public、S3 历史材料及生产配置均无改动。生产数据库、Storage、Cloudflare、DNS 和部署不在本次交付范围。

## 原 S4.0 规划的决策项

1. S4.1 优先交付 Dashboard 外壳及明确的能力禁用状态。
2. S4.1–S4.12 的编号与范围为当时提出的最小拆分，正式实施时按批准的范围核对。
3. S3 的真实隔离验收需要独立恢复，真实业务功能继续依赖各自的验收门槛。

2026-11-19 补注。S4.3 至 S4.6 已实现完整本地预览。S4.8 条目保留原路线图，后续需核实受保护的已保存草稿和公开快照来源。S4.6 的线上像素一致性仍为 `PARTIAL`。

替代版的提交、Required CI 及独立审查以对应 PR 和最终 HEAD 的实际证据为准。
