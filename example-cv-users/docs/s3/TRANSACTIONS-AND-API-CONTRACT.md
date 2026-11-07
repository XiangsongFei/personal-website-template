# 事务、API、幂等与公开撤回

状态：INFERRED / REVIEWED DESIGN；所有新API、事务和SQL均NOT TESTED。下列是合同，不是可执行Migration。

## API与S4 DTO

同源Worker候选路径/api/sites/{site_id}/…，不接管旧/api/admin/v1。
读取返回schema_version、聚合内容、section_revision、draft_revision、支持语言和最小capabilities。
共享字段+translations、稳定parent ID、methods.zh/en适配旧EditorSections；UI不直接依赖SQL命名。
保存请求含site_id/section/schema_version/expected_revision/request_id/aggregate，不接受actor/owner权限声明。
新记录使用显式临时ID并返回正式映射；未知缺失字段不能当删除。
响应返回规范化内容、新版本、persisted=true；AI建议未来返回persisted=false，不共用保存入口。
401=无有效身份，403/统一隐藏结果=无权，409=版本或幂等冲突，输入错误需明确；错误不泄漏他人资源存在性。
数据库拒绝可能为0行/空集合，服务端不能将它误判为成功。

| RPC候选 | 职责 |
|---|---|
| get_my_site/read_section | 最小本站读取 |
| create_site/update_site_settings/save_section | 建站/设置/模块聚合写 |
| read_operation | 当前actor本站指定请求结果 |
| read_audit_page/read_revision_page | 同站安全分页 |
| prepare_upload/complete_upload/bind_document/remove_asset_reference | 目的限定文件操作 |
| preview_restore/apply_restore | 预览→确认→新草稿 |
| publish_site/unpublish_site/read_publication | 独立发布/撤回/公开投影 |
| issue/renew/revoke_business_grant | 仅可信证明、非任意UID调用 |

## 建站原子事务

验证普通业务资格→锁user_security_state→确认epoch/建站名额→校验域名规范化/保留词→幂等→
创建sites/owner镜像/locales/settings/section_state/初始草稿基线/publication状态→审计/结果→提交。
初始unpublished、snapshot=NULL、publication_revision=0；注册不自动发布。
同账号并发至多一站，同域名并发仅一方成功；唯一冲突可分类，但不让未知状态重复建站。
全部失败回滚，无孤儿membership/domain。此阶段不调用DNS、创建桶或发布公开域名。

## 保存与并发

锁序统一：用户安全状态（若需要）→site→section/operation；避免不同命令倒序死锁。
资格校验后先识别已成功相同幂等请求，返回原结果；不因其原expected_revision过期而误报冲突。
新请求比较expected_revision，不符返回409并保留用户表单，不能静默覆盖或自动换ID。
一次事务修改shared、双语、嵌套记录、删除和排序；临时排序冲突通过审查的延迟约束/安全重排解决。
有效变更递增section_revision和draft_revision，写不可变私有revision、成功审计和operation结果。
无变化不增加内容版本；同请求重放不产生第二审计成功/第二份内容。
updated_at仅用于展示，不代替CAS。首版site短锁+模块级expected_revision，跨模块不无谓冲突但全站版本串行。

## 幂等与UNKNOWN

唯一作用域(site,actor,operation,request_id)；摘要绑定schema和规范化完整载荷，排除不稳定展示字段。
同键同摘要返回已完成原结果，同键异摘要拒绝；不能跨actor/site复用授权。
网络超时可能发生在提交后。先查原operation，保持相同request_id/载荷；查询无记录也不立刻证明未执行。
pending/锁竞争/过期分别分类；不默认自动重试不可逆外部动作，不把UNKNOWN写成失败后新建请求。
重复处理过期规则、结果保留期和并发唯一冲突须隔离验证；不能靠前端禁用按钮证明一次执行。

## 文件边界

私有桶，不可变键site_id/asset_id/object_version；路径只定位，不证明权限。
prepare校验site/actor/session/purpose/MIME/大小/摘要，生成限定期限intent。
上传不等于ready；complete核对对象和登记，再允许绑定草稿。
对象Storage与数据库不是同一事务：失败候选进入待清理，不能虚构跨系统原子性。
cleanup需租约和最终引用检查，不能删除当前草稿/快照仍用资源；替换不覆盖原键。
签名URL先重授权、短期限；下载后副本不可撤回。公开附件只来自当前snapshot_assets。
Storage list/read/upload/update/upsert/copy/move/delete/sign各自测试，不能仅检查upload。

## publication状态机与事务outbox

| 前态/动作 | 后态 | revision |
|---|---|---|
| 建站 | unpublished / NULL | 0 |
| 首次publish snapshot S | published / S | +1 |
| publish新snapshot T | published / T | +1 |
| unpublish | unpublished / NULL，保留状态行 | +1 |
| 显式重新publish旧S | published / S | +1 |
| 同幂等请求重放 | 原结果 | 不变 |
| 已unpublished再次unpublish | no-op | 不变 |
| 已published再次指向同snapshot | no-op | 不变 |

每存续site恰好一行state；任何公开状态变化不能重建行重置计数。snapshot_id为空只表示未公开，不表示历史不存在。
publish检查Owner、业务资格、expected_publication_revision及expected_draft_revision，验证全站白名单和ready附件。
准备不可见资源后，在数据库事务内创建不可变快照、snapshot_assets、切pointer、revision、审计、幂等结果、publication_outbox。
unpublish同事务清当前pointer并递增、记录事件。外部purge由outbox执行，失败可重试且暴露状态，不倒写成功。
不要把“调用过purge”当作撤回证明。

## 公开读和缓存

规范化Host→当前enabled domain→合法site→当前publication state→快照及附件清单。
公开请求必须检查当前门禁，包含缓存命中；门禁UNKNOWN不serve stale。
内容缓存key含可信site、publication_revision、snapshot、locale；改域名、取消发布也需失效。
CDN直接绕过门禁的静态URL不支持严格即时撤回；应采用受控入口或明确可接受TTL，具体方案待批准。
在途响应、已签URL、离线副本边界需披露；不能承诺收回用户已经下载的数据。

## 历史、恢复及发布回退

历史Owner读与匿名公开读分离；取消发布后原快照不再通过公共ID入口访问。
restore preview绑定source revision、当前摘要/版本；apply重新鉴权和CAS，创建新草稿/审计，不倒退版本不自动发布。
发布回退为显式重新指向旧合法快照的新公开状态，publication_revision继续增加。
数据库迁移优先前向修复；Worker回旧Version不回退Supabase/KV内容，不能自动Rollback掩盖UNKNOWN。

## S4交互约束

未保存预览仅使用本地表单且标明未持久化；已保存草稿预览受保护/no-store；正式预览读取快照。
保存成功只patch目标模块；迟到响应不得覆盖切换账号/site后的状态。
取消编辑是本地操作；候选上传要有独立清理合同。
409保留表单供人工处理；不自动合并并发布。AI采用建议仅进入未保存表单。
