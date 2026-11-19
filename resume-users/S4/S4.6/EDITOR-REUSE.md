# 统一编辑器与修改范围

三个区域继续使用现有 `DashboardShell`、`ResumeEditor`、`RepeatableEditor`、`RecordField` 和 `FullSitePreview`。既有「联系与链接」是唯一的 Sidebar 入口，对应 `#contact`。内部按钮切换 `#contact`、`#links` 或 `#site-text`，地址片段保持在同一受保护路由。每个区域以独立草稿键参与未保存提醒和模块级撤销。

| 路径（相对 Users 应用） | 变更 |
| --- | --- |
| `app/_components/{contact-editor,site-links-editor,site-text-editor}.tsx` | 联系栏、链接验证与双语展示文案表单。 |
| `app/_components/{dashboard,resume-editor}.tsx` | 启用既有菜单、内部区域切换和独立草稿对接。 |
| `app/_components/full-site-preview.tsx` | Contact、公开链接、导航和站点文字投射。 |
| `app/editor.css` | 局部表单间距、错误边框与联系区排版。 |
| `lib/editor/{contact,site-links,site-text,draft,records}.ts` | 本地合同、独立撤销和 HTTP(S) 验证复用。 |
| `tests/{contact-editor,site-links-editor,site-text-editor,dashboard}.test.mjs` | 字段隔离、类型、排序、链接验证、固定导航及既有路由。 |

同一应用构建继续包含原 Dashboard、我的网站和原 S2 服务端保护。侧栏、Header、栅格和窄屏模式沿用原样式。S4.7 本地准备可复用字段归属、模块级状态和预览；正式写入需要单独的可信业务合同和验收。
