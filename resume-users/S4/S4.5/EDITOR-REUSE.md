# 编辑器复用与修改范围

三个模块作为既有 `/dashboard/editor` 的 hash 入口，继续共用 `DashboardShell`、`ResumeEditor`、`RepeatableEditor`、`RecordField` 和 `FullSitePreview`。父级条目保留稳定 ID、位置、默认展开、边界按钮、确认删除与焦点回退。中文和英文共用父身份，当前语言更新保持另一份翻译。工作区统一管理脏状态、模块级撤销和离开提醒。

| 路径 | 变更 |
| --- | --- |
| `app/_components/{projects,skills,awards}-editor.tsx` | 三个表单的字段、双语投射和 Projects 子列表。 |
| `app/_components/{dashboard,resume-editor}.tsx` | 既有菜单接通三模块，统一工作区接入草稿。 |
| `app/_components/repeatable-editor.tsx` | 共享长文本控件支持按字段隐藏 AI。 |
| `app/_components/full-site-preview.tsx` | 三章节的本地投射和进入模块后的对齐。 |
| `app/editor.css` | 方法列表、预览方法和奖项字段的局部样式。 |
| `lib/editor/{draft,records}.ts` | 本地模块注册、活动语言更新、字段类型与映射。 |
| `tests/{dashboard,project-methods,skills-awards}.test.mjs` | 导航启用以及字段、协议、父子顺序、分类和年份测试。 |

以上路径均相对于 `example-cv-users/`。侧栏样式、Header 样式、认证、Worker、依赖和 CI 配置继续来自上游。S4.6 可复用模块注册、文字字段与重复条目控制、独立内容语言、局部撤销、预览闭环及浏览器测试宽度矩阵。
