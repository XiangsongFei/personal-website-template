# 仓库与目录核查

## 仓库与交付基线

原 S4.0 盘点日期为 2026-11-18。目标仓库为 `XiangsongFei/personal-website-template`。公开替代版从重新核实的 `main`（`e137f553469e9ace26bbfcd8a0359e4e1160ad9d`）建立独立交付，只纳入六份 S4.0 文档。

应用源码为 Git 跟踪的 `example-cv-users/`，基线包含 282 个该目录下的跟踪文件。阶段材料位于同一仓库的 `resume-users/S4/S4.0/`。原盘点未发现已有的 S4 子目录，基线也未跟踪 `resume-users/`，因此只新增指定的材料层级。应用目录没有移动、复制或重命名，也没有引入嵌套仓库。

## 历史工作区检查摘要

原 S4.0 盘点查看了 Git 登记状态、HEAD、分支、工作区状态和目标目录。最初有 59 个已登记 worktree，其中 33 个存在、26 个已不存在并标为可清理。实际存在的工作区中有 9 个含未提交变更。原打开工作区的 Git 状态共 128 条，包含已修改和未跟踪的旧 CMS 内容。这些改动不属于固定源码基线，S4.0 未采纳它们。

原 S4.0 在独立干净的 worktree 内完成。上述统计只反映原盘点时点。公开版只保留统计和目录归属结论。

## 远端规则与 CI

`main` 的规则要求经 PR 提交、解决审查线程并通过 `Required PR validation gate`，同时禁止删除及非快进更新。分支是否受保护应以实际适用的 ruleset 为准。

现有 [PR validation 工作流](../../../.github/workflows/pr-validation.yml) 只对目标为 `main` 的 PR 运行。[分类脚本](../../../.github/scripts/pr-validation-gate.mjs) 按实际路径选择适用套件。`resume-users/S4/S4.0/*.md` 属于纯文档范围，应用与依赖套件按规则跳过，仍须完成 Required gate。跳过状态不能记为应用或业务验收通过。
