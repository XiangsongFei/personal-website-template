# S4.7 Batch C 本机真实综合验收

## 结论

`s47-all-text-acceptance` 的新增栏目 G-READ 为 `LOCAL_PASS`，G-SAVE 为 `LOCAL_CORE_PASS`。九个新增栏目均通过普通用户实际 Worker 保存、回读及 PostgreSQL 独立核验。Chrome 中 Introduction 提交后丢失回执、刷新、同会话另一标签页保留定位元数据，以及按原键查询回执均通过。综合运行后来触及 HTTP 上限并退场，终态为 `STOPPED_AND_CLEANED`。当前状态未达 `USER_ACCEPTANCE_READY`。

历史 Introduction r02 的 `LOCAL_PASS / LOCAL_PASS` 与 r01 的 G-SAVE `UNKNOWN` 保留。Hosted 和 Production 状态仍为 `NOT_RUN`。

## 运行身份与 SQL

运行 HEAD 为 `b2d7867f870502368509c722f13a99bea7e3516a`，main 基线为 `c0a9588254fab69e379d66e501b4e434d392e41c`。原生 PostgreSQL 17.12 和 PostgREST 16.6 使用独立 Unix socket。GoTrue 2.198.0 和 Users Worker 仅监听本机，Owner、站点及履历均为合成数据。

安装顺序为 M1–M7、S3.6 01 文本 SQL、S4.7 01–03。S3.6 01 闭态回滚演练、闭态安装及旧站点 revision 0 验证通过。四张新增表开启并强制 RLS，四个新增 RPC 的签名、所有者和默认 ACL 核验通过。刷新 PostgREST schema cache 后，三个新增只读 RPC 在闭态返回权限或物理门拒绝。保存 RPC 的签名和 ACL 在数据库目录核对，首次写入在开闸后由普通用户走 Worker 执行。

| 文件 | SHA-256 |
| --- | --- |
| S3.6 01-text-publication.sql | `97b2017168b197ba6d006050717207535b6a56d3dcd5f1116b386313575bb175` |
| S4.7 01-resume-text.sql | `c943f33b10bff5733ce1ec4c6f7df15cfaa6eb02c67a0c7803cc0524445a5097` |
| S4.7 02-repeatable-text.sql | `03018cf0d5c31e52244a6742020b67e4b04dc8092ebb88f7ca41c8cab1fb1134` |
| S4.7 03-introduction-receipt.sql | `9e7b7f96f1c5fa51f94e486a10d2b22fdb8fed8e5e5a8ef3f80f1cc36580855c` |

脱敏清单和回执位于 Git 忽略的 `example-cv-users/.runtime/s4-7/s47-all-text-acceptance/`。清单 SHA-256 为 `2220b304dec14db52b870f6ce04142216d05150e3fa6be403c17ef1d739afd11`。该清单含七份 M SQL、M7 本机派生、原生二进制及 Worker 构建摘要。原始回执 SHA-256 为 `4160756224cc5bb50df3aa3bba630532da721d8db39f46f589a18937a8f3d226`。

## 模块矩阵

| 模块 | 真实读取与保存 | 独立业务证据 |
| --- | --- | --- |
| Profile | 通过 | 双语姓名、毕业标签及共享页脚、毕业值，revision 1 |
| Introduction | 通过 r02 和本轮真实 Chrome | 双语写入、丢失回执及刷新后原键核对，1 条操作、历史、审计各 1，revision 1 |
| Education | 通过 | 新增 3，双语修改 1，删除 1，剩余记录换序、UUID 和本科分类，revision 2 |
| Experience | 通过 | 同等 CRUD／换序，双语时间及描述、中文描述显式空串，revision 2 |
| Projects | 通过 | 同等 CRUD／换序，项目 HTTPS 链接及两个语言的子方法，revision 2 |
| Skills | 通过 | 同等 CRUD／换序，双语自定义技能及条目，revision 2。内置分类回读待补 |
| Awards | 通过 | 同等 CRUD／换序，双语奖项与年份，revision 2 |
| Contact | 通过 | 双语联系文案、关注和状态分组，revision 1 |
| Links | 通过 | 显式公开邮箱、GitHub、双语 LinkedIn。初始邮箱为空，非法协议拒绝，revision 1 |
| Website Text | 通过 | 双语网站文案和导航，revision 1 |
| 自定义栏目标题 | 数据库通过 | 五个网站文字栏目标题及 Contact 标题持久化，记录标题独立。真实浏览器四处同步待补 |

对于五组多记录，用一条命令新增三条并保存。下一条命令修改、删除及换序，其后逐栏目重新通过 Worker 读取。独立 PostgreSQL 核对 14 个版本全部规范内容、作者、记录时间与请求回执的关联。原键、摘要、原 Session 和基础 revision 匹配。Bob 的新增栏目版本为 0，Outbox 为 0。初始和最终内容与合成期望逐字段相同，灰色示例未进入这些业务版本。

同一批准运行还取得匿名拒绝、四种直接数据库角色拒绝、跨站读取和查回执拒绝、跨站记录 ID 保存拒绝、旧 revision 的 CAS 冲突、数据库事务回滚及非法链接拒绝证据。错误后独立快照与原快照一致。实际重叠提交和新增 RPC 撤权、会话过期后的请求待补。r02 已取得 Introduction 撤权与过期后的请求拒绝。

## 浏览器、边界和退场

真实 Chrome 曾经取得提交后的 503、原键安全元数据、跨标签页持久化、刷新后查询及恢复成功。操作、历史、审计和 revision 未增加。随后重复 POST 发起，路由抵达 `get_my_site` 后用尽 HTTP 额度，未到达新的原生保存。已恢复的原事务明细确认存在且唯一，同键重复 POST 的端到端成功状态为 `NOT_RUN`。重新登录、标题四处同步、真实 Firefox、真实 Playwright WebKit 和真实 Safari 待补。多个独立未决标记的保留及换账号清理有合成覆盖，其中保存中文和英文、继续编辑、跨栏目 dirty 的真实 UI 场景尚未全部覆盖。Edge 未安装。

S2、Version 15 锁闭导航和相关编辑器定向用例 74 项通过。Chrome、Firefox、Playwright WebKit 和原生 Safari 合成浏览器回归通过，Chrome 的 Version 15 闭态导航回归通过。当前局部改动另有 29 项定向回归，通过 TypeScript、构建及 ESLint 检查。Codex CLI 独立审查因账户不支持该模型未完成。没有重跑无关 S3 历史矩阵。S3 补测只覆盖新增文本直接依赖，S3 继续保持 `S3_PAUSED_AND_ARCHIVED`。

| 资源 | 实际／授权 |
| --- | --- |
| 文本 HTTP，包括两跳 | 180／180 |
| 保存入口 | 35／36，Worker 17、原生 18 |
| 原键查询 | 6／16 |
| SQL 观察 | 20／40 |
| 登录、Grant | 各 3／4 |
| 站点、短代次 | 2／2、1／1 |
| 云端新增费用 | US$0 |

独立闭态核验确认业务门、S4.7 物理门、文本写入、公开及 Outbox 均已关闭。活动 Grant、代次、Session、刷新令牌、临时登录角色、数据库连接和 RPC 执行授权均为 0。两个 socket 和数据目录移除，GoTrue、PostgREST、Worker 已退出。生产、B07、既有 Docker 资源及 GitHub 写入均为 0。

## 待单独批准的定向真实补验和手动方案

下一次真实运行须单独批准。准备的定向入口为 `s47-all-text-acceptance-followup-r01`。沿用同一 SQL 和本机边界，只建立核对所需的两站及少数合成模块。预算最多 180 文本 HTTP、16 保存入口、12 原键查询、24 SQL 观察、4 登录、4 Grant、1 短代次、US$0。提交前预算检查为原键核对留出空间，独立关闸保留 2 个 SQL 观察。优先补同键重复 POST、Chrome 退出重登、全部自定义记录栏目标题四处同步、Skills 分类、同一基础 revision 的重叠提交和新增 RPC 撤权／会话过期。Firefox 和 Playwright WebKit 检查同库的代表性跨账号读隔离。原环境退场后保留，定向入口尚未进行真实运行。

真实关键用例通过后，再批准启动用户手动验收。建议使用 Version 15 本地 Dashboard，绑定获批启动时确定的 `https://localhost:<独占端口>`，配两套一次性合成 Owner 登录，凭据只在当次本机传递。仅预填虚构履历和示例链接。Chrome 或原生 Safari 登录后，依次检查十个文本页双语填写、保存和刷新，五组经历 CRUD／排序、自定义标题联动、退出／重新登录和另一账号的数据隔离。建议手动窗口最长 20 分钟、会话按独占 Auth 的短时合同在窗口内有效，实际 TTL 和预算在批准前冻结。完成或到期立即停止写入，先验闭态、撤权和会话注销，再停本机进程并销毁 socket 和数据目录，保留脱敏证据。
