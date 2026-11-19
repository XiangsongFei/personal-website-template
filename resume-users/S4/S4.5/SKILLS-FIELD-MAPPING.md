# Skills 字段映射

旧 CMS `SkillItem` 使用 `translations.zh/en.title` 与 `items`，数据合同将后者放入 `skill_translations.items_text`。S4.5 继续保存双语标题和原始多行文本，以及与位置分离的本地记录 ID。

| 预设键 | 中文 | English |
| --- | --- | --- |
| `programming` | 编程 | Programming |
| `dataSystems` | 数据与系统 | Data & Systems |
| `analytics` | 分析 | Analytics |
| `tools` | 工具 | Tools |
| `languages` | 语言 | Languages |
| `custom` | 自定义 | Custom |

无显式本地分类时，只有两个标题同时精确匹配同一预设才推导该类别。单语言缺失、空标题、异配标题和大小写或空格差异保留为 Custom。显式选择记录在草稿的 `category`，只决定标题在表单和预览里的投射。切回 Custom 后两个原始标题均可恢复和编辑。标点、Unicode 和换行作为文本保留。类别键是表单状态，未来 API 应依据已验收的双语数据合同确定如何落盘。
