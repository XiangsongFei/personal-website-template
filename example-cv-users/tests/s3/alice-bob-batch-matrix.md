# M7 后 Alice/Bob 建站验收候选

当前为 OFFLINE。siteBatch 为纯请求描述与结果判定生成器，默认没有 transport、凭据、套接字、目录或 SQL 执行能力。默认 OBSERVATIONS 模式在五份指定阶段的独立收据均匹配时返回 SITE_CONTRACT_OBSERVED。每份收据须提供 READ ONLY、明确 ROLLBACK、两名用户的 Owner 行数、完整性字段和 12 表数量及原始数据 SHA-256；并发阶段还须提供同一用例的两个 PID、实际等待及 blocking PID。外部采集器须保留经脱敏的原始关联证据。两条独立连接必须和 alice-create-A/B、固定 request_id、服务登录身份、函数、各自发出至完整响应的时间窗口相结合；锁观察需落入重叠窗口。观察不到可归因的两个 PID，整个并发门禁停止。PostgREST 池若无法安全归因，保留 NOT VERIFIED，不猜测 backend，不为通过引入任意 SQL。采集器还需完成完整目录与 Session 核验。OFFLINE 模式只能返回 OFFLINE_PASS。入口离线演练使用现有 createCandidateHandler、createSiteService 和 ModelDatabase。模型使用串行互斥锁练习同键并发响应语义。真实 PostgreSQL 的参与 PID、阻塞关系、实际等待、提交顺序、后验为 NOT RUN。

## 固定标识与真试前置

UID 和邮箱及两个主建站载荷取自 runtime/plan.json，SHA-256 为 51eca6eaba70c6027fc1aff70fc7a59956788edc7ec43d3d595450f6b8253abe。文件历史 RESERVED_NOT_CREATED 对 Alice 已失效。Alice 现在已存在，原口令和原始 JWT 的持有状态不得假定。冻结标识记录在 alice-bob-batch-plan.mjs；保留词载荷采用封存 108 和 admin，冲突载荷采用 107 和 Alice 的已有 slug，异摘要采用 Alice 原键及 zh，另键采用 104。均列入下一次审批。站点/entry/receipt/audit 等服务端 UUID 由数据库实际生成，不能预配或以客户端 owner 参数代入。

- 每次启动先独立核验固定项目、M7 和后续已批准的开关、连接、私有入口、主机、核验器、角色、租户及依赖指纹。执行目录规范绝对路径、私有单层 run-dir、各进程最小文件权限及历史清单来源需在最终带 IO 的入口重新冻结。此文件没有文件路径参数、shell 命令或消费真实机会的入口。
- 先用新只读连接核验 Alice 原用户和既有 Session 当前状态，若持有合法原始 JWT，再用固定受信验证器检查签名、issuer/aud、uid/sid、过期、normal password AMR 和实时用户/Session。仅有 Session 行不能勾选“有效 JWT”。若单独安排旧 JWT 的远程 claims/getUser，另留 **最多 2 次** Auth HTTP（无 refresh、无写入）；缺少 token 明记 NOT VERIFIABLE，原 Session 保留。Alice 应持有合法密码并完成新鲜正常密码登录收据；缺失时停止以单独审批密码恢复。恢复引起的旧 Session 后果不得计入本预算。
- 在固定 Bob 尚不存在时另批一次管理创建，随后分别使用正常密码登录；管理员凭据只在创建进程使用。若 Bob UUID 或邮箱冲突、Alice 资格来源不明、用户被封禁/处于 Recovery/hold、clock/epoch 无法确认，立即停止。
- 两人使用 R3 段已经独立确认的各一条 active Grant；站点段开始前记录两份不泄密的身份和 Grant 关联证据、有效时窗。必须在续期/撤销/自然过期对照之前插入站点段；若实际耗时导致资格失效则 STOP，不能自动续期、重签、刷新或重登。此段不调用 apply_business_grant。
- 真实版需要独立审批、全局一次性持久消费凭证、逐步骤 ISSUED/ACK、脱敏结果、跨进程秘密隔离与请求上限。纯描述生成器不能单独作为获准真实执行入口。连接及认证超时一律保留 UNKNOWN。单一竞争对的两项同时放行，收齐两个收据再进入下一个步骤；任何失败后不派发其他请求。没有完整响应，不得凭已发送次数推测提交/回滚或切换请求 ID。只用本阶段预留的独立只读对账机会，不能自动调用新的业务 RPC。

## 站点请求与结果

|固定顺序|用例数|外层 Worker 实际期望|独立验证|
|---|---:|---|---|
|A、B 连接以 Alice 同键同摘要各创建一次|2|各 200，两份完整 create_site 结果相同，服务端实际 site_id 一致|A/B 两个不同 backend 的等待/阻塞 PID 和事务先后，第三连接 1 张回执；缺锁证据标未验，不能重发|
|Bob 保留词、抢占 Alice 虚构域名、Bob 正常创建|3|400 INVALID_INPUT、409 REQUEST_CONFLICT、200 正常响应|首项在 Worker 入参层拒绝；域名冲突须证明已进入 DB 且碰撞时 Bob 没有既有站点，排除 owner/请求键冲突。冲突后独立确认 Bob 无站点、镜像、回执、审计，随后才允许 Bob 正常创建|
|Alice/Bob 分别读取本人站点和介绍|4|200，返回各自站点，两项初始译文、revision 0、禁止编辑/发布|独立数据库复核所有归属和草稿基线|
|Alice 新 ID 第二站、原 ID 异摘要、读原操作结果|3|409 REQUEST_CONFLICT、409 REQUEST_CONFLICT、200 succeeded 且原结果一致|新建行数 0；预先安排原键读取验证成功结果恢复。真实写请求 UNKNOWN 时停止用例，仅保留独立只读对账|
|Alice→Bob、Bob→Alice 各读介绍、他方操作、伪造 owner 字段建站|6|403 BUSINESS_DENIED、200 UNKNOWN 且 retry_with_new_id=false、400 INVALID_INPUT|跨租户介绍验证数据库行级拒绝。他方回执等同于当前行为人未观察到该操作。伪造字段由请求校验拒绝；这项只覆盖创建参数层的写尝试|

合计 **18 个外层 HTTP 调用，15 个可能到达数据库的业务 RPC**。3 个载荷在外层 Worker 的 parseCreate 拒绝，最多 3 跳/项（外层 1、Auth 验证 ≤2）；其余最多 7 跳/项（外层 1、Worker 核验 ≤2、私有入口 1、入口核验 ≤2、入口至 PostgREST 1）。域名竞争的只读收据另须关联具有受信服务端来源的私有 PostgREST 原始错误投影、此用例绑定的 Bob、同一 request_id、slug、create_site(jsonb) 和 PT409；仅外层 409、未取得后端证据均 STOP。M4 将三种唯一冲突投影为同一 PT409，真实违规约束名称仍为 NOT_OBSERVABLE，不能宣称得到远端 CONSTRAINT_NAME。外层按应用错误码验；内层应独立见 PT409、42501 与实际阶段，未取得内层证据时不得报告精确数据库冲突来源。**物理 HTTP ≤114**。拒绝编辑/删除/发布的真实资源级写隔离尚未实施，0 个真实请求，NOT IMPLEMENTED / NOT RUN；以后实现时单列 Alice/Bob 双向负例。公网 B01/B02/B03 已有证据不能替代这些测试。

## 持久差异

两人准备含 Bob 创建最多 1、两次正常登录各 ≤4 个物理 HTTP，共 ≤9；未来若核验既有 JWT 的独立可选两次 Auth 读取，须另计为 ≤11。Bob 创建产生 user、identity、审计各 +1；两次登录合计 Session、Refresh、password AMR、登录审计各 +2，**新增 Auth 行 ≤11**，两用户仅允许登录相关字段更新各一次。邮件 0 单独核验。当前批次实际 Auth/业务 HTTP、Grant 签发及站点新增均 0。

站点段只增加 2 组完整记录。每组 12 张表、14 行，覆盖 sites 1、site_members 1、site_publications 1、site_domains 1、site_locales 2、site_settings 1、section_state 1、intro_entries 1、intro_translations 2、operation_requests 1、draft_revisions 1、site_audit_events 1。站点段 **Auth 0、Grant/票据 0、原业务行 UPDATE/DELETE 0、业务行新增 ≤28、DNS/发布/邮件 0**。申请总预算时仅在 R3 核验段计算两条 Grant 和真实签发、登记/消费成本，两人的 Auth 准备亦只计一次。

alice-bob-batch-observe.sql 是离线候选。未来使用固定 psql -X -w、ON_ERROR_STOP=1，新连接，四个经验证的 UUID 作为 psql 引号变量输入，禁止拼接 SQL。成功后第一结果必须恰好两行，所有 *_ok 严格为 true，含唯一 Owner、同站外键、locale、翻译、初始未发布、回执摘要、会话、草稿摘要和同一操作审计。第二结果必须有全部 12 表。基线令两个 site 参数为空串；提交后用两个实际 HTTP site_id。每表 old_count 和 old_sha256 应与站点执行前基线逐项相等，added_count 等于上面的两倍。Alice 创建后及域名冲突后可仅填 Alice site、Bob 留空，阶段允许行数仅一套，Bob 的 owner_ok 为 false，确认无新增 Bob 数据。父级目录/ACL、原 Auth 用户、R3 状态及其他 7 个业务表用固定快照复核。站点前、并发后、Bob 碰撞后、Bob 创建后、最终五个观察点各一批独立只读（每批最多 6 连接，总计 ≤30，包括锁观察连接），每份验收必须观察最终 ROLLBACK。真实提交后保留新增站点、Owner、记录、Auth 身份和业务授权的实际状态，不重跑、不清理。
