# S3版本、Builds隔离与发布交付台账

日期：2026-11-08，北京时间。文档候选基线438800cc8c25a2da2a7a14a8d9fdaf414fa414f5。
本次仅本地文档准备；Commit/Push/PR/Merge/SQL/上传/Promote均未执行且未获本轮授权。

## 已完成Builds隔离（VERIFIED，时间绑定）

| Worker | 操作/终检时间（北京时间） | 最终分类 | 生产基线 |
|---|---|---|---|
| example-cv-public | 11月8日00:58:54解绑；01:00:19—01:00:24观察后GET | PUBLIC_BUILDS_UNLINKED_VERIFIED | V130 / 80d9af06-37c6-49ec-9ee1-e8697c49b7d7；Deployment d2bdae1e-4ec9-4f10-a730-719a0dcd67bd；100% |
| example-cv-cms | 11月8日01:05:31—01:05:32解绑；01:07:01—01:07:05观察后GET | CMS_BUILDS_UNLINKED_VERIFIED | V144 / f4f077e2-dd65-42e2-affb-36f596fecdba；Deployment e6b5478f-12f1-42d1-9a9d-1b0027dd2efd；100% |

两次都是单独授权、单次DELETE指定Builds configuration；没有删除共享repository connection，没有改代码/运行时Secret/域名/流量。
本轮只读重验CMS至2026-11-07T17:11:43.286Z、Public至2026-11-07T17:11:47.756Z（UTC，+8为北京时间）：
均404/12040明确无关联，triggers空；版本/部署/etag/绑定元数据/域名/入口与解绑终检一致。
原Builds不再响应Git更新；不以新Commit/Push作探测。没有观察到新Build或非终态任务。

## 可追溯证据（本地保留，不上传原始快照）

| 本地证据包目录名 | 报告 | SHA256SUMS摘要 |
|---|---|---|
| 2026-11-08T005813+0800-public-builds-unbind-db9d83a2 | PUBLIC-BUILDS-UNBIND-REPORT.md | 5705856414dd7c474a010f3596a08c07b6178fc27f50c0c0e05073d0f2a2101c |
| 2026-11-08T010440+0800-cms-builds-unbind-24825454 | CMS-BUILDS-UNBIND-REPORT.md | 720996579f23e43a3bf235c984f497e3830e99390cc6a49ab20e2e8fccbf6cb1 |

本轮逐文件SHA校验通过，证据未改。目录名是本地定位线索，不是公共下载链接；不附私人路径/原始凭据/用户记录。
控制面验证不等于CMS真实保存→Public更新回归；该行为NOT TESTED。Secret元数据一致不证明值逐字节相等。

## 保留的发布风险

Public Version URL仍开启，workers.dev开启，绑定生产Supabase/KV；CMS workers.dev开启、Version URL关闭。
手动构建/应急发布未完整验证：CMS CONDITIONAL（命名/VITE来源/打包待解决），Public BLOCKED（配置恢复来源UNRESOLVED、生成配置/工件待验证）。
仓库CMS name=example-cv-admin与云端example-cv-cms差异仍在，本次不修改。
Public源码内容链路为页面挂载→no-store /api/resume→运行时Supabase读取，原Builds不是其必要步骤；实际端到端仅INFERRED，不读生产记录证明。
未来Secret恢复缺口不等于当前网站故障；解绑成功也不解决恢复材料缺口。

## GitHub及外部触发器核查

本轮VERIFIED：main当前仅.github/workflows/pr-validation.yml；on=pull_request到main、contents:read，无已读生产deploy/Secret引用。
blob=4f7925750b9a0068298bdf57f80f2bfe9c5388ca。[固定workflow](https://github.com/XiangsongFei/personal-website-template/blob/438800cc8c25a2da2a7a14a8d9fdaf414fa414f5/.github/workflows/pr-validation.yml)。
repo webhook清单空；GitHub deployments清单空；Environments0；默认workflow权限read，不能自行批准PR。
Actions API另列历史Synthetic backup recovery，但不在当前main；没有读取/运行DR业务。
根/CMS package仍含潜在人工deploy脚本，不在PR workflow调用链中。npm构建不等于有上传权限。
其他GitHub App、组织级/外部CI、其他账户hook的完整清单仍UNKNOWN；不得声称所有自动部署都已消失。
main Ruleset要求PR、Required PR validation gate、解决threads；approving review数0、strict更新main=false。
因此CI绿不替代用户批准/独立审查。每次Push/PR/Merge前按当时配置重查，尤其workflow/package改动。

## 四批次Git计划

| 批次 | 建议切片 | Gate |
|---|---|---|
| B1 S3.1—S3.2 | 8文档基线→审查修订追加commit→文档PR | 精确白名单、设计评审、CI适用性、外部部署风险 |
| B2 S3.3—S3.4 | fixture规格、约束、建站/Owner、grant、RLS/GRANT、负例多个小commit/PR | 隔离环境另批；普通身份/直接API/Recovery证明 |
| B3 S3.5—S3.6 | 文件状态机/权限、草稿版本、快照/撤回、故障测试 | 不泄漏、不误公开、不绕撤回 |
| B4 S3.7—S3.9 | 完整回放、综合测试、独立审查修复、结项 | 固定SHA，无未解决P0，UNKNOWN保留 |

每批从届时已批准main新分支开始；正常Merge Commit保留小commit与PR合并历史，不默认Squash或重写已审核公共历史。
S3.7设计提前，环境在B2前另批；每批先测自身，不等第四批才证明权限。
第一份文档Commit建议docs(s3): establish identity, data model, and release contracts；仍需下一轮审批。

## 独立审批链

本地文件/Worktree准备 → Commit → Push → PR → Review → Merge → 生产SQL → Version Upload → Promote → 业务验收。
每个箭头都不是自动授权。Review绑定head SHA；新增commit使原review范围需重新确认。
不默认auto-merge，不因main已合并自动迁移/上传；后续触发器或workflow改变需重新审查。
生产Migration批准固定project、SQL顺序/摘要、预检/恢复/兼容性；Worker批准固定源码/工件/配置/Worker/account。
Upload仅新Version（可能含资产和Version URL副作用），回读确认旧流量未变；第二次批准精确Version ID及比例才Promote。
DNS/routes/Secret/KV/真实账号测试各自另批；故障STOP，UNKNOWN先GET，不自动Rollback或重新上传。

## 台账模板（待填，不能虚构批准）

| 字段组 | 必填内容 |
|---|---|
| 身份/范围 | record_id、批次、任务、北京时间、状态 |
| 源码 | repo、base SHA、branch、commit列表、PR URL、reviewed head、merge SHA/方式 |
| 文件 | 精确路径、diff摘要、是否触及S2/CMS/Public |
| 审核 | 对象SHA、审查方式/人、结果、未决项、批准引用 |
| CI/测试 | run URL、适用检查、环境/版本、PASS/FAIL/SKIP/UNKNOWN |
| 数据库 | 隔离/生产、target ref、Migration ID/SHA256、权限与回放 |
| 工件 | Node/npm/lock、模块/资产manifest、集合算法与SHA256、配置摘要 |
| 云端 | Worker、Version ID、Deployment ID、流量、绑定diff |
| 触发器 | 查询时点、自动链路状态、排队任务与证据引用 |
| 审批 | 本地、Commit、Push、PR、Merge、SQL、Upload、Promote分别记录 |
| 结果/恢复 | 已验证范围、限制、错误/UNKNOWN、独立恢复决定 |

源码状态PLANNED→LOCAL_PREPARED→COMMITTED→PUSHED→PR_OPEN→REVIEWED→MERGED；
数据库和云端分别跟踪，不把MERGED自动映射为MIGRATED/UPLOADED/LIVE。
台账只追加历史，不覆盖失败；不存Token/连接串/Secret或生产内容。

## 本轮本地文档准备记录

状态：LOCAL_PREPARED候选；专用分支：`codex/s3-b1-design-20261108-efae37f8`；Base Commit：`438800cc8c25a2da2a7a14a8d9fdaf414fa414f5`。
新Worktree初始CLEAN；原分支/57修改/71未跟踪保持原状。原注册52个Worktree的只读状态：26目录存在，19干净、7有变更；26 prunable全部保留。
仅新增本目录8份Markdown；不创建Migration、不运行项目构建或测试，不修改workflow/config/lock。
Commit、Push、PR、Merge及后续阶段均等待单独批准；本地diff/文档检查不能冒充CI或数据库测试。
