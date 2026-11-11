# 首次单消费与后续九项 R3 验收合同

本版本继承已封存的 M7 批次，与原十步批次互斥。原版首步会同时派发两个 Alice 消费请求。若先运行过本版正常消费，再从原版第一步开始，会重复发送 Alice 的 issue。两套脚本不互作续跑入口。保留旧文件和旧验收结果。

## 可调用入口及证据

1. 在冻结服务连接后，可信测试 host 调用 `prepareFirstGrant(host).next('aliceIssue')`。同一实例仅接受此步。没有默认 host 或网络客户端。
2. `connectionEvidence()` 供内部观察进程投影两个已验证的连接。先独立绑定冻结的数据库、M7 摘要、服务进程、OS/证书、单一目标、HBA、时限及实际连接收据，再返回允许字段。用户侧须以真实 JWT 和 GoTrue 当前 Session 通过私有入口；登记侧须证明目标主机证书及独立登记客户端证书。现有登记驱动仅支持 verify-full 等效的 TLS 路径。角色名、客户端自填的核验布尔值或任意外部 JSON 都无权成为连接证据。
3. 在可信宿主中取得该 Alice Session 的新鲜正常密码登录收据和合法资格。先核验两个服务身份和独立数据库观察，后消费本步批准。由同一已绑定登录收据驱动实际 `createR3Issuer`、`createRegisteredGrantService`、原生 HMAC、受保护意图账本与单语句登记。申请首次 issue 的既有 Session 若无有效的新鲜收据必须停止；不能以 Cookie、历史 SID 或管理员身份补交。
4. 每项使用不可复用的已批准意图和 proof_id。登记只执行 `SELECT site_private.register_business_ticket($1::jsonb) AS registered`。普通用户身份提交 `apply_business_grant`，消费和创建 Grant 在同一事务。请求/登记可能已发出但响应缺失即 UNKNOWN；只读确认不构成第二次执行授权。
5. 观察进程用 `r3-batch-observe.sql` 核对 uid/sid/epoch、之前零票据/回执/Grant、使用的同一个 proof 的逐字段内容、消费指纹/时间、活动 Grant ID 与 RPC 返回的期限。前后连接不同且均 READ ONLY、退出0、明确 ROLLBACK。项目/函数/策略/成员、Auth（含非目标用户）及站点的稳定快照按批准基线规范独立归并为 `retainedSha`。只有完整取证且前后未变化时才可提供这个摘要；需要在已有观察事务中纳入这些采样，不得省略 Auth 或站点来计算。完整审核快照若需要额外连接，单独限定数量，不隐藏在 scope 连接预算里。
6. `meterEvidence()` 来自受保护的物理边界计数器，按批准 ID、角色与 Session 关联，不读取请求头或秘密。宿主在每个传输层的首次派发前执行预算守卫；程序再次核实每个边界完结后的实际计数。缺任一计数、出现未分类请求或自动重试即 STOP。模拟 host 的计数只能证明判定逻辑。
7. 最小闭环结束返回 ACCEPTED 和仅含公开票据声明、Grant ID、项目及版本的 checkpoint。保管时另行绑定批准摘要、CONSUMED、执行目标与签收，原有秘密绝不随 checkpoint 转交。`checkpoint()` 的对象本身没有授权效力。仅真实部署、实际收据和独立观察完整通过后，才能申请后续真实测试或建站审批。
最小段允许真实 epoch=0。后续的旧 epoch 反例要求同一 Alice 的可信 epoch≥1，条件不足即停止，不为测试更改资格行。

8. 后续批准的可信 host 调用 `await prepareGrantFollowup(host)`。`verifiedFirstGrant()` 必须在私有观察进程中核实前一段完整的来源、授权消费、执行和数据库收据，不能从请求 DTO 反序列化得到。新连接按原 uid、sid、proof_id 和 grant_id 重查成功的票据/回执及 Grant 未撤销、未过期；Alice Grant 仅约30分钟，绝对上限12小时，必须留足各段时间。失败即停止，不能重签、重新登录、另换 SID 或补建 Alice。如果当前签发器只保留不再能取得的历史 JWT，不能以同一 Session 后续可用作为前提。
9. 余下用例逐个调用 `next(name)`。Bob 的 issue 改为竞争消费，紧随其后用同一 Bob 票据做未过期重放、用活跃 Bob Grant 做无登记 renew。Alice 第一张票据届时即使过期，也不拿它作未过期重放对照。仅在两份 Grant 均已实证有效时才有资格申请两站；建站须独立审批和计数，若批准时窗耗尽就停止。之后才做 Alice 的 renew、旧 epoch、到期、revoke、撤销后 renew、Bob Grant 自然过期。时间相关拒绝须证明其余身份/会话/密钥等条件仍满足。
10. 后续拒绝分支、函数体及 RAISE 行号、后端 PID、请求身份、实际 transactionid 锁等待和重叠时间窗继续使用原 M7 批次合同。没有真实锁证据就不认定并发验收。任一失败不自动重发，不消费新意图，不清理数据库或 Auth。

## 分段计数

|用例顺序|登记 SQL|用户业务 RPC|物理 HTTP 上限|成功持久变化|
|---|---:|---:|---:|---|
|aliceIssue|1|1|7|票据+1，已消费回执+1，Alice Grant+1|
|bobIssueRace|1|2|14|票据+1，已消费回执+1，Bob Grant+1；另一请求必须精确拒绝|
|bobReplay|0|1|7|0|
|bobUnregistered|0|1|7|0|
|aliceRenew|1|1|7|票据+1、回执+1、同一 Grant 更新1|
|staleEpoch|1|1|7|票据+1，消费拒绝|
|expiredTicket|1|1|7|票据+1，消费拒绝|
|aliceRevoke|1|1|7|票据+1、回执+1、同一 Grant 更新1|
|revokedRenew|1|1|7|票据+1，消费拒绝|
|bobExpiredGrant|0|1|7|0，业务读取拒绝|
|合计|7|11|77|7张票据、4条成功消费回执、2条新 Grant、2次 Grant 更新|

每个登记 SQL 是单独一次提交的业务 INSERT 入口（调用命令为 SELECT）。11个用户 RPC 中10个为 apply，1个为 get_my_site；4个 apply 成功，6个 apply 预期回滚，最后一项读取预期拒绝。物理 HTTP 对每个业务调用按外层≤1、Worker/Auth≤2、Worker→私有入口1、入口/Auth每个业务 RPC 为1–2、入口→私有 PostgREST 1计；PostgREST 回环 UDS 上的 HTTP 也计入。缓存公钥允许减少某些远程 claims 验证成本，原始 JWT 和 Session 的核查不可缺失。额外 JWKS、发现、刷新或自动重试预算0。专用 PostgreSQL 协议登记、Durable Object 意图领取、连接证据和观察连接单列。跨进程若需转发、令牌交换或其他物理请求，必须在审批前明确计入。

最小段仅1个逻辑签发意图、1次账本领取、1次签发、1次登记、1次用户 RPC、≤7个 HTTP 跳次，最多1张票据、1条回执、1条 Grant；Auth、身份、邮件、用户表、站点新增或修改均0。真实签发所需新鲜正常登录若尚未获批，需另外申请 Alice 1次正常登录及其验签/核验最多4个物理跳次；GoTrue 预计 Session、Refresh、AMR、登录审计各+1及本人的登录字段更新，原4用户不变，邮件0需独立验证。不得重复历史六请求来取得这份预算。

后段仅剩6次签发意图/登记、10个业务 RPC 和≤70个物理 HTTP，新增 ≤6张票据、3条回执、1条 Grant，Alice 更新≤2。整批正常 scope 独立只读连接共21个：最小段2、后段接收 checkpoint 1、后九项18。另有真实并发观察≤1，全批 STOP 收尾≤1，最高23个 scope/锁/收尾连接。两个阶段从未并发重跑最小步；确认每项的授权包、项目、后端和唯一执行身份后才允许观测或派发。前置连接验收、角色配置、激活、资格维护、两人 Auth 准备与站点段均不在77内。若成立独立签发/验证/登记进程间的物理网络链路，须核实每条请求传输能归入哪个位置，无法归入就重新计算，不能声称当前候选已经实现该网络结构。

本轮只有无网络单元测试。未来执行宿主、可信连接、材料、持久审批与观察器尚未配置。测试密钥由固定的公开测试字节在 Mock 中导入；不访问现有数据库、Auth、用户密钥、Docker 或 Worker 服务。
