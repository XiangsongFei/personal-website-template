# 两条服务连接候选

本批实际 socket 会话记录为 `SYSTEM_USER=peer:root`，`session_user=current_user=postgres`，`role=none`，服务端 SSL 关闭，pg_settings.ssl 的 context=sighup、pending_restart=false，socket 权限 0777。PostgreSQL 报告 HBA 和 ident 路径分别为 `/etc/postgresql/pg_hba.conf` 与 `/etc/postgresql/pg_ident.conf`；当前身份有两个系统视图的 SELECT，均缺少对应底层函数的 EXECUTE，Owner 为 supabase_admin。精确首匹配、映射名、其他 trust 项、错误项及已加载规则保持 UNKNOWN。此处的 root 是已经观测到的 OS 认证身份。把任一新服务作为 root 运行会危及两条通道的隔离。

## 身份矩阵

|属性|用户业务|登记|
|---|---|---|
|当前/未来登录身份|ecv_s3_internal_api_login，现 NOLOGIN/NOINHERIT，连接数4，后续只对既有同名角色 ALTER LOGIN|ecv_s3_registration_login，现 NOLOGIN/NOINHERIT，连接数2，后续同样只改 LOGIN|
|业务成员边|authenticated，ADMIN=false、INHERIT=false、SET=true，grantor=postgres|ecv_s3_proof_registrar，ADMIN=false、INHERIT=true、SET=false，grantor=postgres；组保持 NOLOGIN。PG17 的 INHERIT 成员边使登录角色直接具有指定 EXECUTE，角色本身 NOINHERIT 是新成员边的默认值|
|当前身份|连接建立时 current_user=session_user=服务角色，role=none；私有 PostgREST 验证 JWT 后在事务 SET LOCAL ROLE authenticated；进入 SECURITY DEFINER 后 current_user 随各函数 Owner，session_user 始终是服务登录|session_user=current_user=登记登录，role=none；进入登记函数后 current_user 成为 ecv_s3_grant_writer，session_user 仍是登记登录，role 仍为 none。函数及 INSERT 策略都检查该条件|
|允许的私有对象|SET 后有 site_api USAGE 和 5 个函数的 EXECUTE，无业务表直接 DML|site_private USAGE、register_business_ticket(jsonb) EXECUTE，无站点数据表级/列级权限。不可 SET 登记组，不可 SET authenticated|
|公有数据库入口|私有入口仅开放下列 5 项，原公共 PostgREST 仍只暴露 public|无公共 HTTP 登记入口；普通浏览器与普通 Worker 调用方均得不到登记凭据|

两个登录角色均 NOSUPERUSER、NOBYPASSRLS、NOCREATEROLE、NOCREATEDB、NOREPLICATION；口令应为空，无对象所有权。每个服务登录的 bootstrap ADMIN 仅给 postgres，grantor OID 10，有 ADMIN，无 SET/INHERIT。登记组对应 bootstrap 关系相同。两条服务边的受让人均没有 ADMIN；服务及平台普通角色不能经其他成员路径取得 service_role、postgres 或未获准的角色。公共 authenticator 既有的 SET service_role 能力与本方案不共享。以上为特定业务对象的权限合同，平台 PUBLIC 对象另行审计；对数据库任意 SQL 的网络入口为零。

## 服务端调用边界

用户 Worker → 固定 HTTPS `api.ecv-s33a-20261109-7dd22a81.internal.test:443`，mTLS 私有入口验证客户端证书链及冻结的叶证书指纹。仅转发受信身份句柄绑定的原始用户 JWT；入口重新验证 issuer `http://127.0.0.1:56321/auth/v1`、audience/role authenticated、签名、sub、session_id、exp、正常 password AMR 和实时 Auth 状态。然后由冻结的 `/run/ecv-s33a-internal/postgrest.sock` 转固定私有 PostgREST；该进程以独立校验材料验证 JWT，使用固定数据库名及用户服务身份。M7 桥接查询活动 UID/SID、确认、封禁和时间；后续业务函数检查安全状态、成员和 Grant。只有受信私有服务能控制该 SQL 会话；窃取连接或获得任意 SQL 能力即可伪造 claims GUC。浏览器无 DB/socket/证书访问、入口不转发客户端提供的 GUC、Profile、role 或 verified 标记。私有 PostgREST 只配置 site_api、extra search path 为 pg_catalog、禁匿名角色/自动恢复/OpenAPI/管理端口暴露，Unix socket 及不可替换的父目录仅限两个批准进程访问。

五个 RPC 为 `site_api.get_my_site()`、`site_api.create_site(jsonb)`、`site_api.read_create_operation(jsonb)`、`site_api.read_introduction(uuid)` 和 `site_api.apply_business_grant(jsonb)`。现有 private-rpc.mjs 与 private-ingress.node.mjs 对每项限定参数名、类型和数量。原用户 JWT 始终保存在普通用户侧服务受控内存/私有链路。

登记服务只接受受信签发器交给实际验签模块的 envelope。Worker 用 HMAC-SHA-256 和固定长度原生 timingSafeEqual 比对；验签还校验请求所属身份和动作、规范 payload digest、密钥代次和有效期。登记服务使用独立 CA、客户端证书和私钥，固定 `pg.ecv-s33a-20261109-7dd22a81.internal.test:5432/postgres`、TLS 1.2+、rejectUnauthorized 和唯一精确 DNS SAN。现有驱动在验证对端前不能 query；该专用服务证书是 DB 信任的登记能力。任何能使用此证书的过程都在签发信任边界内，所以客户端认证材料只挂载登记进程，普通用户和签发者不能读。只发一次参数化 SQL：

```sql
SELECT site_private.register_business_ticket($1::jsonb) AS registered
```

参数为通过验证的公开声明（version、project、action、purpose、uid、session_id、epoch、proof_id、issued_at、expires_at、payload_digest、key_id、event）。DB 单独核验门禁、完整声明与代次、主体和时间，在独立事务登记。后续 apply_business_grant 通过用户通道重新绑定真实用户和 Session，核对 epoch、hold、撤销和一次性消费。超时、断连或不完整响应一旦不能排除已派发即保留 UNKNOWN；只读核对原编号，不复用意图、再次签发、重发或切另一凭据。不得持久化 JWT、连接串、cert/key 原文或 SQL 参数。

## 配置候选及防冒充门禁

`service-logins.sql.candidate` 是未来确定配置、独占维护窗口与后验方案后才可批准的 **1 个事务/2 次 ALTER ROLE/0 个新增角色/0 次成员 GRANT/0 个密码**。它检查目标数据库、非超级部署身份、服务角色/组属性、口令为空、无所有权或角色配置污染、精确 grantor/成员关系、传递权限和当前项目的关闭约束。固定 SQL 文件单独不能证明 daemon、卷、网络、HBA 加载、全部数据库的角色攻击面或活动数据；需要与本批及 M7 独立只读基线合并核对并在部署窗口排除其他 DDL。任何一项 UNKNOWN 均维持 NOLOGIN，不批准该文件。

`hba-prefix.mjs` 生成未来的**顶置**专用规则文本。没有默认源地址，作者没有配置 HBA。须冻结 include 展开后的最前位置、完整后续规则和端点；只绑定真实两个相异独占 IPv4 源 /32（证书路线），或两个独占且非 root 的同名 OS 身份（peer 路线）。对应 TCP 证书模式的具体允许行格式如下，两项地址尚待实测，模板不可直接部署：

```text
hostssl postgres ecv_s3_internal_api_login <API_EXCLUSIVE_IPV4>/32 cert
hostssl postgres ecv_s3_registration_login <REG_EXCLUSIVE_IPV4>/32 cert
host all,replication all <API_EXCLUSIVE_IPV4>/32 reject
host all,replication all <REG_EXCLUSIVE_IPV4>/32 reject
local all,replication ecv_s3_internal_api_login,ecv_s3_registration_login reject
host all,replication ecv_s3_internal_api_login,ecv_s3_registration_login 0.0.0.0/0 reject
host all,replication ecv_s3_internal_api_login,ecv_s3_registration_login ::/0 reject
```

使用 `cert` 验证客户端证书链和 CN=请求的登录名；本候选不使用 ident 映射，仅接受一对一，不共享私钥。用于 PostgreSQL 服务端证书的 DNS SAN 与客户端 CN 属于不同验证方向。源 /32 必须专属于目标进程/网络，不能是容器 NAT 后共享的网关，以免阻断其他服务；密钥不能被来自其他网络的进程取得。入口进程也必须不能切换到其他源地址、IPv6 出口或 Unix socket，借助后续 trust 规则请求 postgres。默认数据库 all 不含物理复制，显式增加 replication 拒绝。对分开的 HBA allow 后追加传输、数据库、目标角色及来源限定的 reject，阻断跳过 allow 后匹配宽规则。还应审计先匹配的 earlier trust、include、group/regex/mapping 与其他认证方式；若无法证明完整规则顺序则保持 BLOCKED。视图规范化可能丢失双引号，例如 all 与 `"all"`；不能仅凭视图重建文字等价性。

纯本地 peer 方案仅将前四个 TCP 专用行换成两行 local postgres <同名服务角色> peer；保留所有拒绝尾部。不更改 pg_ident.conf，不使用 map。必须先部署可验证 OS 隔离：两进程不同 UID、SO_PEERCRED 所解析 OS 名等于各自 DB 服务角色、用户命名空间中 UID 与 DB 服务端一致、无 CAP_SETUID/跨命名空间/挂载替换能力、无法取得特权服务凭据；libpq `requirepeer=postgres` 验 DB 服务进程 OS 主体。检查数据库 socket 挂载/路径/目录 Owner 及权限、其他可达 DB 地址；须禁止绕道 TCP 或另一 socket 以其他身份登录。local HBA 匹配的是请求的 DB 用户，不能按发起连接的 Unix UID 拒绝另一登录名；故必须对其余 local 规则全部排除可冒充的 trust/宽 map/ident 或其他不安全路径。现有 root → postgres 已表明不能默认同名映射。真实 host 的任何未知均导致本地 peer 不能用于服务登录；不得修改共享 local catch-all 以绕过审查。两种配置只选一条，经宿主资源和旧服务不受影响验收后才可考虑生效。禁止把两套前缀叠加。

## TLS 方案和下一次最小申请

|路线|认证边界与兼容性|真实前置和未来写入范围|
|---|---|---|
|原实例端到端 TLS|客户端验证 PostgreSQL 服务证书的 CA/SAN，DB 验服务客户端证书和 CN。与现有登记驱动一致。托管 Supabase 需单独验证能否使用自有客户端 CA、固定身份、直连或 session_user 保持不变；托管服务的 verify-full+密码合同不等于此 mTLS 合同。|申请固定服务端证书/私钥、客户端 CA 信任、两服务材料、私网路由、HBA 前缀。候选 `ssl=on`、`ssl_min_protocol_version=TLSv1.2`、`ssl_cert_file`、`ssl_key_file`、`ssl_ca_file` 为审核过的只读挂载和严格权限；已观测 ssl 的 context=sighup、pending_restart=false；若证书与目录可由当前资源安全提供，可另批受控 reload 并验证新连接。所需材料或挂载不在现有资源内时须单独审查容器替换等资源变更。决不改公网监听来解决可达性。可能影响所有连接，要逐服务做兼容与恢复审批。|
|专用 TLS 终止层|客户端验证代理证书；代理到 DB 的后一跳需在不可替换 socket 上用各自 peer 身份，或用独立 verify-full 的数据库认证。代理持有两种角色或可转发任意 SQL 是额外信任面。|需独立进程/网络、入站 mTLS、独立角色限定的窄接口、双向身份绑定与源约束。已有 Node PG 驱动要求协议层 TLS 与实际证书检查，全程代理还需证明实际协议和 SQL 身份。代理至 DB 任意明文 TCP 不接受。托管环境须有供应商允许的后一跳。|
|现有本机 Unix socket|仅证明同一受控 OS/namespace 上的 peer 身份。现有 socket 模式或 Docker exec 成功不足以验服务来源。|原 ssl=off 可用于本地专项实验；若 HBA 已符合精确合同则不必开 TLS，但仍需受控的 socket 路径和两个非特权主体。现有登记驱动不支持此传输，需单独审核实验专用 peer adapter。生产远程 mTLS 仍待验收。|

优先单独批准一次脱敏调查，确定是否有安全 local 路径，否则优先评估端到端 TLS 对原库的影响。固定集群使用已有足够权限的管理员作为只读调查者，全程一个新的 READ ONLY 连接和 ROLLBACK；不用超级用户 GRANT、不读服务器文件、不输出原始 HBA options 或错误文本。只对固定服务角色、库和未来冻结的两种实际来源投影规则优先级、类型、匹配/排除/无法判定、认证机制及错误布尔量；仅对相关 map 投影正/反向主体边界。若源仍未冻结，仅报告符号条件。磁盘配置与已生效配置独立；已有合法启动/加载收据或后续经批准的真实验证提供生效证据，单独的 pg_conf_load_time 时间戳不能证明某条规则成功载入。不确定的文件包含或引号语义需要额外的精确取证审批，不授权整文件读取。只读调查预算内不启动任何服务登录。后续另批：配置落地/生效、两个角色启用、两条服务实际认证及不同角色/来源/数据库/传输的负例，未满足前不得请求业务启用。

参考：[PG17 HBA](https://www.postgresql.org/docs/17/auth-pg-hba-conf.html) · [证书认证](https://www.postgresql.org/docs/17/auth-cert.html) · [peer](https://www.postgresql.org/docs/17/auth-peer.html) · [服务端 TLS](https://www.postgresql.org/docs/17/ssl-tcp.html) · [HBA 文件视图](https://www.postgresql.org/docs/17/view-pg-hba-file-rules.html)。
