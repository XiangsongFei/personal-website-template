# 公开预览字段覆盖

字段均来自本地草稿。表内的「可编辑」指左侧现有控件。中英字段分别更新，品牌、结构和空状态由模板提供。详见 [最终测试](UI-FINAL-TESTING.md) 的受保护页面、逐模块浏览器和源码对照记录。

| 预览元素 | 本地字段 | 唯一入口与控件 | 状态与证据 |
| --- | --- | --- | --- |
| Hero 姓名 | Profile `name` | 个人资料 · 显示名称 | 可编辑，双语姓名 |
| Hero 段落 | Introduction | 个人介绍 · 长文本 | 可编辑，Hero 内保留段落 |
| 头像缩写、替代说明 | Profile `avatarInitials`、`avatarLabel` | 个人资料 · 缩写与替代说明 | 可编辑，圆形占位及可访问名称 |
| 正式头像 | 未来同站资源引用 | 后续文件能力 | 延期，尚无已验收授权读取 |
| 邮件按钮文字、毕业时间标签与值 | Profile `emailActionLabel`、`graduationLabel`、`graduationValue` | 个人资料 · 标签与共享时间 | 可编辑，Hero 按钮与毕业区 |
| 教育学校／项目、标题、日期、成绩 | Education `program/title/period/grade` | 教育记录 · 对应短输入 | 可编辑，右列日期及多项成绩 |
| 教育类别与自定义名称 | Education `category/customCategoryLabel` | 教育记录 · 下拉与自定义输入 | 可编辑，预设与自定义投射 |
| 暑校名称、描述 | Education `courseTitle/courseDescription` | 暑校记录 · 名称与长文本 | 可编辑，仅暑校类别使用 |
| 组织、职位、地点、日期、职责 | Experience `organization/title/location/period/description` | 工作记录 · 短输入与长文本 | 可编辑，职责列表及移动日期 |
| 项目标题、副标题、日期、描述、URL | Projects `title/subtitle/period/description/href` | 项目记录 · 短输入、长文本与 URL | 可编辑，描述列表与无动作链接外观，合法地址为提示文字 |
| 项目 Methods | Projects `methods.zh/en[]` | 项目记录 · 两个独立语言列表 | 可编辑，边界、顺序和稳定身份 |
| 技能分类、自定义标题、内容 | Skills `category/title/items` | 技能分组 · 预设或自定义及多行原文 | 可编辑，类别为本地投射与展示选择 |
| 奖项名称、年份 | Awards `name/year` | 奖项记录 · 双语短输入 | 可编辑，保留年份差异 |
| 联系标题、可联系文案 | Contact `contactLabel/availability` | 联系栏 · 标题与长文本 | 可编辑，联系区排版 |
| Focus、Status 的小标题 | Profile `contactFocusHeading/contactStatusHeading` | 个人资料 · 双语短输入 | 可编辑，单一归属 |
| Focus 详情、Status 详情与图标类型 | Contact `focus/status` | 联系栏 · 独立列表、题名、详情、状态类型 | 可编辑，三类图标与可访问名称 |
| 公开邮箱和联系标签 | Links `email/emailLabel` | 公开链接 · 邮箱与标签 | 可编辑，独立于 S2 邮箱 |
| GitHub 按钮与地址 | Links `github/githubLabel` | 公开链接 · URL 与标签 | 可编辑，合法地址为按钮提示文字 |
| LinkedIn 按钮、名称、联系标签和各语言网址 | Links `linkedInDisplayName`、共享按钮标签与双语 `linkedInLabel/linkedInHref` | 公开链接 · 共享输入和各语言输入 | 可编辑，合法地址为提示文字，保留差异 |
| 公开首页名称 | Profile `navAboutLabel` | 个人资料 · 双语导航短输入 | 可编辑 |
| 公开站其余五项导航 | Site Text `navigation` | 网站文字 · 五组标签 | 可编辑，固定目的与顺序 |
| 教育、工作、项目、技能和奖项栏目标识 | Site Text 五个标题字段 | 网站文字 · 栏目标题 | 可编辑，独立于后台导航 |
| 项目链接文字、PDF 按钮文字 | Site Text `kaggleLabel/portfolioLabel` | 网站文字 · 双语短输入 | 可编辑，PDF 当前显示未开放 |
| PDF 正式引用与下载 | 未来已验收文件合同 | S4.9 / S3.5 | 延期，继续无文件输入和下载地址 |
| 页脚署名、版权、更新时间此前缀 | Profile `footerName/copyright`，Site Text `updatedAtLabel` | 个人资料及网站文字 | 可编辑，页脚各自投射 |
| 正式更新时间、发布时间和站点 ID | 未来可信服务 | 系统字段 | 系统控制，预览没有伪造时间 |
| 固定锚点、装饰图形、语言按钮、空状态 | 公开模板 | 模板与本地状态 | 系统控制，内容为空时使用明确占位 |

按钮和项目链接沿用公开站外观。邮箱、GitHub、LinkedIn 和项目 URL 都保持预览安全边界，无可执行跳转。公开站个别针对既有资料的数字加粗、动态背景和真实照片效果属于模板与资源差异，不作为自由编辑字段。
