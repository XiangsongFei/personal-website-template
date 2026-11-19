# S3 最新交接与能力依赖矩阵

## 证据顺序与当前事实

固定远端 main：`e137f553469e9ace26bbfcd8a0359e4e1160ad9d`。S3.3/S3.4 已分别经 #38/#39 合并。main 的 S3.4 交付记载真实隔离权限验收，但没有生产启用。

原 S4.0 盘点核对了当时的 S3 结项草案、GitHub 执行回执及 PR #40 的兼容验证。实际提交为五个文件，以 GitHub 差异和运行结果为准。内部材料只用于核对历史状态和离线测试范围。

[PR #40](https://github.com/XiangsongFei/personal-website-template/pull/40) 仍为 OPEN，HEAD 为 `5364bc75adb3f3654b2d31be775957bff144c35b`。原 S4.0 记录的是 [Run 44318287927 Attempt 1](https://github.com/XiangsongFei/personal-website-template/actions/runs/44318287927/attempts/1) 的依赖审计失败。同一 HEAD 的 [Attempt 2](https://github.com/XiangsongFei/personal-website-template/actions/runs/44318287927/attempts/2) 已通过 Users 依赖审计和 Required gate。该结果只结清这次完整 CI 检查，#40 的独立代码审查和 S3.6 真实业务验收仍未完成。

S3 总体为 `S3_PARTIAL_CLOSEOUT_WITH_DEFERRED_ACCEPTANCE`；S3.5 `HOLD`、文件能力关闭；S3.6 `REAL_NOT_RUN`。纯文本核心目前仅在 #40，PNG 内容切片及结项后续 PR 尚未创建。S4 获得启动授权，不自动解除这些阻断。

## 能力门槛

| 门槛 | 可核查现状 | 缺失/阻断 | 允许的 S4 工作 | 真实启用/验收必须补齐 |
| --- | --- | --- | --- | --- |
| G-AUTH：S2 账户 | 现有注册/登录/验证/改密/恢复及服务端会话代码；历史生产结项有效且有保留风险 | S2 登出/恢复与新 Grant 的生产联动 NOT RUN；本轮未重验生产 | 复用服务端会话与账户入口，给新页添加同等保护 | 新资格链不能将“有效账户”直接等同“可写站点”；新增页面保护和 S2 回归 |
| G-READ：本站读取 | main 的候选 service 有 mine、建站、operation read、Introduction read；源码明确未接 Worker。mine 校验 draft_revision=0、edit=false/publish=false | 无现役 `/api/sites/*`；现 Worker 非账户 API 404；泛用内容 DTO/API 未完成或未验收 | 合成 ViewModel、加载/未开放/错误态 | 审核新 API 与身份/授权链；普通身份本站读、Bob 跨站拒绝、撤销/迟到响应及 no-store；不得用旧 API 替代 |
| G-SAVE：真实文本保存 | S3.3/S3.4 真实隔离身份/资格/建站/约束等有历史证据；文本事务规划与候选 SQL 有离线证据 | S3.6 真实文本保存/CAS/发布事务未运行；PR #40 独立代码审查未完成；无已启用新保存入口 | 本地编辑、排序、预览；真实保存保持不可用 | 先解决独立代码交付阻断和 API 范围，再批准隔离目标/可信身份/资格、M3/M5 运行条件；证明两语/排序原子提交、CAS、同键幂等、并发、撤销/UNKNOWN 对账。闭态 CHECK 不得临时绕过 |
| G-STORAGE：资产 | 早期 M10/M11 闭态安装及独立权限子项有证据；PNG 字节/哈希/ready/对象绑定与私有响应有本地候选 | 当前资格、Storage RLS/最小 ACL、真实 Session 到文件链端到端未完成；`C_D_COMPLETE=NO`，HOLD | 文件占位、错误/拒绝态、合成内容校验；不能上传真实文件 | 批准独立隔离条件；证明 Worker 最小授权、Alice 许可窗口仍不能直连、Bob 拒绝、私有 PNG 上传与持久哈希、不可覆盖、读取、撤销/在途及引用保护；PDF/签名/清理另审 |
| G-HISTORY：活动/历史 | 旧 CMS 有完整 UI；新模型/合同有审计及 revisions 设计 | 旧 read/restore RPC 不适用；新本站历史读取/安全投影及恢复接口未验收 | 纯展示和合成分页/差异，明示未开放 | 本站审计投影、分页/过滤授权、无内部凭据/他人信息；恢复需新草稿版本、CAS/幂等/原请求核对及文件重新授权；不自动公开 |
| G-PUBLISH：公开发布 | 文本规划候选/离线事务模型；旧 Public 是独立生产系统 | PG-only 闭态联合批次未跑；真实 JWT 到 M5、公开投影、Outbox、外部投递/缓存撤回未验收 | 设计确认流程和不可用状态；本地预览 | 先闭态安装/独立目录与 Auth/ACL/预算，再受控验证正常发布/撤回、并发、撤销与对账；匿名字段白名单、域名解析、Outbox、公开版本/边缘缓存失效。文件发布还依赖 G-STORAGE |
| G-AI：建议 | G5 只定义选中授权字段、建议不持久化、模型无 DB 权限 | 无已审核的 AI Provider/网关、Secret、隐私/预算/限流/错误合同及验收证据 | 明确不可用入口、建议界面合成设计 | 用户决定 Provider 和数据范围；独立服务/费用/隐私与超时合同、提示注入边界及最小字段测试；采纳只改本地表单，另行保存；不能直写库或发布 |
| G-RELEASE：生产 | S2、旧 CMS、Public 是独立现役 Worker，Git 与部署分开 | S3 生产 binding/权限/TLS/部署、最终迁移回放/恢复和综合跨租户验收未完成 | 本轮及后续代码审查/独立 Git 交付 | 每次实际数据库/云端/部署另获授权；不得以 GitHub Merge 或离线测试替代生产验收 |

S3.5 恢复顺序是先当前资格/Storage 权限与真实私有 PNG 链；S3.6 先闭态安装和独立目录，再另批受控开启文本业务，最后外部 Outbox/缓存。全量迁移回放、升级/故障恢复和综合泄漏否定验收仍要补齐。历史 STOP、UNKNOWN 和 NOT VERIFIED 原分类保留，不能追溯改 PASS。

## 生产基线的准确表述

[S2 生产结项记录](../../../example-cv-users/docs/S2-PRODUCTION-CLOSEOUT-2026-11-07.md) 描述当时的 Users 生产版本及流量分配。原 S4.0 与公开替代版均没有重新核验 Cloudflare 或生产 Supabase，因此这里只保留历史观察。纯文档交付不改变生产版本。

## 验收用词

- 源码存在、离线模型通过、真实隔离验收、已合并、已部署、生产验收分别记账。
- S4 纯 UI 可以单独验收；被禁用的真实能力仍记 BLOCKED/NOT RUN，不能合并成“功能全部通过”。
- S4 文档 PR 和 #40 的 CI 结果独立记账。S3 真实业务门槛仍需对应验收证据。
