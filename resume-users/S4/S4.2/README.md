# S4.2 我的站点与首次建站引导

日期：2026-11-19（Asia/Shanghai）。基线为 S4.1 `e95e9616c0dddb25f69a46a82b123ad4edc43f48`。本阶段只有本地 UI、状态模型和应用内端口合同，没有接入真实业务服务。

## 已实现

- `/dashboard/website` 独立页面；使用原 Dashboard 子路径的 S2 服务端保护和私有响应头。
- 复用 UI Design V1 的 220px 侧栏、导航分组、Header、语言切换及移动导航；Overview 内容与全部视觉 Token 保留，只为“我的网站”增加链接和当前项。
- 加载、可信确认无站点、已有站点、权限拒绝、资格撤销、服务不可用六类 ViewModel；正式构建默认“站点服务尚未接入”，不推测账户有没有网站。
- 三步引导：名称/Slug、内容语言/初始模板意向、检查意向/隐私提示。界面与内容语言独立。输入只在当前页面内存中，关闭/离开/刷新清空；创建按钮始终禁用。
- 本地 Slug 格式及保留名称校验；没有可用性查询、预留、数据库写入或公开地址。

## 修改清单

| 文件（相对仓库根） | 作用 |
| --- | --- |
| `example-cv-users/app/_components/dashboard.tsx` | 提取同文件内 DashboardShell，保留原 Overview 内容，新增站点导航 |
| `example-cv-users/app/_components/website-workspace.tsx` | 六类状态、三步引导、双语、键盘与内存输入 |
| `example-cv-users/app/dashboard/website/page.tsx` | 现有服务端 ctx.user 分支和关闭的读取入口 |
| `example-cv-users/app/dashboard/website/loading.tsx` | 同样检查 ctx.user 的加载边界 |
| `example-cv-users/app/website.css` | 仅站点组件类名的局部样式，读取既有 Dashboard Token |
| `example-cv-users/lib/site/model.ts` | 类型、白名单投影、状态校验、容量限制和未实现的创建端口类型 |
| `example-cv-users/lib/site/server.ts` | 正式默认关闭；未来读取适配器的校验与错误收敛 |
| `example-cv-users/tests/site-model.test.mjs` | 8 项模型/适配合同测试 |
| `example-cv-users/tests/website.test.mjs` | 7 项真实 Worker 路由/身份/隔离测试 |
| `example-cv-users/tests/dashboard.test.mjs` | 原链接白名单增加新页面，其余既有验证保留 |
| `example-cv-users/tests/site-ui-qa/*` | 四个纯本地组件验收入口文件，不被正式路由或构建导入 |

登录、注册、邮箱验证、忘记/重置密码、账户中心和修改密码的源码/样式/交互均未改。Root Layout、共享 AccountShell、UiLocaleProvider、Dashboard CSS、S2/API/Session/Cookie、Worker、RecoveryState、依赖和锁文件均未改。旧 CMS、S3 和生产配置未改。

## 记录

- [CONTRACT.md](CONTRACT.md)：状态、可信读取边界、site_id、单站点限制、未来创建接口。
- [TESTING.md](TESTING.md)：自动化回归、真实浏览器及 S4.1/S2 回归。
- [REVIEW-AND-DEPENDENCIES.md](REVIEW-AND-DEPENDENCIES.md)：专项自审、真实服务依赖、审查与 CI 限制。
- [REPOSITORY.md](REPOSITORY.md)：工作区保护、Git 基线及依赖 PR。
- [evidence/](evidence/)：原始浏览器截图、摘要与哈希；合成状态均有明显标记。

本地交付不表示真实创建、读取、保存、Storage、发布或 AI 验收。S3.5 HOLD、S3.6 真实业务未验收、PR #40 历史安全阻断、#41/#42 未合并及官方审查未完成的结论均保留。不自动调整合并基线，不合并或部署，不进入 S4.3。
