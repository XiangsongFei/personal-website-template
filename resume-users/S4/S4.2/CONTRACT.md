# S4.2 状态及适配合同

## 当前运行边界

正式页面先使用现有 Worker 的 S2 身份检查；失败/临时故障由原流程处理。`ctx.user` 不存在时不会调用站点读取函数或渲染私有外壳。已登录不等于具备业务 Grant。

`readCurrentSiteStatus(ctx.user.id)` 目前始终返回 `unavailable/not-connected`，没有 fetch、Supabase SDK、数据库连接、S3 candidate import 或业务凭证。重新读取按钮只重新加载受保护页面。全部 `/api/sites*` 和旧 Owner/Test 入口继续关闭。本轮没有可调用的创建端口实例或业务路由。

## 状态矩阵

| 状态 | 必须依据 | 页面行为 |
| --- | --- | --- |
| loading | 已登录后的读取尚未完成 | 只显示加载，不推测无站点，不展示旧资料 |
| empty | 受信任适配器、version=1、匹配当前服务端账户、complete=true、显式 empty、sites=[] | 确认没有网站；仅能查看引导，创建仍禁用 |
| ready | 同样的可信账户范围及完整回执；当前恰好一个合法 UUID siteId | 显示白名单站点摘要，不提供编辑/发布/公开 URL |
| denied | 可信账户范围内明确的访问拒绝 | 不展示任何站点资料，不转为 empty |
| revoked | 可信账户范围内明确的资格撤销 | 不展示任何站点资料，不允许引导创建 |
| unavailable | 未接入、异常、空/坏/不完整回执、账户范围不匹配或超出容量 | 明确无法确认站点状态，不能据此说“没有网站” |

`null`、空数组、204/404、超时、网络错误、403、空表、`{site:null}`、未验证的客户端对象都不能直接生成 empty。HTTP 状态不是这个应用内合同；未来适配器须先验证来源和当前权限，再产生明确语义回执。拒绝/撤销需返回明确状态；通用异常保持 unavailable，不显示原始上游诊断。

## 可信度与身份

`SiteReadReceipt` 是**应用内候选投影合同**，不是已部署的 HTTP API、S3 RPC schema 或权限证明。`siteViewModel()` 仅验证结构/范围并白名单投影，不能把任意 JS 对象变成可信事实。真正接入前，读取端口必须绑定当前服务端已验证会话，验证业务资格的新鲜度和 site ownership，并通过已验收的认证传输取得结果。`accountId` 由服务端上下文提供，不能来自 query/body/localStorage。

数据库权威标识 `site_id` 映射到 ViewModel 的 `siteId`；Slug 和名称是展示/输入数据，不授予权限。页面不解析 site_id、slug、state 或 fixture 查询参数，不提供可改目标站点的输入或客户端业务读取调用。未来每次服务端操作仍须重新验证会话、资格、所有权；不能用客户端 ViewModel/source 标记或已知 UUID 代替授权。

读取采用集合 `sites[]`；当前 `ACCOUNT_SITE_LIMIT=1`，ready 回执必须恰好一个站点；超出容量视为合同异常，不偷偷选择第一项。未来多站点可以延续集合结构，但须重新审批产品容量、服务端权限与选择合同。本地 UI 限制不是未来数据库唯一性/原子容量检查的替代。

## 首次建站与未来创建

`SiteCreationIntent` 只保存名称、Slug、内容语言、模板意向。当前模板 `minimal-resume` 是本地 UI 标识，不表示已部署模板或旧 CMS theme_key。Slug 格式/保留名规则参考冻结 S3 candidate 的语法；它不是可用性/占用检查。界面语言由既有 UI preference 管理，内容语言单独存于本页内存。

`SiteCreationPort.createForCurrentAccount({intent,operationId})` 只是未实现的 TypeScript 端口，既不导出实现，也不由浏览器调用。未来需服务端账户绑定、当前资格复验、原子单站点/Slug 约束、输入校验、操作 ID 与 payload 绑定、幂等及 UNKNOWN 对账；结果不明不能用新 ID 盲目重试。siteId 必须取自可信创建结果，不能由意向输入提供。

该端口不是可直接发送的请求体。现有 S3.3 candidate 线协议不含这里全部名称/模板意向字段，且未作为可调用生产 API 验收；不得直接 spread intent 到它或照搬 Owner/Test RPC。真实字段持久化、语言/模板映射、私有草稿与公开发布边界须另行确认并验收后实现。

当前三步引导全程 preventDefault；最终按钮 disabled 且无创建处理器。不会生成 siteId、成功回执、正式 Slug/URL、Grant、数据库事务或发布事件。关闭、离开、刷新销毁输入；不使用 URL、localStorage、Cookie 或数据库保存建站意向。

## 合成验收

`tests/site-ui-qa/` 是仅绑定 127.0.0.1:8796 的独立 React/Vite 组件入口；不使用 Worker/Cloudflare 插件、不读 env 文件、禁止外部业务连接。它用显式 synthetic ViewModel 展示六类状态，全部标注“合成数据”。其 state query 只属于这个测试文档，不存在于正式路由。此处截图不等于账户授权、真实读取或真实建站验收；对应安全行为单独由实际 Worker 测试及真实受保护页面的合成 S2 登录验证。
