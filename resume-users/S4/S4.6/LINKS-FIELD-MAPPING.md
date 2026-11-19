# 公开链接与展示字段

| 旧字段 | 编辑域 | 本地预览位置 |
| --- | --- | --- |
| `shared.email` | 公开链接，显式填写，两种内容语言共享 | 联系区的邮箱地址，校验后按纯文字显示 |
| `shared.emailLabel` | 公开链接，共享 | 联系区邮箱标签。首页邮件入口文字由 Profile 的 `emailActionLabel` 提供 |
| `shared.github/githubLabel` | 公开链接，共享 | Profile 区的 GitHub 按钮文字与校验后的地址 |
| `shared.linkedInDisplayName` | 公开链接，共享 | 联系区的 LinkedIn 公开显示名 |
| `shared.linkedInLabel` | 公开链接，共享 | Profile 区的 LinkedIn 按钮文字 |
| `translations[locale].linkedInLabel/linkedInHref` | 公开链接，双语 | 联系区标签与对应地址，首页 LinkedIn 按钮也以相同语言的有效地址为显示条件 |
| `educationLabel/experienceLabel/projectHeading/skillsLabel/honorsLabel/kaggleLabel` | 网站文字，双语 | 既有栏目标题和项目链接文字 |
| `portfolioLabel` | 网站文字，双语 | Profile 区显示按钮文案及功能未开放状态 |
| `updatedAtLabel` | 网站文字，双语 | 页脚提示文字，日期待正式发布服务确认 |
| `portfolioHref`、`resumePdfFilenames` | S4.9 / S3.5 | PDF 引用、文件名、下载均延期 |

旧 CMS 在一个 LinkedIn 输入框里同步两份语言的 URL。用户在 S4.6 明确选择语言后只写该语言，可以查看两边的差异提示。空值和另一份 URL 都会保留。未来 `site_links` 适配需区分共享和语言特定的记录，明确定义空值、唯一约束、标签语义及兼容旧值。
