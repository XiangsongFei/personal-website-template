# S4.7 A2 · Introduction 真实本机验收

目标 `s47-intro-acceptance-20261128-r02`，应用基线 `c0a9588254fab69e379d66e501b4e434d392e41c`。独立 PG 17.12（Unix socket）、PostgREST 16.6（独占 Unix socket）、GoTrue 2.198.0 ES256 和本机 Users Worker。

**G-READ LOCAL_PASS，G-SAVE LOCAL_PASS。** 两位合成 Owner 通过实际 Worker 密码登录和原建站事务完成本站初始化。关闭状态下一次安装和一次回滚演练均由独立读取验证，M3 原 revision 0 历史及 Owner mirror 保留。

旧 PostgREST 进程在 S3.6 01 安装后，对新增的只读操作 RPC 返回 `404/PGRST202`。重启该隔离进程、保持业务门关闭后，同请求进入 SQL 并返回 `503/PT503`。独立目录核对了保存和对账签名及 ACL。这次复现支持原 503 的 schema-cache 假设。r01 事务仍为 UNKNOWN。

正例覆盖真实双语写入、规范回执、独立版本及审计回读、显式清空、保存后重新读取、持久回执丢失和原键核对。原键同摘要查询得到同一回执，异摘要和 CAS 冲突拒绝。PostgREST 的指定事务回滚由原生回执和独立数据库计数共同验证。匿名、跨站、错记录及四个直接 SQL 角色拒绝。Grant 撤销和真实 Session 截止后，读写均返回拒绝，保存 RPC 发出次数没有增加。未执行同键重复 POST，已检验原键同摘要只读回执；未做浏览器重新登录。

共 47/48 个文本 HTTP 请求，Worker 保存入口 6、原生保存入口 4，合计 10/10。查找 5/8，SQL 观察 21/24。登录 2、Grant 2、短代次 1。业务、文本写入、公开读取和 Outbox 关闭，闭门 CHECK 有效，活动 Grant、代次、Session、刷新令牌、临时登录角色及授权 RPC 为 0。所有本次服务和 socket 清除，数据库目录移除。Docker、托管及生产写入均为 0，云端新增费用 US$0。

脱敏回执和清单留在 Git 忽略的 `example-cv-users/.runtime/s4-7/s47-intro-acceptance-20261128-r02/`。仅适用于本机；Hosted 和 Production 未验收。
