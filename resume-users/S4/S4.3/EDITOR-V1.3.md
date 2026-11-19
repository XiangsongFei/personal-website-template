# Editor Design V1.3 实施

原 DashboardShell 渲染 Sidebar、Header、移动导航和页脚。S4.3 只接通现有 Profile 与 Introduction 菜单，按所在模块设置 `aria-current` 与原位置导航文案。可用性提示随新增本地编辑更新。四组导航、品牌、图标、Header 内界面语言与账户入口使用原组件和样式。主题保持原白色、灰色及鼠尾草绿。编辑器宽度、排版和滚动区域局限于编辑页。两栏用一条细线和间距分隔。

## 编辑器结构

| 代码 | 职责 |
| --- | --- |
| `app/_components/dashboard.tsx` | 原导航接线、当前模块及原布局 |
| `app/dashboard/editor/page.tsx` | 读取现有服务端上下文，仅在已验证身份下渲染编辑器 |
| `app/_components/resume-editor.tsx` | 工作区、内容语言及视图控制、共用字段和编辑区底部操作 |
| `app/_components/full-site-preview.tsx` | 纯展示的网站全结构以及预览内部定位 |
| `app/editor.css` | 响应式布局、表单、低强调 AI 入口、全站展示 |
| `lib/editor/draft.ts` | 本地模型、字段规格、脏状态、单模块取消及文本校验 |
| `tests/editor.test.mjs` 等 | 模型、会话、闭态与 Dashboard 链接回归 |

模块选择使用同一文档的 hash，跨模块保留两份本地内容。界面语言沿用 Header，内容语言由编辑器单独管理。窄屏视图使用 CSS 隐藏另一面板，两者持续挂载。仅支持编辑与完整预览，排序留给后续有列表项的模块。

## Profile 字段依据

参考旧 CMS `resume-admin/src/data/profileAggregate.ts` 和 `resume-admin/src/model.ts` 的字段语义，建立页面内字段。没有新数据库字段。

| 内容 | 本地字段 | 对应现有语义 |
| --- | --- | --- |
| 基础个人资料 | `translations.{zh,en}.name` | 中英文显示名 |
| 网站展示 | `navAboutLabel`、`emailActionLabel`、`graduationLabel` | 顶部导航、邮件入口文案、毕业时间标签 |
| 头像及联系区文案 | `avatarLabel`、`contactFocusHeading`、`contactStatusHeading` | 替代说明、职业方向区和联系状态区标题 |
| 共享信息 | `graduationValue`、`avatarInitials`、`footerName`、`copyright` | 跨语言共用的日期、头像缩写及页脚 |
| 职业定位正文 | `introduction.{zh,en}` | 当前在个人介绍编辑，沿用旧公开模板「关于」附近的定位 |
| 头像文件 | 头像占位和缩写 | S3.5 HOLD，`photo_url` 未引入本地输入或读取 |

Profile 本地表单字段长度属于界面约束。真实字段写入语义、授权和聚合映射需要独立验收。邮件入口标签只作为字面文本展示。

## Introduction 和草稿

中英独立纯文本，保留换行，每种语言上限 20,000 个 UTF-16 单元，检测 NUL 与孤立代理项。S3.6 候选合同的真实 aggregate 包含 `schema_version`、条目 ID/位置及翻译，显式空串与缺少翻译不同。当前单段文本的状态是本地投影。未来桥接须保留条目身份和已有翻译语义，不得按当前表单状态覆盖未读取的条目。

操作栏根据两模块是否存在本地修改更新，取消只影响当前模块。浏览器 `beforeunload` 在存在修改时提示，Chromium 的提示需先有用户交互。保存草稿按钮禁用。已有 UI 语言偏好继续由原组件保存，内容或草稿未写到浏览器持久存储。

## AI 预留

AI 优化及 AI 生成位于 Introduction 输入旁，用轻量图标和文字，按钮禁用并给出原因。未来建议在编辑区内按需展开，以留白、文字层级和细线区分原文与建议。用户显式采纳后进入本地未保存状态，完整网站预览继续显示。AI 请求、直接保存、自动发布、访客 AI 和 HR AI 均未接入。
