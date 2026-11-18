# S4.0 — 普通用户 Dashboard 最小实施方案

日期：2026-11-18（Asia/Shanghai）。项目：`XiangsongFei/personal-website-template`。
状态：**S4.0 文档交付；S4.1–S4.12 尚未实施。** 用户已批准 S4，本轮授权范围仅为 S4.0。

## 结论

建议 S4.1 在现有 `example-cv-users/` 应用内新增受 S2 服务端会话保护的 Dashboard 外壳和导航，先展示准确的空态、加载、错误及能力未开放状态。新界面复用旧 CMS 的视觉与交互思想，通过 Users 专用 ViewModel/适配层逐步接入；不导入旧 `App`、Repository、管理员认证或 Supabase 客户端。

真实保存、文件、发布和 AI 各有独立门槛。S3.3/S3.4 的历史隔离验收有效，但不能证明 S3.5/S3.6 已完成真实业务验收，更不能证明生产已启用。当前 PR #40 的依赖安全审计及 Required CI 仍失败，S4 不负责绕过或修复这一独立阻断。

## 目录事实

- 本轮独立 worktree：`/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s4-0-dashboard-audit-20261118`。
- 本材料绝对路径：上述路径加 `/resume-users/S4/S4.0/`。
- Git 根即该 worktree 根，origin 为 `https://github.com/XiangsongFei/personal-website-template.git`。
- 新增 `resume-users/` 仅作为用户指定的阶段材料父目录。此前该路径及 S4 目录不存在；应用源码仍为 Git 跟踪的 `example-cv-users/`。没有移动、复制或重命名应用，没有覆盖已有 S4 文件。
- 分支：`codex/s4-0-dashboard-audit-20261118`；基线：`e137f553469e9ace26bbfcd8a0359e4e1160ad9d`（本轮 fetch 后的 `origin/main`）。

## 交付索引

| 文件 | 内容 |
| --- | --- |
| [01-repository-and-directory.md](01-repository-and-directory.md) | 原工作区、全部 worktree、目录及 Git 归属 |
| [02-cms-review-and-reuse.md](02-cms-review-and-reuse.md) | 七类旧 CMS 界面审查、复用清单、禁止复用项 |
| [03-minimum-implementation-plan.md](03-minimum-implementation-plan.md) | Dashboard 结构、状态交互、S4.1–S4.12 最小范围 |
| [04-dependencies-and-s3-handoff.md](04-dependencies-and-s3-handoff.md) | 最新 S3 状态、真实能力依赖、解阻证据 |
| [05-verification-and-review.md](05-verification-and-review.md) | 文件检查、独立复核、保护边界、CI 解释 |

本轮仅提交上述六份 Markdown。保留 S2 注册、登录、邮箱验证、账户及密码管理、现役生产配置、旧 CMS/Public 及全部 S3 历史材料。未运行数据库 Migration、业务写入、生产 Supabase 连接、Storage 请求或 Cloudflare 部署；未修改 DNS、Secret、自动部署或工作流。仅 GitHub 读取、Git 文档交付及其正常 PR 检查属于本轮远端操作。

## 需要用户决定的后续事项

1. 是否以 S4.1 的“Dashboard 外壳及禁用能力状态”作为下一轮开发范围。
2. 本轮未找到既有 S4.1–S4.12 逐项正式清单；本交付提供建议编号映射。若有既定清单，应先对齐编号和范围，再实施，不能视为本轮替用户批准新业务范围。
3. S3 依赖审计修复和真实隔离验收何时单独恢复。它们不阻止纯界面设计，但会阻止真实业务功能验收。

Commit、Push、PR 和最终 CI 回执在完成后由本轮最终报告给出；以 GitHub 实际提交与检查为准，不在尚未 Push 的文档中预填成功。不得自动 Merge。
