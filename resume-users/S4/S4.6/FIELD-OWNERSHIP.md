# S4.6 字段唯一归属

实施前只读核对旧 CMS 的 `model.ts`、`App.tsx` Contact / Links / SectionText、`ResumePreviewPanel.tsx`、`resumeContentMapper.ts`、Contact 和 Links 的 route-first 测试，以及 Users S3.2 冻结模型与 S4.3–S4.5 草稿及预览合同。

| 业务域 | 唯一编辑位置 | 字段及来源 |
| --- | --- | --- |
| Profile | 个人资料 | 保留 `navAboutLabel`、`emailActionLabel`、`contactFocusHeading`、`contactStatusHeading`、`footerName`、`copyright`。Contact 与预览读取这些字段。 |
| Contact | 联系栏 | `contactLabel`、`availability` 和独立 Focus / Status 两个列表。对应 S3.2 的 contact 设置、翻译与两个独立有序表。 |
| Links | 公开链接 | 旧 Links 共享邮箱、GitHub、按钮文字、LinkedIn 显示名与按钮文字。LinkedIn 的联系区标签和 URL 继续按语言分别存储。对应未来 `site_links` 的共享与本地化适配。 |
| 公开网站导航 | 网站文字 | 只编辑五个固定章节的双语导航文案，映射 `navigation_translations.label`。Profile 的首页导航文案仍在原位置。 |
| 网站栏目文字 | 网站文字 | `educationLabel`、`experienceLabel`、`projectHeading`、`skillsLabel`、`honorsLabel` 及 `kaggleLabel`。旧 CMS 在各栏目编辑它们，现有 Users 模块只拥有条目字段，因此本轮在网站文字集中编辑一次。S3.2 将栏目标题从旧 locale 大表拆出。 |
| PDF 显示文字与页脚文字 | 网站文字 | `portfolioLabel` 只是 PDF 按钮文案，`updatedAtLabel` 只是页脚前缀。更新时间来自未来确认的服务端快照。 |
| PDF 引用和文件名 | 后续 S4.9 / S3.5 | `portfolioHref` 是旧 PDF 文件引用，`resumePdfFilenames` 为内部文件展示名，延期至受控文件功能。 |
| 账户邮箱 | S2 账户 | 私有身份字段。公开邮箱只接受用户明确填写的值。 |

后台导航、公开导航与栏目标题使用各自来源。Contact、Links 与网站文字通过同一编辑页进入，分别维护本地草稿和撤销范围。
