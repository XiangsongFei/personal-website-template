# CMS Reuse Matrix

旧事实来自固定main代码和本地baseline/migrations；baseline不是最新生产数据库证明。
新对象和权限均INFERRED；新实现NOT TESTED。保留结构不等于复制SQL或权限。
[旧模型](https://github.com/XiangsongFei/personal-website-template/blob/438800cc8c25a2da2a7a14a8d9fdaf414fa414f5/resume-admin/src/model.ts)
与[Repository](https://github.com/XiangsongFei/personal-website-template/blob/438800cc8c25a2da2a7a14a8d9fdaf414fa414f5/resume-admin/src/data/resumeRepository.ts)。

| 模块 | 旧表/字段 | 旧操作/API | 新建议 | 新权限 | 复用判断 |
|---|---|---|---|---|---|
| 站点 | resume_sites/id,site_key,is_published | 固定目标读取 | sites/domains/publications | UID→site，域名独立 | 重设计归属/公开 |
| Profile | resume_profile及translations，photo_url/name/labels | profile/save、旧DML | profiles/translations，photo_asset_id | 同站asset FK，聚合写 | 保留共享+双语思想 |
| Introduction | paragraphs/translations，id/position/text | introduction/save、旧RPC | intro_entries/translations | 同站稳定ID/版本 | 租户化适配 |
| Education | entries/translations，entry_type/category/custom label/course | education/section-text save | education及section translations | 同站FK/category组合校验 | 保留分类/双语 |
| Experience | entries/translations，organization/title/period/location | experience/save、旧CRUD | experience及translations | Owner/聚合版本 | 租户化适配 |
| Projects | entries/translations，title/subtitle/description/href | projects/save→save_resume_projects_v1 | projects及translations | 同站资源/版本 | 保留聚合，重授权 |
| 项目方法 | resume_project_methods，project/locale/position/value | Projects嵌套保存 | project_methods | site+project+locale FK | 保留嵌套排序 |
| Skills | groups/translations，title/items文本 | skills/save | skill_groups/translations | 本站聚合权限 | 保留文本；HR另建投影 |
| Awards | entries/translations，name/year | awards/save | award_entries/translations | 双语原子保存 | 租户化适配 |
| Contact | focus/status及translations，status_type/title/detail | contact/save | contact settings/focus/status | 私有草稿/显式公开 | 保留结构 |
| Site text | resume_locale_content，标题/availability/links | section titles save | section/contact translations | 字段唯一写入归属 | 拆分适配 |
| Navigation | items/translations，position/label | website-links save | navigation及translations | section白名单/同站排序 | 保留思想 |
| Links | resume_public_links与locale href | website-links save | site_links | URL类型/公开白名单 | Auth邮箱不自动同步 |
| 头像 | photo_url/profile-images | 上传删除、历史图片读取 | site_assets+profile FK | 私有原件/历史重授权 | 重设计引用 |
| PDF | portfolio_href/resume-files/filename metadata | files upload/save/cleanup/restore | site_documents+assets | 同站/locale/kind | 不复制永久URL |
| 文件事务 | upload/cleanup intents，digest/status/lease | prepare/complete/cleanup RPC | asset intents/jobs | actor/site/purpose/引用 | 保留状态机，重写授权 |
| 排序/ID | UUID、position、排序唯一约束 | 聚合/逐行update | 稳定ID及原子重排 | site作用域检查 | 不复制前端逐行重排 |
| 保存 | canonical payload/idempotency | Worker签名→RPC | operation_requests/save_section | 可信actor/同键同摘要 | 保留思想，重设计角色 |
| 并发 | 行锁/digest/updated_at | RPC串行，恢复expected digest | section/site revision | expected_revision CAS | 必须增强 |
| 活动日志 | events/system_events，changes/payload_version | 分页/过滤RPC、CSV展示 | audit安全投影 | 本站读、禁止伪造/修改 | 复用UI思想 |
| 历史/恢复 | restore links/expected_current_digest | preview/apply | revisions/restore operations | 同站历史/版本检查 | 恢复只写新草稿 |
| 编辑/预览 | EditorSections、preview mapper | edit/split/preview、取消/保存 | API DTO→兼容ViewModel | 本人草稿、no-store | 优先借鉴交互 |
| 会话缓存 | sessionKey+site+section、route snapshot | 分区加载/迟到响应拒绝 | opaque epoch+site+schema | 登出失效 | 不依赖浏览器Token |
| 管理/QA/维护 | cms_admins、固定site_key、capabilities、write_modes | is_resume_admin/target/维护RPC | 新成员与独立运营合同 | 默认无管理能力 | 禁止复制授权/函数 |

## 审计发现与精确边界

- 旧baseline已有多处(entry_id,resume_id)复合FK、翻译唯一键及(resume_id,position)唯一排序；新平台应保留并完整覆盖，不假定旧模型全无约束。
- 已读Projects事务有site行锁、幂等摘要、双语和方法同事务、审计；其已读保存签名未接受客户端expected_revision，因此不单靠锁/幂等证明不会覆盖陈旧编辑。其他模块不能一概而论。
- Repository存在直接DML、旧RPC及Worker聚合路径；新平台统一命令入口，不照搬历史分支。
- tokenActor只解析JWT形状/sub不是验证器；S3复用Users服务端验证链，不复制该解析器作信任根。
- 旧公开策略依据is_published直接读取内容表；不是S3不可变发布快照。
- 旧owner/qa、SECURITY DEFINER实现、生产行、桶对象、Secret和DR权限绝不能原样迁入。
- 旧CMS当前实际启用哪些路径、数据库后续迁移是否全部应用，UNKNOWN。

## S4兼容

保留shared+translations、稳定父ID、methods.zh/en、position、分类与双语字段提醒的ViewModel。
API适配新表，UI不直接绑定SQL表名。保存返回规范化聚合和revision；冲突保留本地表单。
单独维护栏目标题、文件绑定与职业内容的写入归属，避免Links/Files/locale多个页面覆盖同字段。
本地未保存预览、受保护已保存草稿、公开快照明确区分；取消编辑不等于数据库回退。
会话缓存切换UID/site时清空，拒绝迟到请求；sessionStorage持久私有草稿需另审隐私和登出清理。
