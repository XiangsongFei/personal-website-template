# G6与S3.7隔离环境、合成数据及负面测试

状态：测试设计INFERRED；本文件所有新测试NOT TESTED。没有创建账号、站点、桶或环境。
S3.7规格提前定义；第二批开始前单独审批隔离环境/费用/资源。每批执行相应测试，第四批综合收口。

## 环境与fixture

独立Auth/Postgres/Storage/Worker；显式allowlist目标项目/账号/本地端点，禁止生产和DR凭据。
对齐记录中的Postgres17、锁SDK、Worker工具版本；差异绑定测试结果，不自动套用生产。
虚构Alice拥有A，Bob拥有B，Charlie无站；匿名无JWT；未来HR身份仅合成权限场景。
A/B使用明显不同且非真实的双语文本、头像/PDF、嵌套方法、相同路径；含缺翻译、排序、旧快照和新草稿。
正常/恢复/过期/撤销/旧epoch/错误issuer会话各有fixture；凭据不进入日志或Git。
高权限仅可准备fixture/独立核对最终状态，不能作为普通用户RLS证明。

## 权限矩阵

| 操作 | Alice | Bob | 匿名 | 未来HR |
|---|---|---|---|---|
| A私有草稿读写 | 允许 | 拒绝 | 拒绝 | 拒绝 |
| B私有草稿读写 | 拒绝 | 允许 | 拒绝 | 拒绝 |
| A私有预览/历史/审计 | 允许 | 拒绝 | 拒绝 | 拒绝 |
| A私有文件操作 | 允许，目的限制 | 拒绝 | 拒绝 | 拒绝 |
| 发布/取消发布A | 独立受控动作 | 拒绝 | 拒绝 | 拒绝 |
| 当前A公开快照/附件 | 允许 | 允许 | 允许 | 同普通访客 |
| 未公开/取消发布历史 | Owner历史入口 | 拒绝 | 拒绝 | 拒绝 |
| 直接改owner/member角色 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| 第二个owner站点 | 拒绝 | 拒绝 | 拒绝 | 无例外 |
| 人才搜索/AI调用 | S3不提供 | S3不提供 | 拒绝 | S3拒绝 |
| 旧CMS/DR管理能力 | Users不授予 | 同左 | 拒绝 | 拒绝 |

先证明Alice/Bob本人操作成功，避免“所有请求失败”冒充隔离通过。
界面、Worker、直接Data API、视图/RPC、Storage分别验证；服务端过滤不代替数据库边界。

## 负面/并发/故障清单

| 类别 | 操作 | 必须断言 |
|---|---|---|
| 身份 | 伪造UID/actor/metadata、旧CMS token、错误issuer | 不提升权限、不混项目 |
| Recovery | 换Cookie名、直接Recovery JWT、重放grant proof | 无business权限 |
| grant | 同proof异载荷、过期/撤销续期、旧epoch、session替换 | 不签发/不复活 |
| site | URL/body/query/header批量A换B | 无B数据和副作用 |
| record | A site配B record、猜测/枚举 | 无跨站读写及敏感存在性泄漏 |
| 嵌套 | A翻译/方法/附件指向B parent | FK/授权拒绝，事务无部分提交 |
| 归属 | 改site/parent/owner/member role、冲突upsert | 不转归属、不提权 |
| 批量/排序 | 混入B ID、重复/遗漏ID、逐行重排 | 合同拒绝且原子性成立 |
| 直接入口 | 绕Worker调REST/RPC/视图/辅助函数 | RLS/EXECUTE仍安全 |
| 文件 | 改桶/路径/编码、list/copy/move/upsert/sign | 无跨站操作，无任意签名 |
| 建站 | 同账号双创建、抢同域名、保留词/大小写 | 至多一站/一映射，无孤儿 |
| 保存 | 双窗口同revision、同键重放/异载荷 | CAS及幂等，无静默覆盖 |
| 并发 | 跨模块保存、保存与发布、撤销与请求 | 锁序/一致版本，撤销语义明确 |
| 发布 | 跨站snapshot/asset、直接改pointer | 不错误公开 |
| 取消发布 | publish→unpublish→republish旧snapshot | 状态行不删，revision递增、不归零 |
| no-op | 重放、再次取消、同snapshot重复publish | 不重复revision/成功副作用 |
| 缓存 | 同路径A/B、未知Host、旧revision命中、purge失败 | 不串站、不绕撤回、不serve stale |
| 历史 | 猜旧snapshot ID、恢复后匿名读 | 不泄漏、不自动发布 |
| 故障 | 上传成功DB失败、提交后断网、签发响应丢失 | 保留UNKNOWN、查原operation |
| 清理 | 租约失效、正在引用的asset、重试 | 不删有效资源 |
| 未来HR/AI | 未同意/撤回、跨组织/站点、提示越权 | S3默认不开放 |

## 迁移/回放/回退规格

每个隔离迁移增量测试，第四批再做空库完整回放、批准基线升级、对象/策略差异清单。
不从旧CMS baseline整套重放生产权限；不把旧fixture身份或DR资源当新平台。
发布代码/数据库双向兼容矩阵；失败/部分应用的停止点和前向修复单独批准。
外部Auth真实撤销时效、云端Storage/CDN行为不能由纯mock证明；环境差异/未获许可项记NOT TESTED。

## 证据和Gate

每用例记录固定SHA、迁移摘要、工具版本、目标、角色、预期、状态码、返回形状和最终副作用；脱敏。
RLS拒绝可能为0行，必须检查数据和状态，不能只看HTTP。
P0：跨租户读写、未授权公开、文件泄漏、Recovery升级、撤回绕过，任何一项失败不得放行。
FAIL/UNKNOWN/SKIPPED不可改PASS；普通JWT测试与service_role准备步骤分开。
独立审查在S3.9另行安排，不由当前文档准备启动agent或授予真实操作许可。
