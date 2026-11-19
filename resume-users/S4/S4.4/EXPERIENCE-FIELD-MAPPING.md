# Experience 字段映射

| 旧 CMS ExperienceItem | S4.4 本地模型 | S3.2 合同设计 |
| --- | --- | --- |
| id / position | `clientId` / `position` | experience_entries 的正式 ID 与站点内顺序 |
| organization | `translations[locale].organization` | experience_translations.organization |
| title | `translations[locale].title` | experience_translations.title |
| period | `translations[locale].period` | experience_translations.period |
| description | `translations[locale].description` | experience_translations.description |
| 可空 location | `translations[locale].location` | experience_translations.location |

公司或组织、角色、时间范围、描述、地点均为独立双语字段。工作和实习通过职位及描述表达，保留原有 period 文本语义。未引入雇佣类型、start_date 或 end_date 字段。描述保持用户换行，以纯文本投影到预览。空串、可空地点与完全缺失的翻译行在本地模型中有不同表达。

本地字段长度约束只用于 UI。S3.2 设计记录了表结构、站点归属和顺序，S3.6 当前离线写入候选未覆盖 Experience。未来适配须使用可信条目 ID、site_id、当前资格、版本条件和正式投影，不可把本地临时记录或旧 CMS API 当成获准服务。
