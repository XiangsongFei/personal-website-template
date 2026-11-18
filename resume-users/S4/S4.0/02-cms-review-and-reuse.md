# 旧 CMS 只读审查与复用清单

## 审查对象与证据层级

审查固定源码 `e137f553469e9ace26bbfcd8a0359e4e1160ad9d` 中的 `resume-admin/src/`、相关测试源码、共享预览模型及 Users 现有会话链。下文路径均相对该 Git 根，可通过[固定树](https://github.com/XiangsongFei/personal-website-template/tree/e137f553469e9ace26bbfcd8a0359e4e1160ad9d)核查。原打开工作区有未提交的 CMS 扩展，只盘点、不作为可交付基线；例如未跟踪的 `AuditSummaryPanel.tsx`、`AuditTargetScope.tsx`、`activityLogCsv.ts` 不纳入复用承诺。

**本轮属于源码、组件及交互合同的只读审查。没有登录生产 CMS、读取正式内容、运行旧 CMS 或执行新的浏览器视觉/交互测试。** 响应式布局和交互从源码及既有测试定义确认，不能写成本轮浏览器验收通过；提取时仍须真实浏览器验证。

## 七类界面与交互

| 对象 | 已读证据 | 实际界面/行为 | Users 最小适配 |
| --- | --- | --- | --- |
| Dashboard | `App.tsx:1358` 的 `Overview`；`overviewFormat.ts` | 当前简历、中文/EN、北京时间更新时间；九类内容入口；生产摘要优先、fixture 有回退分支 | 保留卡片层次和入口。显示服务端可信站点/能力；未配置不回退到旧站点、fixture 姓名或假成功时间 |
| 导航 | `App.tsx:49`、`:4009` 起的 sidebar 和 Routes | Overview；基础资料；经历/项目等；Site & Links；Activity Log/Version History；含窄屏导航和语言切换 | 复用分组及可访问标签，改为 Users 框架路由；账户入口继续指向 S2；不继承管理员 System State、Owner/QA 切换 |
| 双语编辑 | `App.tsx:478/520`，`model.ts`，`bilingualReview.ts`，`AdaptivePairedField.tsx`，`AdaptiveMethodsGrid.tsx` | shared 与 zh/en 分离；配对输入、自动堆叠、另一语言复核提醒；Projects methods 各语言独立 | ViewModel 保留字段语义；UI 语言和内容语言分开。改中文不自动翻译/覆盖英文；复核标记不是已保存或内容正确证明 |
| 内容排序 | `App.tsx:845` 的 `RepeatableList`、`:84` 的 `renumber` | 编辑/收起、添加、确认删除、上下移动；首尾禁用；本地重排后重编号；新项使用 local 临时 ID | 首版保留键盘可用上下按钮，不新增拖拽库。ID 与 position 分离；临时 ID 由适配层处理，服务端以本站完整聚合原子提交、CAS 校验，不能复制逐行 DML |
| 预览 | `App.tsx:1398`，`preview/ResumePreviewPanel.tsx`，`preview/resumeContentMapper.ts:120/153` | edit/split/preview；宽屏 1280 起、其他宽度单栏适配；基线+本地草稿生成完整双语预览，确认内容比较、位置恢复 | 先提取纯 mapper/展示组件。明确本地未保存预览、受保护已保存草稿、公开发布快照三种来源。预览不代表保存或公开；URL/图片字段需新白名单及资产授权适配 |
| Activity Log | `ActivityLogPage.tsx:321`，`data/resumeRepository.ts:2308` 起 | 每页25；事件类型、栏目、操作、执行者、北京时间日期、关键词；加载/错误/空态、更多；先确认旧目标授权；成功/拒绝事件呈现不同 | 复用分页/过滤/事件卡片思想；改为本站安全审计 DTO，隐藏跨账户执行者、内部失败阶段/原始 payload。旧过滤权限和 RPC 不复用；本轮不新增 CSV |
| Version History | `VersionHistoryPage.tsx`，`data/versionHistoryPresenter.ts`、`restorePreviewPresenter.ts` | 每页25、栏目筛选、字段和集合差异、恢复前预览/确认弹窗；处理 stale preview、未保存、保存中、结果不明及图片不可用 | 先只读历史，再条件开放“恢复为新草稿”。历史资源重新授权，不能沿用旧签名 URL；恢复不得覆盖公开快照或自动发布；结果不明保留原请求核对 |

## 可复用粒度

| 级别 | 组件/交互 | 提取条件 |
| --- | --- | --- |
| 优先提取 | 自适应双语排版、字段控件、上下排序、空态/错误/加载、时间格式、按钮和卡片样式 | 变成纯 props/callback，样式限定作用域；移除对 EditorContext、旧 auth/repository 的运行依赖；使用 Users 语言提供者；补键盘、焦点和移动端验证 |
| 适配后复用 | `EditorSections`/稳定父 ID/嵌套 methods、preview mapper、字段差异 presenter | 新 DTO 明确 shared/translations、版本、本站资源和字段写入归属；不将数据库列名直接绑定组件 |
| 仅借鉴状态机 | SectionForm、useLocalDraft、pending save、恢复弹窗、route snapshot、滚动恢复 | `SectionForm` 含旧 productionSave 与部分保存语义，不能整件搬入；先实现内存草稿及明确 CAS/UNKNOWN；默认不在 Web Storage 持久化私有草稿 |
| 暂不复用 | 巨型 App/EditorContext、全局 CSS、AuthGate、ResumeLoader、Repository、Worker 及签名/文件服务 | 它们构成旧系统整体运行链，移植会带入管理员权限、生产文案、固定目标和旧网络路径 |

缓存/草稿按可信会话代次、UID、site、schema 版本隔离；登出、身份变化、权限撤销时清理并拒绝迟到响应。只可把非敏感 UI 偏好另存；旧 `authSessionKey` 可能含 token，不能当新缓存键。保存超时不可仅清理浏览器状态后重新发起，必须核对同一原请求。

## 明确禁止复用

- **API/数据访问**：`/api/admin/v1/*`，`is_resume_admin`、`activity_log_authorized_targets`、`load_admin_*`、`save_resume_*`、`read_activity_log_events*`、`read_version_history_v1` 及旧 restore RPC；浏览器 `.from('resume_*')` 直接 DML。Repository 同时含直接 DML、RPC 和 Worker 分支，不能把选其中一条当新租户授权。
- **身份/权限**：`cms_admins`、旧 `owner/qa`、固定 `example-cv`/`example-cv-qa-activity-log`、Test 账号/目标、capabilities/write_modes/维护开关、旧 JWT 或解析 sub 的方法。新 site Owner 是新身份域内的本站归属，不能由同邮箱、固定站点或前端 role 推导；未知角色默认无能力。
- **Supabase/Secret**：旧 `VITE_SUPABASE_URL`、publishable key 对应项目、浏览器 auth storage、service role、Vault/HMAC、RPC owner/grant、RLS/SECURITY DEFINER、旧生产连接/证书、S3 孤立测试绑定均不得照搬。公开 key 不是本站授权；用户输入与 user_metadata 不作为权限根。本轮未读取任何 Secret 值或连接任何 Supabase 项目。
- **Storage/公开内容**：旧 `profile-images`、`resume-files`、公开 URL/永久路径、历史签名机制、生产桶对象及 `resume_sites.is_published` 的内容直读方案。新资产须明确 site/actor/purpose/引用，发布读取不可变安全快照。
- **源码和环境**：不把原工作区未提交文件、S3 `.runtime` 原始回执/私钥/测试账户导入新应用或公开 Git；不复制旧部署、DNS、Secret 和自动构建配置。

## 避免继承的交互误导

本地保存分支或 sessionStorage 存储成功不能显示“已保存到服务器”；取消仅回到已确认基线，不撤回数据库提交；同一个栏目标题由单一字段归属管理，Links/Files/正文不能互相覆盖。任何权限/能力未知都显示不可用状态，不推断“未建站”“没有历史”或“保存成功”。
