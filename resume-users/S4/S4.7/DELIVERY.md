# S4.7 Batch A · Introduction 候选交付

当前交付是默认关闭的应用候选。隔离 Worker 执行实际 UI、DTO、S2 SDK、S3 身份句柄、私有 RPC 客户端和回执解析。业务数据库由合成内存事务模型替代。目标数据库的实际提交和安全验收仍待批准。

## S4.7-A 与能力差额

起点为 `origin/main` `37aebfd2f7e11820309cd16ff1ea6fd06ccd23bf`。分支为 `codex/s4-7-text-persistence-20261128`，独立工作树为相邻的 `work/s4-7-text-persistence-20261128`。原 CMS 工作树有本地改动，S3 历史工作树和归档按索引只读核对。正式基线见 [Version 15 结项](../S4-UI/FINAL-CLOSEOUT-2026-11-28.md)。

| 依赖 | 可复用的依据 | Batch A 与真实差额 |
| --- | --- | --- |
| S2 / S3.3 / S3.4 | S2 Cookie 和服务端 Auth，冻结的身份／站点 SQL，S3.4 真实隔离 Owner 和 Grant | 每次调用从现有账户 Cookie 取得 token，验证签名声明和当前用户。SQL 负责按 UID/SID、Owner、Grant 与当前资格再验证。真实 Users → 私有入口与跨会话联动需补测 |
| G-READ | S4.2 站点收据；S3.6 私有 Introduction read；S3.6 R03–R07 | 读取 active 本站后再读真实聚合合同。合成覆盖空站点、空内容、拒绝和不可用。真实来源、缓存闭态、撤销和两用户隔离待新执行面复验 |
| G-SAVE | S3.6 最终 R01–R24 为 24/24。R07/R08/R13–R17 覆盖文本、CAS、同键、回滚、对账和摘要 | 完成本地候选和原合同接线。需在获批目标核对 M3→01 安装、当前资格、会话及 ACL、原生 PostgreSQL 双语提交、回滚、失联和独立读回 |
| S3.7 | 暂停索引所指独立可移植证据 423/423 | 沿用闭态安装和独立读回方法。当前只需文本候选，文件证明保持历史适用范围 |
| S3.8 | `S38_LOCAL_READY / HOSTED_GATE_2_NO_GO`，A14/B52 本地证据，新增 hosted 0/66 | 补 Users 文本调用涉及的真实 Auth/SID、有效角色、资格撤销和 SQLSTATE。托管目标仍需独立同范围证据 |
| S3.5 / S3.9 | 历史状态仍为 STRICT OPEN / DEVELOPMENT PAUSED 和 DEFERRED | PNG/PDF/Storage 与当前 Introduction 没有前置依赖 |

适用 SQL 来自归档索引中已验收的 S3.6 `01-text-publication.sql`。本次只读校验 SHA-256 为 `97b2017168b197ba6d006050717207535b6a56d3dcd5f1116b386313575bb175`。M3 通过原建站事务创建 active 站点、Owner、Introduction 和 revision 0。没有活动站点的账号需要先按 S3.3/S3.4 完成建站与资格准备。候选 UI 的建站入口维持禁用。Batch A 沿用已知站点模型及 SQL，未创建新 migration。

## 调用关系与失败行为

1. `ResumeEditor` 从现有工作区读写 `LocalDraft.introduction`。UI 仅在已读取本站可支持的 Introduction 模型后允许编辑和显式保存。默认入口保留 Version 15 编辑、预览与示例。
2. DTO 保存原记录的共享 `id/position` 与 `zh/en`。缺失和显式空串分别表达。首条记录使用原 request ID 生成稳定 ID。S3.6 能表达多条记录，现有单字段 UI 对多条记录明确返回不支持。已核验的 M3 revision 0 成对提示仅在读取映射层显示为空，保存只使用真实字段。UI 的 fillingGuide 单独进入预览。
3. Worker 候选路由 `/api/sites/introduction` 和 `/operation` 要求服务器验证的账户与 session 范围。POST 需同源及 JSON。无缓存回执不含 JWT 或内部权限详情。服务先调用 `get_my_site`，再按本站调用 `read_introduction`。S3.2/S3.3 的站点容量为 1，当前 mine 意义为“无活动站点”。
4. 初次保存调用 `save_text_draft`。S3.6 将输入规范化、取摘要、绑定原键并在同事务执行权限复核、CAS、历史、审计和持久操作回执。当前草稿从 `draft_revisions` 读取。同键对账走 `read_text_publication_operation`，只查询原键、原摘要与原命令。
5. Worker 校验原键、目标、写入/无变化 revision，并单独读取对应版本的规范内容。若已出现更新版本，返回冲突，保留客户端修改。浏览器再次核对当前会话范围后按语言更新已保存基线。请求在途产生的不同值和其他栏目的 dirty 保留。
6. 网络断开、超时、结果无效或未观察到回执时，当前工作区保留原命令、request ID 和摘要。后续按钮只做原键核对，重复点击共用在途状态。完整页面卸载仍遵循 Version 15 的内存草稿边界，未完成操作不会写入浏览器持久存储。对账期间可继续编辑，主动刷新前应保留需要的修改。401／换号销毁旧身份内存。403 保留可供核对的原操作。草稿及回执验证请求禁止消耗刷新令牌。会话需续期时可在另一标签页借由既有 S2 工作台续期，再以原请求重试未发送的命令或核对可能提交的操作。

## 生产闭态

Mac 只读核验 Version 15 的部署与源码注解、GitHub main 和匿名 `/api/sites/mine`、`/api/sites/introduction` 两个 404。候选 composition 只允许 `USERS_MODE=isolated`、显式合成模式和 Worker-side 绑定，固定的业务地址为保留的 `.invalid` 域。正式 Wrangler 配置不包含该绑定或开关。其他栏目仍走 Version 15 本地草稿。S4.8 及后续离线准备见 [预览来源合同](../S4.8/PREVIEW-SOURCES.md)。

## 集中验收申请

建议只批准本机新隔离目标 `s47-intro-acceptance-20261128`。执行前绑定新建独立项目名、空卷、Unix socket、回环端口、锁定版本及运行清单 SHA。资源限本机 GoTrue、PostgreSQL、PostgREST 和本地测试 Worker。既有 Docker、S3 B07、现存 Supabase、Cloudflare、外部存储和 AI 打开次数均为 0，云端新增费用上限 US\$0。

- SQL 范围限经核对的 M1–M7、S3.6 01 文本迁移和本目标必要的精确闭态／资格配置。原 RLS、ACL、约束及签署路径继续适用。使用原创建事务初始化两个 .invalid 合成 Owner 的两站。最多一次闭态安装和一次独立回滚演练，两次合成密码登录、两条短时 Grant 和一个短代次。M3 已有站 revision 0 升级、Owner mirror、空内容和临时 ACL 的适用实证必须纳入。
- 最多 48 个文本业务 HTTP 请求，其中最多 10 次调用可能写入的保存入口，最多 8 次原键对账，最多 24 个只读或拒绝校验 SQL 观察。覆盖双语、规范回执、显式清空、CAS、失联、回滚、同键冲突、撤销/自然过期、错站点和错记录，以及原生角色直接 RPC 拒绝。
- 权限意外授予、目标或摘要漂移、任何其他站点受影响、预算耗尽、关闸无法独立确认时立即停止。UNKNOWN 只按原键、摘要和身份对账，读不到时保留 UNKNOWN，停止变更探测。完成后独立确认撤销代次与 Grant、关闸及 ACL、入库效果、监听和运行资源关闭，仅留脱敏证据。
- 真实本机结果与 hosted 结果分别登记。托管前还需确定独立目标标识、目标对应的私有入口绑定和相关 Gate 2 证据，再申请对应的托管权限。
