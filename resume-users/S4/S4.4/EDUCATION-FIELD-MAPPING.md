# Education 字段映射

参考旧 CMS `resume-admin/src/App.tsx` 的 Education、分类和 RepeatableSection，`model.ts` 的 EducationItem、`AdaptivePairedField.tsx`，以及旧预览和 Education CRUD/预览测试。S4.4 沿用 S4.3 的内容语言切换和字段自适应排布。

| 旧 CMS 语义 | S4.4 本地模型 | S3.2 合同设计 |
| --- | --- | --- |
| 记录 ID / position | `clientId` / `position` | 独立的服务端条目 ID、同站点顺序 |
| entryType | `entryType`，standard 或 summerSchool | education_entries.entry_type |
| category | `category`，五种分类或 null | education_entries.education_category |
| persistedCategory | 仅保留来源事实，新记录为 null | 未来由可信读取提供，无独立 SQL 列 |
| title / program | `translations[locale].title/program` | education_translations.title/program |
| period / grade | `translations[locale].period/grade` | 两个独立文本列，按语言存放 |
| courseTitle / courseDescription | `translations[locale].courseTitle/courseDescription` | 可空 course_title/course_description |
| customCategoryLabel | `translations[locale].customCategoryLabel` | 可空 custom_category_label |

五类为 undergraduate、graduate、doctoral、summerSchool、custom。旧标准条目 category 为 null 时显示未分类，旧暑期条目可按其 entryType 显示暑期分类，原值不回填。显式选择才修改本地 category 和 entryType。旧 CMS 的四组中英文预设标题作为缺少显式标题时的展示值，切换分类后重算。显式空串和自定义标题保留，用户输入恰好等于预设名时同样保留。Custom 使用本语言类别名称。

暑期课程和自定义类别专属值在不适用分类下隐藏，切回后仍可编辑。双语分别保存，显示时不借用另一语言的输入。此隐藏值保留是本地行为。未来写入前须明确不适用字段、缺失翻译、null 和空串的规范化，校验后台组合约束与聚合版本。

S3.2 提供关系和字段设计。S3.6 离线候选只覆盖 Introduction 文本聚合，当前 Education 尚无获准的读取或写入协议。临时身份、只读来源值和预设展示值不能直接作为服务端请求体。
