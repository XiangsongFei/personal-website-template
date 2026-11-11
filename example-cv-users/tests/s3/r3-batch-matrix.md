# R3 Proof 与 Grant 验收程序（M5/M7）

项目固定为 `ecv-s33a-20261109-7dd22a81`。入口 `prepareR3Batch(host).next(name)` 复用实际 Worker 签发器、HMAC 验签器及身份适配器。仓库未附带 live host、凭据、网络监听器或默认驱动。测试文件提供虚构密钥和内存账本。每次执行返回 ACCEPTED/STOP/UNKNOWN，环境证据单独标记 Offline 或真实。子进程、并发和数据落盘的结果均须以真实后端再验。

## 启动条件

- 固定已安装 M7、历史 M5 函数体指纹、固定容器、独立服务身份和 HBA。当前原库 ssl=off，现有登记驱动必须验证 TLS 服务端并使用专用客户端证书；未完成对应传输验收时不得启动。公共 Data API 始终仅 public。
- 另批 generation、受控密钥、精确资格行、开关、意图记录和逐项写预算；本程序无初始化写入。固定 Alice/Bob UID，合法签发器绑定实际 Auth 签名验证的同一 UID、Session、project、AMR、epoch。为真实旧 epoch 反例，Alice 的获准 epoch 须至少为 1。两名用户的目标 Session 必须分别通过真实合法密码登录并在首次 issue 前持有 60 秒内的新鲜登录收据；先冻结能力，不假定历史 Session/JWT/密码仍可用。自然过期 Grant 检查需要原 Bob JWT 和 Session 届时仍有效。
- 宿主固定目标、绝对路径、已查验的模块/进程、证书、短时单次授权和证明 ID。独立隔离的签发、验签和登记进程按用途持有材料。在触及真实签发或 RPC 前，宿主须证明能持久原子消费本步骤的批准，精确钉住物理传输预算、启动独立观察进程、绑定后端 PID 和获取下述拒绝证据；证据采集能力不明即停止。身份/时钟/目标异常、签发失败、凭据或账本结果不明、失去响应、预算超限、观测有歧义时，保留该次状态并停止全部后续。只允许独立只读核对，不重发、不清理、不新发 ID。
- 本程序不实现配置、DNS、外部凭据、创建 Bob、启用服务或查询签名材料。测试宿主不得接受普通用户提交的 `context`、数据库角色、请求分支标签或调试日志。Mock 提供的观测只能用于离线回归。

## 顺序与批准上限

前四项正常完成后，须在两份 Grant 均有效时插入单独预算的 Alice/Bob 建站段。完成建站后继续第 5 项。不得等到撤销 Alice 或 Bob 自然过期才开始建站。

|次序与场景|登记 SQL / RPC / 物理 HTTP 上限|已提交差异上限及核对|
|---|---|---|
|1 aliceIssueRace，同一已验证票据并发消费|1 / 2 / 14|意图消耗1，票据+1，回执+1，Alice Grant+1；两条独立连接并发，1 成功，1 精确已消费拒绝|
|2 aliceReplay，未过期的相同声明|0 / 1 / 7|已消费分支，票据/回执/Grant 不变|
|3 unregistered，合法但未登记的 renew|0 / 1 / 7|活跃 Alice Grant、正确 epoch/身份/用途/摘要，全新 proof_id；数据库缺票拒绝，0 行|
|4 bobIssue，首次 issue|1 / 1 / 7|意图消耗1，票据+1，回执+1，Bob Grant+1|
|5 aliceRenew|1 / 1 / 7|意图消耗1，票据+1，回执+1，更新同一 Grant 一次，核对新有效期|
|6 staleEpoch，合法签发较低 epoch|1 / 1 / 7|意图消耗1，票据+1，登记阶段只校验声明范围；业务事务 epoch 拒绝，不生成回执|
|7 expiredTicket，登记后等到真实到期|1 / 1 / 7|意图消耗1，票据+1，成功登记和首次消费之间等待，数据库拒绝，Grant 不变|
|8 aliceRevoke|1 / 1 / 7|意图消耗1，票据+1，回执+1，同一 Grant 标记撤销一次|
|9 revokedRenew，新票据不能复活|1 / 1 / 7|意图消耗1，票据+1，撤销 Grant 保持原摘要，0 新回执|
|10 bobExpiredGrant，自然 30 分钟后|0 / 1 / 7|同一 Bob JWT/Session 仍有效，用 get_my_site 测业务资格，到期拒绝；行数和摘要不变|

总上限为 77 个物理 HTTP 跳次、7 个意图服务领取 RPC、7 次单语句登记 SQL、11 个私有业务 RPC 数据库事务（10 次 apply，1 次 get_my_site）。每次业务 RPC 最多 7 跳：受保护外层 1，Worker/Auth ≤2，Worker/私有入口 1，入口/Auth ≤2，入口/PostgREST Unix HTTP 1；固定公钥本地验证，无刷新、重定向、discovery 或重试。未来 host 在物理传输处逐项计数；每项少用的额度不能转给其他项。主体 bootstrap/Auth ≤9 个 HTTP 另见总计划。预先配置和两站业务段另列。7 个登记调用分别产生一张票据；4 个业务写事务成功，6 个写事务因 42501 回滚，最后一个读取事务因 42501 结束。总新增 7 张票据、4 条已消费回执、2 条 Grant；Grant 更新 2 次。本段 Auth、站点、邮件、DNS 副作用预算均为 0。各项消耗本地一次性批准 1 次，签发项分别消费专用意图 1 次；这些账本与业务数据库分开保全。

## 独立取证

`r3-batch-observe.sql` 仅为后续待审只读输入。受限观察进程用固定 `psql -X -w`、`ON_ERROR_STOP=1` 并从私有 stdin 提供白名单公开声明参数；禁止接受任意 SQL、密钥、JWT、Auth 原始资料。每一步前后各 1 个新连接，成功时各观察一次 BEGIN 和 ROLLBACK 并核对进程正常退出。20 个普通只读连接外，本段最多另 1 个并发观察连接和 1 个 STOP 收尾连接，总计 ≤22；并发观察可在一个 READ COMMITTED READ ONLY 事务内最多取 20 个 `pg_stat_activity/pg_locks/pg_blocking_pids` 脱敏快照（5 秒或 20 次先到即止，明确 ROLLBACK）。禁止为制造竞争改变函数、延迟真实事务、插入锁行或重发消费。不能证实竞争则停止；两次返回与真实等待分别记录。完整目录/Auth/站点基线的前后新连接在总批次单列。

拒绝归因需要可信内部 PostgreSQL 诊断及独立只读对账。在隔离环境先验证捕获条件：从批准的现有服务端错误记录或可信驱动诊断取得服务端 PID、SQLSTATE、错误发生时刻及 PL/pgSQL 最内层 CONTEXT 里实际函数签名与 RAISE 行号，在独立进程内将实际 prosrc SHA 与冻结来源比较后输出有限枚举。绝不存原始 CONTEXT、SQL 参数、请求正文、Authorization 或全量日志。必须能将对应请求的隔离批次、序号、UID/SID、公开 proof_id、受保护入口、实际 DB PID 和时间窗关联。私有 PostgREST 的公有错误投影已隐去了分支；若当前合法观测能力不足则相应属性 NOT VERIFIED，不能通过分析 HTTP 403 或凭时序猜测补证。本轮未安装诊断适配器、启用数据库日志或读取运行日志。需要新增审计能力必须单独审批，并保持公开错误合同不变。

|M5 实际 prosrc 对应 RAISE 行|可认定的拒绝分支与必要独立条件|
|---|---|
|apply_business_grant 18|PROOF_ALREADY_CONSUMED / 42501；精确同一未过期公开票据，已有匹配消费回执。并发另需两条执行连接的 UID、SID、服务登录、当前角色、RPC、物理 PID 与时间窗相符，观察到失败者在两者的请求重叠时间内因 transactionid 等待成功者，独立事务最终 ROLLBACK。|
|verify_business_proof 14|uid 与 sid 均与目标匹配，对照完整入参、未登记 id 及正确摘要后，才可归因为缺票。改用 active renew 避免 duplicate issue 产生同码假阳性。|
|apply_business_grant 13|通过真实 Worker 验签并登记，公开声明 epoch 恰比目标数据库当前 epoch 小 1；独立区分数据库拒绝和 Worker 拒绝。|
|check_ticket_claims 43|该分支含多个条件；只在其余字段/代际时间均正确、成功登记且实时时钟到期时归因于票据过期。|
|apply_business_grant 31|同一已撤销 Grant、代际/epoch/原期限/绝对期限及 Session 均合法；独立验证撤销前后 Grant 及其余对象未变化。|
|lock_business_qualification 7|get_my_site 在资格检查失败；仅在未撤销、两种时限至少一项已过期、其余资格仍有效并排除 RLS/成员异常时归因为 Grant 过期。|

框架另验证前后新连接 PID、鉴权和门禁状态、其他票据/回执/Grant 的有序摘要，逐项比对目标 ticket/receipt/Grant。参与者相关证据放入后续批准的受限宿主；如同一 RAISE 仍有两个可能条件，宿主必须拒绝标记特定分支。返回 403、请求都完成或单一成功回执，均不足以证明真实锁竞争。

## 额外负例与本轮回归

维护者可在 `example-cv-users/tests/s3` 运行下列纯离线测试：

```sh
node --test r3-batch-program.test.mjs
node --test --test-name-pattern='valid MAC|reject before registration|wrong public payload|recovery with password|unknown outcome retains' r3-verifier.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest r3_database_test.TicketTransactions
```

- HMAC 使用实际 Worker 模块、Web Crypto HMAC 与 timingSafeEqual；节点运行时验证固定虚构材料。篡改 MAC、错误 key、UID、Session、project、action、摘要、Recovery、过期均在相应 Worker/身份/数据库模型拒绝。诚实运行的真实签发器不会生成这些恶意有效输入。对真实 Worker 做负向注入须另批只接受虚构材料的受保护注入口和预算；不得令当前签发器尝试其它 key 或放宽身份绑定。在本表给出的内部 RPC 预算外，真实负向签发/注入为 0。
- 应用过程末尾抛错后的原子回滚在现有事务模型 `fail_at_receipt` 验证；表中六个真实预期拒绝仅检验真实拒绝事务的最终状态。要在持久写入与回执之间注入真实故障需另批克隆隔离环境/定点故障入口；本预算 0。丢失登记或消费响应只作离线注入；真实未知时保留票据/Grant 和收据，只读对账，禁止重试或自动清理。
- 对新程序，错误消费分支、额外权限、错误行号或函数体、错误 PID、不重叠时间窗、不可证实的竞争、可绕过登记/消费检查、UNKNOWN、重复批准、Recovery、数据漂移和遗漏 ROLLBACK 都必须阻止后续。观察 SQL 已使用 PG17.7 语法解析器作离线语法检查。PG17.11 实际执行、列类型/权限及真实连接采集仍待单独审批。
