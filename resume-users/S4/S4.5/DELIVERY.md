# GitHub 交付与隔离

起始核查确认 `origin/main` 为 `e137f553469e9ace26bbfcd8a0359e4e1160ad9d`，PR #45 的 S4.4 HEAD 为 `9427352bc2270280a52e12fa52b85cacfa8171f2`。当时 64 个已登记工作区中 38 个仍存在，10 个有未提交内容。已在独立的 `s4-5-projects-skills-awards-20261119` 工作区从该 S4.4 HEAD 开发，历史工作区和冻结材料保留。

| 步骤 | 独立提交 | 提交前验证 |
| --- | --- | --- |
| S4.5-A Projects 与 Methods | `6f1dd19d4de06101067f6aaa1ee10511bc261cd2` | 类型检查、构建、21 项定向测试 |
| S4.5-B Skills | `c014984a3f74984829464bc56a59c6925a03396a` | 类型检查、构建、23 项定向测试 |
| S4.5-C Awards 与整体验收 | 包含本交付记录的提交 | 详见 [测试和截图](TESTING.md) |

分支为 `codex/s4-5-projects-skills-awards-20261119`，依赖 PR 以 `codex/s4-4-education-experience-20261119`（PR #45）为目标。该差异从 S4.4 HEAD 开始。最新 HEAD 的 Required CI 和官方 Code Review 以 GitHub 检查记录为准。依赖分支没有 Required 工作流运行时，记录 NOT RUN。官方 Codex Review 未完成时，记录 NOT COMPLETED。正式合并须另行批准。
