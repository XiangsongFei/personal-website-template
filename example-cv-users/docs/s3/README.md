# S3 contract and implementation status

The current S3.3 delivery contract is [R3 trust-boundary ADR](R3-TRUST-BOUNDARY-ADR.md),
[final acceptance](S3.3-FINAL-ACCEPTANCE.md), and [deployment boundary](S3.3-DEPLOYMENT-BOUNDARY.md).
These supersede the original database-MAC requirement for the accepted **isolated S3.3 experiment**.
The original S3.2 documents remain intact as the historical design, not a claim that both verification models run.

M1–M7 are immutable historical, disabled-state installation sources. Their hardcoded isolated binding is
not production configuration. No workflow applies them to any database. Production migration, project
binding, credentials, TLS/hosting and public routes require independent review and authorization.
S2's active Worker, configuration and account/recovery routes are unchanged. S3 modules have no default
project, key, role credentials, listener or enabled production binding.

Earlier S3.3 candidate and S3.4 planning documents retain their original NOT RUN/BLOCKED context;
use final acceptance for results and remaining interface scope.

## Preserved historical S3.2 index

# Example CV S3 设计基线与阶段边界

日期：2026-11-08（Asia/Shanghai）。文档状态：本地评审候选，尚未 Commit / Push / PR / Merge。
源码基线：`438800cc8c25a2da2a7a14a8d9fdaf414fa414f5`。
仓库：XiangsongFei/personal-website-template。

## 状态词与授权

- VERIFIED：有直接代码、GitHub、控制面或本地证据支持，必须绑定查询时间和对象。
- INFERRED：推荐实现或推断；即使设计已经审核，也不表示已实施。
- UNKNOWN：证据不足；不能推导为安全或已失败。
- NOT TESTED：没有执行相应行为测试。
- UNRESOLVED：明确保留的未解决事项，不等于获得风险豁免。

S3.0 已完成只读审计；S3.1 的 G5 v1 和 CMS 复用方向有条件通过；S3.2 形成模型、权限、事务和测试设计。
**S3 业务 Schema、SQL、RLS、GRANT、Storage 与发布机制尚未实施，均为 NOT TESTED。**
本次仅获准新建独立文档分支/Worktree和这8份Markdown，不授权数据库资源、测试账号、Commit、Push、PR、Merge、上传、Promote。

## 文档索引

| 文档 | 主要内容 |
|---|---|
| [G5-v1](G5-v1.md) | 身份、Owner、成员、资源及AI/HR边界 |
| [CMS Reuse Matrix](CMS-REUSE-MATRIX.md) | 旧模块/表/API到新模型的映射与禁止复用项 |
| [S3.2 Data Model](S3.2-DATA-MODEL.md) | ERD、字段、键、约束、索引、publication修订 |
| [Authorization and Session](AUTHORIZATION-AND-SESSION-CONTRACT.md) | 可信签发、撤销、Recovery、对象权限与Data API |
| [Transactions and API](TRANSACTIONS-AND-API-CONTRACT.md) | 建站、保存、幂等、冲突、文件/发布/恢复 |
| [Isolation Test Spec](ISOLATION-TEST-SPEC.md) | Alice/Bob等合成数据、直接API和跨租户负例 |
| [Version and Release Ledger](VERSION-AND-RELEASE-LEDGER.md) | 四批次、审批、Builds解绑事实与版本台账 |

## S2事实与继承边界

历史事实：S2账户系统已生产上线，PR #34/#35已合并；基线main为438800c…。
S2已有注册、登录、邮箱验证、账户、改密、恢复和Session；可信UID通过服务端getClaims/getUser一致性验证取得。
[固定认证源码](https://github.com/XiangsongFei/personal-website-template/blob/438800cc8c25a2da2a7a14a8d9fdaf414fa414f5/example-cv-users/lib/auth/session.ts)。
S2历史记录的Users Version9、100%及用户恢复验收，不是本次重跑或全功能生产回归。
R-03精确根因、PR正式自动审查、发布字节关联与长期自然刷新等历史缺口继续保留。
[生产结项记录](../S2-PRODUCTION-CLOSEOUT-2026-11-07.md)不因此被改写。

保持三个网站独立：Users admin.example-cv.com；旧CMS cms-admin.example-cv.com；旧Public example-cv.com/www。
Users项目makwjnbubmrmopjhzror只作新身份/业务边界；不导入旧CMS账号、生产内容或DR权限。
S3.0元数据曾报告public无业务表、Storage统计为空，限该时点；不能推导当前GRANT/函数/Data API已安全。

## 四批次及验收

1. S3.1—S3.2：合同、复用、完整逻辑模型和API；提前完成S3.7测试规格。门禁：关键不变式、权限清单和未决项可审查。
2. S3.3—S3.4：另批隔离环境后实施建站/成员/会话资格、最小内容样例、RLS/GRANT。门禁：本人可用且直接API/Recovery/跨租户负例通过。
3. S3.5—S3.6：资产、私有Storage、草稿与发布隔离。门禁：文件权限、失败补偿、撤回和缓存不泄漏。
4. S3.7—S3.9：完整回放、综合攻击/故障、独立审查和结项。门禁：无未解决P0，所有UNKNOWN明确保留。
每批都有测试；不能将第二/三批验证推迟到第四批。S4完整编辑UI、AI和HR实现不在本阶段授权内。

## 尚未解决

- business_session_grants可信签发、上游会话撤销与外部Auth变更的一致性。
- Owner镜像并发约束和最小数据库执行角色的可行性。
- 生产GRANT、默认ACL、函数、视图、Data API曝露的完整只读目录证据。
- grant建议参数30分钟滑动/12小时绝对期限、软删除重建站点、Slug复用等需最终技术确认。
- Public/CMS手动发布与恢复未完整验证；Version URL风险仍在。
- 其他GitHub App/外部CI的完整清单尚无证明；Builds解绑不等于所有自动部署消失。
