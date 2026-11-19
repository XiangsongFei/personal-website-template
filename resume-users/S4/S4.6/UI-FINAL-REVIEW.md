# S4.6 编辑器收尾复查

本轮围绕公开预览、字段覆盖、低边框和双语录入四项修正。公开站及旧 CMS 按同一套合成资料做了离线渲染，预览样式只加载到 Users 编辑器。正式公开站和旧 CMS 源码、S2 保护、Worker、依赖锁及 CI 工作流维持原版本。

- 公开预览直接取本地草稿，引用真实布局语义，保留独立滚动、模块定位、内容语言与八个章节。桌面画布按比例缩放，手机改为未缩放的两行导航及纵向 Hero。
- 字段审查确认现有本地合同中的可维护展示文字有对应编辑控件。GitHub、LinkedIn 和项目有效地址保留为提示文字，站点 CTA 无跳转。Status 图标采用公开站图形并带可访问名称。
- 两种语言的输入常驻，宽度切换只改变网格列。核验中调整了 320px 的可用宽度阈值，修正了公开预览导航继承全局按钮外边距的问题。
- 本地专项自审包括缩放前后、焦点、语言、条目 ID、URL 和请求边界。官方审查独立记录在 PR #47。

本地验收通过。正式 UI 冻结为 PARTIAL，线上像素核验、Required CI 和官方 Review 尚未完成。

[公开预览对照](PUBLIC-PREVIEW-PARITY.md) · [逐字段清单](PREVIEW-FIELD-COVERAGE.md) · [横线](INLINE-INPUT-DESIGN.md) · [双语](ADAPTIVE-BILINGUAL-LAYOUT.md) · [测试与截图](UI-FINAL-TESTING.md)
