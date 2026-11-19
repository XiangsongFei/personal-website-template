# Projects 字段映射

依据旧 CMS 的 `resume-admin/src/model.ts`、`App.tsx` 中的 Projects 和 MethodFields、`AdaptiveMethodsGrid.tsx` 与 `phase5b-projects-route-first.test.tsx`，并对照 S3.2 冻结模型的 `projects`、`project_translations`、`project_methods`。

| 旧模型字段 | S4.5 本地草稿 | 预览与后续适配 |
| --- | --- | --- |
| `id` | 独立生成的 `clientId` | 草稿内稳定键。真实适配须用可信站点返回的正式记录 ID。 |
| `position` | `position` | 移动或删除后顺序连续，记录身份保持稳定。 |
| `sourceKey` | 草稿无此字段 | 未来从可信读取合同带入并保留已有来源。 |
| `translations[locale].title/subtitle/period/description` | 保留同名每语言字段 | 仅渲染当前内容语言，保留描述换行。 |
| `translations[locale].href` | 保留同名每语言原始输入 | 旧 CMS 共享输入会写入两种语言，数据层各自存储。S4.5 每次只更新选定语言。 |
| `methods.zh/en` | 同一草稿记录下两个独立有序列表 | 见 [Methods 合同](PROJECT-METHODS-CONTRACT.md)。 |

链接要求完整 HTTP 或 HTTPS URL。空值表示未填写。解析拒绝凭据、内部空白、控制字符和反斜杠，协议相对 URL 和其他协议也被拒绝。非法输入保留于表单并标记，预览只把经过校验的规范化 URL 显示为纯文字。所有项目文本作为 React 文本节点渲染。

项目描述旁保留禁用的 AI 优化/生成入口。图片和附件的依赖见 [S3 依赖](S3-DEPENDENCIES.md)。
