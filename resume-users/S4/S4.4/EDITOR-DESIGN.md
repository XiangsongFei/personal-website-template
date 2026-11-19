# S4.4 编辑器与视觉设计

S4.1 的 DashboardSidebar、Header、品牌、四组导航、账户入口以及顶部界面语言继续由既有 DashboardShell 渲染。本轮只接通两条现有菜单及对应的当前项。Profile 和 Introduction 共用原页面、内容语言开关和未保存操作栏。

S4.3 的 875px 工作区断点与 45/55 分配继续适用。记录头由标题、展开与排序操作组成，记录间一条细线。字段沿用白色输入框、原字号及自适应列，狭窄时自动堆叠。预览与编辑各有滚动区，移动端单栏开关保留页面内输入。

AI 优化/生成沿用 Introduction 的轻量组件，在暑期课程描述、工作描述旁给出禁用原因。未来建议可在文字字段旁展开，按“原文、建议、说明、人工采纳、进入本地未保存输入”处理。S4.4 没有调用 AI、直接保存或自动发布。

| 文件 | 职责 |
| --- | --- |
| `example-cv-users/app/_components/dashboard.tsx` | Education/Experience 菜单接线及当前模块 |
| `example-cv-users/app/_components/resume-editor.tsx` | 模块接入、共用状态和文字动作 |
| `example-cv-users/app/_components/repeatable-editor.tsx` | 共用记录列表、确认删除、文本控件、AI 预留 |
| `example-cv-users/app/_components/{education-editor,experience-editor}.tsx` | 各字段及可见条件 |
| `example-cv-users/app/_components/full-site-preview.tsx` | 两章节渲染及独立定位 |
| `example-cv-users/app/editor.css` | 局部记录样式、定位所需尾部空间 |
| `example-cv-users/lib/editor/{draft,records}.ts` | 有序双语模型、分类、移动删除、按模块取消 |
| `example-cv-users/tests/{dashboard,editor-records}.test.mjs` | 导航白名单和模型回归 |

S4.5 可复用列表、行标识、按语言更新、纯文本字段、移动与删除确认、草稿脏状态及预览定位。各模块自行定义字段、格式和可见条件，待可信服务验收后再对接持久化。
