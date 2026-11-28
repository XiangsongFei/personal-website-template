# S4.7 C2 r02 结果与手动验收方案

**`S4_7_USER_ACCEPTANCE_READY`**。本机真实运行 `s47-all-text-acceptance-followup-r02` 完成，终态 `LOCAL_PASS_CLEANED`。G-READ 与 G-SAVE 均为 `LOCAL_PASS`。当前准入覆盖下一步用户手动验收，尚未取得用户手动验收结果。

## 证据绑定

运行使用 `5ad0be8b1f60fc94400a71d956bdd5d840880749`，GitHub main 与 origin/main 均为 `c0a9588254fab69e379d66e501b4e434d392e41c`。应用和候选 SQL 自 Batch C 验证的候选未修改。r02 清单绑定 r01 的 C2.1、C2.3 通过证据及两份文件摘要，未重复这些用例。[Batch C 结果](BATCH-C-LOCAL-ACCEPTANCE.md) · [C2 r01 结果](BATCH-C2-TARGETED-ACCEPTANCE.md)

本机运行使用 PostgreSQL 17.12、GoTrue 2.198.0、PostgREST 16.6 和构建后的 Users Worker。数据库和 PostgREST 分别使用独占 Unix socket。闭态安装 M1–M7、S3.6 01 和 S4.7 01–03 后重新加载 schema cache，并通过闭态探测。PostgREST 登录角色为 `ecv_s3_internal_api_login`，用户请求生效角色为 `authenticated`。生产只读基线为 Version 15、Deployment `9af7cb4e-3e42-4a7a-bbf3-c6e2f4fafadd`、流量 100%。

| 证据 | SHA-256 |
| --- | --- |
| r02 清单 | `87b389ea7bd7911ee3ec20e393531e9a470c01309846fe7ac9101eb376033e18` |
| r02 回执 | `810138d9554a367216904464a4afb8658ae89ffdb2e85409d91d9881bfc9f87d` |
| S4.7 SQL 01 | `c943f33b10bff5733ce1ec4c6f7df15cfaa6eb02c67a0c7803cc0524445a5097` |
| S4.7 SQL 02 | `03018cf0d5c31e52244a6742020b67e4b04dc8092ebb88f7ca41c8cab1fb1134` |
| S4.7 SQL 03 | `9e7b7f96f1c5fa51f94e486a10d2b22fdb8fed8e5e5a8ef3f80f1cc36580855c` |

清单、回执、预演计数和独立清理复查保存在 Git 忽略的 `example-cv-users/.runtime/s4-7/s47-all-text-acceptance-followup-r02/`。历史 PASS、FAIL、NOT_RUN、UNKNOWN 与 STOPPED_AND_CLEANED 记录原样保留。

## 真实结果

| 用例 | 结果与实际证据 |
| --- | --- |
| C2.2 退出重登 | **PASS**。Chrome 双语 Introduction 保存后退出。旧会话行不存在，旧刷新令牌不可用，旧 Cookie 调实际 Worker 得到 HTTP 401。新 Session 通过实际 Worker 读取同一站点和 revision 1。两项原键核对完成后退出，浏览器定位器为空。另见先前带未决标记退出及换账号的合成覆盖。 |
| C2.4 双标签页 | **PASS**。两条重叠写入的原生回执与原请求键、摘要和规范正文相符。分别保留并恢复两个原键，刷新未重发，核对一项后另一项仍在。保存期间继续编辑和其他栏目 dirty 状态均保留。陈旧 revision 的原生请求返回 HTTP 409／PT409，之前与之后的独立版本、作者、回执、记录数和正文一致。 |
| C2.5 Skills | **PASS**。必要夹具通过真实 Worker 保存，之后按稳定记录身份将第三条上移两次、删除指定行并编辑首条。UUID、顺序和 revision 2 经独立 PostgreSQL 查询与刷新后 UI 一致，未采用示例未写入。 |
| C2.6 撤权与过期 | **PASS**。原身份和 Grant 有效时两条直接原生读取均返回 200。撤权时 Session 仍有效，Session 过期时 Grant 仍有效。两个条件各自的直接原生读写均被拒绝，HTTP 403／SQLSTATE 42501。独立前后查询确认版本历史、记录、作者及持久回执不变，Bob 无新增版本，Outbox 为 0。 |
| C2.7 浏览器 | **PASS**。Chrome 运行上述双语、双标签页和会话用例。Firefox 与 Playwright WebKit 收到 Bob 站点的实际 Worker HTTP 200、revision 0 和空正文。原生 Safari 经实际编辑、保存与刷新回读 Profile revision 2，独立 PostgreSQL 核对同一正文和回执。Edge 未安装，继续保留 NOT_RUN。 |

未发现影响安全或持久化的新产品缺陷。本轮变更限于验收驱动、合成夹具及文档。Safari 合成预演曾发现 WebDriver 传回的对象无法可靠保留原始签名顺序，驱动改为取得原始请求体再按合同规范化计算摘要，修正后预演及真实 Safari 均通过。含两跳计数的最终预演为 148 次 HTTP、13 个保存入口、6 次原键查询。构建、TypeScript、ESLint 和 31 项定向测试通过。Codex CLI 独立审查再次因账户模型不可用而未完成，GitHub 官方 Review 保留到集中交付。

## 实际预算和退场

文本 HTTP 146／180。保存入口 13／16，其中 Worker 5，原生 8。原键查询 6／12，SQL 观察 19／24，登录与 Grant 各 4／4，短代次 1／1。新增云费 US$0。

独立连接确认业务、文本写入、公开读取、Outbox 全部关闭，两个物理闩有效。活动 Grant、代次、Session、刷新令牌、临时登录角色、连接和 RPC 执行授权归零。PostgreSQL 数据目录与 socket、PostgREST socket、GoTrue、Users Worker 及测试浏览器驱动监听均已清理。生产、B07、既有 Docker 资源与 GitHub 写入均为 0。

## 手动验收启动方案

手动环境等待单独批准。拟用 `https://localhost:19147` 提供现有完整 Dashboard。启动前确认端口空闲并绑定 HEAD、构建产物、SQL 摘要、独占数据目录和执行角色。启动采用已验证的本机 PostgreSQL、GoTrue、PostgREST 与 Users Worker 拓扑，使用新运行 ID `s47-user-acceptance-r01` 和两个新的 Unix socket。GoTrue 及 Worker 只绑定回环。闭态安装、刷新 schema cache、核对没有共享连接和临时授权漂移后，才交付两套一次性合成 Owner 账号。按有效 GoTrue Session 发短时同范围 Grant。预置数据仅包括合成履历和示例链接，A、B 各持有本站。账号密码仅当次本机交付。

### 时限和预算

- **操作窗口 20 分钟，会话、访问 JWT 与业务 Grant 各 30 分钟。** 仅在该本机 GoTrue 设置 `GOTRUE_JWT_EXP=1800` 和 `GOTRUE_SESSIONS_TIMEBOX=30m`。业务 Grant 使用现行原生 30 分钟合同。开表前验证首批会话及 Grant 均至少还有 25 分钟，独立读回应用实际使用的会话截止。若 Auth 未写下可供资格检查的明确截止，须先在这个新隔离目标落实并核对 `not_after`，才开启写入。操作时钟从确认就绪开始，20 分钟硬停止，即使凭据尚余时间也关闸。正常退出后重登会取得新 Session 和新 Grant，原会话不延长，整场截止不后移。一次短代次只覆盖当前开表和准许的重新登录期，每个授权证明仍遵守原合同寿命。[GoTrue 2.198.0 配置源码](https://github.com/supabase/auth/blob/v2.198.0/internal/conf/configuration.go#L250-L270)
- **手动独立预算**为 360 次文本 HTTP（含 Worker 入口与原生请求），其中保留 30 次用于原键查询和退场前核对。用户显式保存上限 30 次，同时限制两跳合计保存入口 60 次。最多 8 次原键核对、6 次密码登录与 6 条短时 Grant（含两次建站、两位 Owner 首登、各一次重登），1 个短代次，独立 SQL 观察 24 次（其中 2 次保留给退场）。安全关闭独立于业务 HTTP 额度。新增云费 US$0。

### 实际操作与关闭

1. 在独立 Chrome 或 Safari 会话分别登录 A、B。确认两位 Owner 各自只见本站的标记数据。
2. 用 A 依次检查十个文本栏目。保留双语和共享字段，修改自定义标题并核对侧栏、面包屑与预览。
3. 使用合成记录验证新增、修改、删除与排序。检查 Skills 预设采用，确认未采用示例没有入库。
4. 在双标签页保持一项未保存内容。另一个栏目保存后刷新，只读核对 revision、内容和栏目状态。有待核对回执时保留原键，用当前会话查询。
5. 退出后重新登录 A，再用独立浏览器检查 B 的站点隔离。记录用例结果及脱敏 request ID，避免记录密码、Cookie 和原始 Token。
6. 用户结束、20 分钟到期、预算触及预留线或出现未决安全状态时，停止用户写入并关闸。用独立连接核对未决原键和数据，撤销 Grant、代次、Session、刷新令牌和临时角色授权。确认公开与 Outbox 均关闭、连接归零后，停止 Worker、GoTrue、PostgREST、数据库和专用监听，移除本轮目录及 socket。只保留脱敏回执和预算清单。

这里的启动步骤和参数用于后续单独批准的运行。本轮未创建、启动或写入手动验收环境。
