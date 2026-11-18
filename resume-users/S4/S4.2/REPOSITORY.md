# S4.2 Git 与工作区核查

日期：2026-11-19（Asia/Shanghai）。仓库远端 `https://github.com/XiangsongFei/personal-website-template.git`。

- 新 worktree：`/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s4-2-my-website-20261119`。
- 分支：`codex/s4-2-my-website-20261119`；起点为核实后的 PR #42 远端/本地共同 HEAD `e95e9616c0dddb25f69a46a82b123ad4edc43f48`。
- `origin/main` 本地与 GitHub API 均为 `e137f553469e9ace26bbfcd8a0359e4e1160ad9d`。
- S4.1 worktree 干净；#41/#42 OPEN 未合并；未覆盖或切换它们的分支。
- `example-cv-users/` 是现有正式构建目录；`resume-users/S4/S4.2/` 是本 worktree 新增记录目录，均属于同一 Git 仓库。没有改名、移动或复制历史项目。
- 新 worktree 使用既有冻结依赖；node_modules 是忽略目录，未安装/升级依赖。Node24.22.1 来自现有本地工具目录。
- 创建前清点全部注册 worktree（包括不存在/prunable 的历史项）及所有本地/远端 refs；原始快照仅保留在本地忽略目录，不删除、prune、clean、stash 或 reset 历史项。

## 创建前全部 worktree

共 61 项，其中存在 35 项；有未提交内容的历史工作区 9 项。下表为创建 S4.2 前快照；条目数包含该目录原有的未跟踪项，不代表本任务改动。

| 绝对路径 | 分支 / HEAD | 实际目录 | 未提交条目 |
| --- | --- | --- | --- |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/resume-site-public` | `codex/s2-users-delivery-20261105` / `17f99e3d9e1a` | 存在 | 128 |
| `/private/tmp/admin-audit-target-view-20261014` | `codex/admin-audit-target-view-20261014` / `ac65b7b71be9` | 不存在，保留登记 | 0 |
| `/private/tmp/admin-cleanup-audit-e06f24c` | `detached` / `e06f24c499cf` | 不存在，保留登记 | 0 |
| `/private/tmp/admin-introduction-rpc-preflight-5e3adc9` | `detached` / `5e3adc93dceb` | 不存在，保留登记 | 0 |
| `/private/tmp/admin-production-input-reference-90c59c` | `detached` / `90c59c03cb6e` | 不存在，保留登记 | 0 |
| `/private/tmp/admin-release-controls` | `codex/admin-release-controls` / `aa620208a2bf` | 不存在，保留登记 | 0 |
| `/private/tmp/admin-title-audit` | `codex/admin-title-audit` / `8080a2071b3b` | 不存在，保留登记 | 0 |
| `/private/tmp/awards-skills-min-fix` | `codex/awards-skills-integration-validation` / `8bf6b74d42b4` | 不存在，保留登记 | 0 |
| `/private/tmp/awards-skills-test-activation` | `codex/awards-skills-test-activation` / `44ce4ada029e` | 不存在，保留登记 | 0 |
| `/private/tmp/cms-pending-save-safety` | `codex/cms-pending-save-safety` / `987dca565033` | 不存在，保留登记 | 0 |
| `/private/tmp/introduction-version-history` | `codex/introduction-version-history` / `40eee1c690b9` | 不存在，保留登记 | 0 |
| `/private/tmp/log10-admin-release.OVflif/worktree` | `codex/log10-admin-release-20261013` / `936e33d8ef6e` | 不存在，保留登记 | 0 |
| `/private/tmp/owner-rpc-activation-runtime-tests` | `codex/owner-rpc-activation-runtime-tests` / `c2e76ec70338` | 不存在，保留登记 | 0 |
| `/private/tmp/personal-website-public-audit-check-2-e06f24c` | `detached` / `e06f24c499cf` | 不存在，保留登记 | 0 |
| `/private/tmp/personal-website-public-audit-e06f24c` | `detached` / `e06f24c499cf` | 不存在，保留登记 | 0 |
| `/private/tmp/pr28-dbsetup-safe-reason-20261020` | `codex/pr28-dbsetup-safe-reason-20261020` / `402465da1428` | 不存在，保留登记 | 0 |
| `/private/tmp/pr28-docker-api-observe-20261019` | `codex/pr28-docker-api-observe-20261019` / `1003348f5d98` | 不存在，保留登记 | 0 |
| `/private/tmp/profile-image-history-retention-9e05fe1` | `codex/profile-image-history-retention` / `95a12483e678` | 不存在，保留登记 | 0 |
| `/private/tmp/profile-image-retention-prod-exec-6053e8a` | `detached` / `6053e8a49daa` | 不存在，保留登记 | 0 |
| `/private/tmp/public-ci-cleanup-batch-2b` | `codex/public-ci-coverage` / `35ad91747b15` | 不存在，保留登记 | 0 |
| `/private/tmp/public-icons-baseline` | `detached` / `edb5762124e8` | 不存在，保留登记 | 0 |
| `/private/tmp/remove-unused-public-starter-icons` | `codex/remove-unused-public-starter-icons` / `fa35264c7dde` | 不存在，保留登记 | 0 |
| `/private/tmp/retire-admin-qa-config` | `codex/retire-admin-qa-config` / `b10f775860da` | 不存在，保留登记 | 0 |
| `/private/tmp/retire-signing-probe` | `codex/retire-signing-probe` / `c31cf7aeffdd` | 不存在，保留登记 | 0 |
| `/private/tmp/section-titles-activity-history` | `codex/section-titles-activity-history` / `2adaa9c60b24` | 不存在，保留登记 | 0 |
| `/private/tmp/signing-probe-retirement-release-9e05fe1` | `detached` / `9e05fe121b82` | 不存在，保留登记 | 0 |
| `/private/tmp/test-profile-signing-probe-runbook` | `codex/test-profile-signing-probe-runbook` / `2271ee2a0edf` | 不存在，保留登记 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/admin-asset-compatibility/resume-site-public` | `detached` / `9f7c4e7cd870` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/archive-test-fixture-20261015` | `codex/archive-test-fixture-20261015` / `016d9088e7dc` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/batch4-local-sql-harness/resume-site-public` | `codex/admin-local-sql-harness` / `c5e23db6d6df` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/candidate-a-target-compat/resume-site-public` | `detached` / `4a462c9eb921` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/education-experience-activity-log/resume-site-public` | `codex/education-experience-activity-log` / `3bbc6f013f5f` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/files-restore-pr2/resume-site-public` | `codex/files-restore-capability-enforcement` / `56f07ea1acca` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/introduction-version-history/resume-site-public` | `codex/introduction-version-history-review-20261017` / `f321b546977d` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/owner-three-domain-rpc-review` | `feature/owner-three-domain-rpc` / `6099e5bf083e` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/p0-test-target-auth/resume-site-public` | `detached` / `4a462c9eb921` | 存在 | 9 |
| `/Users/xiangsongfei/.codex/worktrees/pr28-ghcr-alias-fix/resume-site-public` | `codex/pr28-ghcr-mirror-aliases` / `3a1e5f576749` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/pr28-ghcr-registry-cache/resume-site-public` | `codex/pr28-startup-typed-error` / `3b9d2f53a435` | 存在 | 1 |
| `/Users/xiangsongfei/.codex/worktrees/pr28-ghcr-sql-ci/resume-site-public` | `detached` / `3b4f47576b07` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/prod-auth-release-e53ea7aa` | `detached` / `e53ea7aa9071` | 存在 | 3 |
| `/Users/xiangsongfei/.codex/worktrees/prod-auth-remediation/resume-site-public` | `codex/prod-auth-remediation` / `aad4a720a929` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/profile-image-retention-production/resume-site-public` | `codex/profile-image-runbook-linked-cli` / `91ebd98d300c` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/public-worker-deploy-plan/resume-site-public` | `detached` / `e06f24c499cf` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/remove-unused-chatgpt-auth/resume-site-public` | `codex/remove-unused-chatgpt-auth` / `a7f1f6adf752` | 存在 | 1 |
| `/Users/xiangsongfei/.codex/worktrees/rsc-security-patch/resume-site-public` | `codex/patch-public-rsc-19-2-9` / `3b0e183b3e10` | 存在 | 0 |
| `/Users/xiangsongfei/.codex/worktrees/test-profile-signing-probe` | `codex/test-profile-signing-probe` / `cca3327898b0` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/cms-local-signout-20261106` | `codex/cms-local-signout-20261106` / `c990b72e37cf` | 存在 | 3 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/cms-local-signout-integration-20261106` | `codex/cms-local-signout-integration-20261106` / `f18ae7109dd1` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-doc-closeout-20261107` | `codex/s2-production-closeout-docs-20261107` / `3c3bab517e96` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-password-mapping-20261107` | `codex/s2-users-password-mapping-20261107` / `f8802e8b0a15` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-release-repro-20261107` | `detached` / `69d748c7770d` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-remediation-20261105` | `codex/s2-users-remediation-20261105` / `893cfa98feb1` | 存在 | 3 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-3-final-delivery-20261112-e449c25f` | `codex/s3-3-final-delivery-20261112` / `bb5358036277` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-3a-foundation-20261108-7dd22a81` | `codex/s3-3a-foundation-20261108-7dd22a81` / `323c4538eef1` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-3b-prep-20261109-e449c25f` | `codex/s3-3b-prep-20261109-e449c25f` / `e449c25faf26` | 存在 | 44 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-4-permissions-20261112` | `codex/s3-4-permissions-20261112` / `08df3019b02f` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-5-s3-6-assets-publish-20261113` | `codex/s3-5-s3-6-assets-publish-20261113` / `e137f553469e` | 存在 | 158 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-5-s3-6-assets-publish-20261113/example-cv-users/.runtime/s3-github-delivery-20261118T132450Z-387FCF29/01-s36-core` | `codex/s3-6-text-publication-core` / `5364bc75adb3` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-design-20261108-efae37f8` | `codex/s3-b1-design-20261108-efae37f8` / `f99069cb7bda` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s4-0-dashboard-audit-20261118` | `codex/s4-0-dashboard-audit-20261118` / `ef748340a01f` | 存在 | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s4-1-dashboard-foundation-20261118` | `codex/s4-1-dashboard-foundation-20261118` / `e95e9616c0dd` | 存在 | 0 |

## 依赖 PR

S4.2 的 PR base 选择 `codex/s4-1-dashboard-foundation-20261118`，明确依赖 #42；对比该基线只登记 S4.2 新增内容。不得把 #42 的既有 Dashboard/账户/S2 变更重新登记为 S4.2 实施。待 S4.1 正常合并后，按批准流程核实 ancestry 和合并方式，再调整 S4.2 基线；当前不自动 rebase、改 main、合并或部署。

CI 当前只对 main 目标 PR 触发，依赖 PR 的 Required CI 应标为未触发，不能沿用 #42 成功记录。新 Commit/分支/PR 的精确 SHA、创建结果及最新 CI/Review 以最终 GitHub 交付报告和 PR 正文为准，避免在 Commit 内写入虚构的自身 SHA 或未来结果。
