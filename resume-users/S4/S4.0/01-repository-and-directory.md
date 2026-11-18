# 仓库、目录与全部 Worktree 检查

## 初始与交付工作区

原打开工作区绝对路径：`/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/resume-site-public`。
原分支 `codex/s2-users-delivery-20261105`，HEAD `17f99e3d9e1a42166257cc18aceb31d302d27dee`，跟踪同名 origin 分支。`git status --porcelain` 初始128条，包含已修改和未跟踪旧 CMS 文件；未暂存、提交、覆盖或清理这些修改。原 PR #31 的状态与本 S4.0 无关。

origin 指向目标仓库，默认分支 main。`git fetch origin` 后 main 为 `e137f553469e9ace26bbfcd8a0359e4e1160ad9d`。GitHub 仓库 public，当前账号具有 push 权限。新建干净 worktree/分支 `s4-0-dashboard-audit-20261118` / `codex/s4-0-dashboard-audit-20261118`，仅以 main 为父提交，不以未合并的 #40 为基线，也不包含原工作区的 CMS 修改。

Git common dir 沿用原仓库 `.git`；本轮只新增 worktree 登记和新分支，不 prune、remove、reset、clean、rebase 或 force push。检查未发现适用的 AGENTS.md。

## 目录核实

初始全部59个已登记 worktree中，33个路径存在、26个路径已不存在且标记 prunable；存在的工作区中9个有未提交状态。逐个只读检查存在性、HEAD/branch、git status 和 users/S4 路径。旧登记不清理。

存在的 Users 项目名称均为 `example-cv-users/`，未发现 `resume-users/` 或两种父目录下已有 S4 子目录。新交付 worktree 中 `example-cv-users/` 有282条已跟踪文件。`resume-users/` 初始不存在且无 Git 跟踪记录，随后仅创建用户指定的 `resume-users/S4/S4.0/` 文档层级。不存在嵌套仓库/应用迁移；文件将由相同 origin 跟踪。

## 初始全部 Worktree 清单

下列为新建 S4 worktree前的 `git worktree list --porcelain` 全量快照；changes 是 porcelain 行数（未跟踪目录可能折叠），不是修改文件总数。`detached` 表示分离 HEAD；不存在项无法读取工作区状态。

| 绝对路径 | HEAD | 分支/状态 | changes |
| --- | --- | --- | --- |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/resume-site-public` | `17f99e3d9e1a42166257cc18aceb31d302d27dee` | `codex/s2-users-delivery-20261105` | 128 |
| `/private/tmp/admin-audit-target-view-20261014` | `ac65b7b71be917417a3a1ab5633c7f5f770ca20c` | `codex/admin-audit-target-view-20261014; missing/prunable` | N/A |
| `/private/tmp/admin-cleanup-audit-e06f24c` | `e06f24c499cfdc6055e88a3b0508571feb2a31c4` | `detached; missing/prunable` | N/A |
| `/private/tmp/admin-introduction-rpc-preflight-5e3adc9` | `5e3adc93dceb083902694b4dbdf830e7d8fade68` | `detached; missing/prunable` | N/A |
| `/private/tmp/admin-production-input-reference-90c59c` | `90c59c03cb6eacfe601fa89eedaed26064689061` | `detached; missing/prunable` | N/A |
| `/private/tmp/admin-release-controls` | `aa620208a2bfaeebe06ffca9fb6b8220460c823f` | `codex/admin-release-controls; missing/prunable` | N/A |
| `/private/tmp/admin-title-audit` | `8080a2071b3bfb03fa2e7be7dd704ccadb092d17` | `codex/admin-title-audit; missing/prunable` | N/A |
| `/private/tmp/awards-skills-min-fix` | `8bf6b74d42b44e36d54a574cf078c1209f628015` | `codex/awards-skills-integration-validation; missing/prunable` | N/A |
| `/private/tmp/awards-skills-test-activation` | `44ce4ada029e682b7cbd7bd26ae583f5971e47e6` | `codex/awards-skills-test-activation; missing/prunable` | N/A |
| `/private/tmp/cms-pending-save-safety` | `987dca565033e4eec0c6a0f4328ddf42ade0c6b5` | `codex/cms-pending-save-safety; missing/prunable` | N/A |
| `/private/tmp/introduction-version-history` | `40eee1c690b946116eac2bbf5f9877562f808db4` | `codex/introduction-version-history; missing/prunable` | N/A |
| `/private/tmp/log10-admin-release.OVflif/worktree` | `936e33d8ef6ec501bfdf1b60b3188d4963061085` | `codex/log10-admin-release-20261013; missing/prunable` | N/A |
| `/private/tmp/owner-rpc-activation-runtime-tests` | `c2e76ec7033845e86950891950f81c33b8cbf37c` | `codex/owner-rpc-activation-runtime-tests; missing/prunable` | N/A |
| `/private/tmp/personal-website-public-audit-check-2-e06f24c` | `e06f24c499cfdc6055e88a3b0508571feb2a31c4` | `detached; missing/prunable` | N/A |
| `/private/tmp/personal-website-public-audit-e06f24c` | `e06f24c499cfdc6055e88a3b0508571feb2a31c4` | `detached; missing/prunable` | N/A |
| `/private/tmp/pr28-dbsetup-safe-reason-20261020` | `402465da1428438937f15175c0c43acd9a136eb2` | `codex/pr28-dbsetup-safe-reason-20261020; missing/prunable` | N/A |
| `/private/tmp/pr28-docker-api-observe-20261019` | `1003348f5d9836dc6d84453f1ff11fd1e82915d4` | `codex/pr28-docker-api-observe-20261019; missing/prunable` | N/A |
| `/private/tmp/profile-image-history-retention-9e05fe1` | `95a12483e6782887d87582946d728772545f9880` | `codex/profile-image-history-retention; missing/prunable` | N/A |
| `/private/tmp/profile-image-retention-prod-exec-6053e8a` | `6053e8a49daa4c89c9f7714afeb9a72799000af2` | `detached; missing/prunable` | N/A |
| `/private/tmp/public-ci-cleanup-batch-2b` | `35ad91747b15a774a50cb90acd1c554567cde8fe` | `codex/public-ci-coverage; missing/prunable` | N/A |
| `/private/tmp/public-icons-baseline` | `edb5762124e88640fd82bad12a75d22656f9c663` | `detached; missing/prunable` | N/A |
| `/private/tmp/remove-unused-public-starter-icons` | `fa35264c7dde8a24d79e82bc5318b7dcc90efed4` | `codex/remove-unused-public-starter-icons; missing/prunable` | N/A |
| `/private/tmp/retire-admin-qa-config` | `b10f775860dab5317d83548f8b110eca65b68fa8` | `codex/retire-admin-qa-config; missing/prunable` | N/A |
| `/private/tmp/retire-signing-probe` | `c31cf7aeffddce219eba3cfc1687e4f717852cfa` | `codex/retire-signing-probe; missing/prunable` | N/A |
| `/private/tmp/section-titles-activity-history` | `2adaa9c60b2415903822861a480037e65c492220` | `codex/section-titles-activity-history; missing/prunable` | N/A |
| `/private/tmp/signing-probe-retirement-release-9e05fe1` | `9e05fe121b82113b07187c1621ea5741a0479c96` | `detached; missing/prunable` | N/A |
| `/private/tmp/test-profile-signing-probe-runbook` | `2271ee2a0edfea51c45d578752a046c59f905e8c` | `codex/test-profile-signing-probe-runbook; missing/prunable` | N/A |
| `/Users/xiangsongfei/.codex/worktrees/admin-asset-compatibility/resume-site-public` | `9f7c4e7cd8708a6b9b8ce9ec3bba3e68e6cd433f` | `detached` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/archive-test-fixture-20261015` | `016d9088e7dc9ad0489da80fd7048d4e42448ef3` | `codex/archive-test-fixture-20261015` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/batch4-local-sql-harness/resume-site-public` | `c5e23db6d6dfe1deb4cf06976bc25374d3896803` | `codex/admin-local-sql-harness` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/candidate-a-target-compat/resume-site-public` | `4a462c9eb921ba4e62eea4d297ada75a2e1c63ff` | `detached` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/education-experience-activity-log/resume-site-public` | `3bbc6f013f5f204714781178f1e7c43d320ab8e2` | `codex/education-experience-activity-log` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/files-restore-pr2/resume-site-public` | `56f07ea1acca1944ea2503d0b667217915d3cc58` | `codex/files-restore-capability-enforcement` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/introduction-version-history/resume-site-public` | `f321b546977daa9679f423800094f8a278a1f5ab` | `codex/introduction-version-history-review-20261017` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/owner-three-domain-rpc-review` | `6099e5bf083e6fd4304c97fc16ac0b71030c41a1` | `feature/owner-three-domain-rpc` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/p0-test-target-auth/resume-site-public` | `4a462c9eb921ba4e62eea4d297ada75a2e1c63ff` | `detached` | 9 |
| `/Users/xiangsongfei/.codex/worktrees/pr28-ghcr-alias-fix/resume-site-public` | `3a1e5f576749771fe45398e048eea3c8de494c12` | `codex/pr28-ghcr-mirror-aliases` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/pr28-ghcr-registry-cache/resume-site-public` | `3b9d2f53a435ee033c10a40182df45a41ef5d055` | `codex/pr28-startup-typed-error` | 1 |
| `/Users/xiangsongfei/.codex/worktrees/pr28-ghcr-sql-ci/resume-site-public` | `3b4f47576b0750ebc1be70bf29fc93ea41093161` | `detached` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/prod-auth-release-e53ea7aa` | `e53ea7aa9071bb4047b8b31d29865d1876cc11c6` | `detached` | 3 |
| `/Users/xiangsongfei/.codex/worktrees/prod-auth-remediation/resume-site-public` | `aad4a720a9293e2414cdea4ff13a4bffdb3557fe` | `codex/prod-auth-remediation` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/profile-image-retention-production/resume-site-public` | `91ebd98d300c8904376027f1f47f9ed1e9244f53` | `codex/profile-image-runbook-linked-cli` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/public-worker-deploy-plan/resume-site-public` | `e06f24c499cfdc6055e88a3b0508571feb2a31c4` | `detached` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/remove-unused-chatgpt-auth/resume-site-public` | `a7f1f6adf75256fa24c7958e30e74d9b774d8b21` | `codex/remove-unused-chatgpt-auth` | 1 |
| `/Users/xiangsongfei/.codex/worktrees/rsc-security-patch/resume-site-public` | `3b0e183b3e101db1a5e3406de2cd130a858637d7` | `codex/patch-public-rsc-19-2-9` | 0 |
| `/Users/xiangsongfei/.codex/worktrees/test-profile-signing-probe` | `cca3327898b0b9ab302fb88d6de9cafc5c9852a0` | `codex/test-profile-signing-probe` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/cms-local-signout-20261106` | `c990b72e37cfaf2faf41040256de8b0be8bfc650` | `codex/cms-local-signout-20261106` | 3 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/cms-local-signout-integration-20261106` | `f18ae7109dd1265eff195219f7a7549d8cb97094` | `codex/cms-local-signout-integration-20261106` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-doc-closeout-20261107` | `3c3bab517e967bb90ed97d0f290bb848094a095e` | `codex/s2-production-closeout-docs-20261107` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-password-mapping-20261107` | `f8802e8b0a152b96763e1c281832df5b43678f95` | `codex/s2-users-password-mapping-20261107` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-release-repro-20261107` | `69d748c7770d0ca53dee727ad3e25eee66abfc8f` | `detached` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s2-users-remediation-20261105` | `893cfa98feb150ef203aafa2d6814fe69286baa4` | `codex/s2-users-remediation-20261105` | 3 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-3-final-delivery-20261112-e449c25f` | `bb53580362777fd18eac6fc4769dfc87cd88cffc` | `codex/s3-3-final-delivery-20261112` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-3a-foundation-20261108-7dd22a81` | `323c4538eef1bd8f623438dbf23d8676b6e7c84c` | `codex/s3-3a-foundation-20261108-7dd22a81` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-3b-prep-20261109-e449c25f` | `e449c25faf26c77bedd9a8cf09850b96eea3e9a3` | `codex/s3-3b-prep-20261109-e449c25f` | 44 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-4-permissions-20261112` | `08df3019b02fef29c340a650bec3c8c343faaacb` | `codex/s3-4-permissions-20261112` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-5-s3-6-assets-publish-20261113` | `e137f553469e9ace26bbfcd8a0359e4e1160ad9d` | `codex/s3-5-s3-6-assets-publish-20261113` | 158 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-5-s3-6-assets-publish-20261113/example-cv-users/.runtime/s3-github-delivery-20261118T132450Z-387FCF29/01-s36-core` | `5364bc75adb3f3654b2d31be775957bff144c35b` | `codex/s3-6-text-publication-core` | 0 |
| `/Users/xiangsongfei/Documents/Codex/2026-08-17/https-fei-xiangsong-resume-xiangsongfei-chatgpt/work/s3-design-20261108-efae37f8` | `f99069cb7bdae08bfd8536bea4c738e917c3b71c` | `codex/s3-b1-design-20261108-efae37f8` | 0 |

新增第60个登记为本轮 S4 worktree，初始 HEAD 同 main，初始工作区 clean。新分支 Push 后将跟踪 origin 同名 S4 分支。源码引用固定于基线；worktree清单仅表示检查时点，不宣称所有历史工作区均可运行。

## 远端规则与 CI

传统 branch protection API 返回404“Branch not protected”，**不表示无保护**。Ruleset `25231670`（Protect main）active，覆盖默认分支，禁止删除和 non-fast-forward，要求 PR、解决 review threads 及 `Required PR validation gate`；无 bypass actor，当前用户 cannot bypass。

现有 `.github/workflows/pr-validation.yml` 仅在面向 main 的 pull_request 触发。`.github/scripts/pr-validation-gate.mjs` 按路径判断适用套件：本轮 `resume-users/S4/S4.0/*.md` 是文档路径，Admin/Public/Users/依赖审计不适用；仍须执行分类器测试与 Required gate。不得改工作流、把代码伪装成文档或将 SKIPPED 记成业务通过。创建本轮专用 PR 供正常检查，保持 OPEN，不启用自动合并。
