# 公开导航与网站展示文字

原有八个预览章节保持固定，按 Profile、Introduction、Education、Experience、Projects、Skills、Awards、Contact 排列。网内导航以固定章节键定位。

参考旧 CMS `NavigationItem` 的 `experience/projects/skills/awards/contact`，网站文字只编辑这五个章节的双语公开导航标签。空值使用默认文案。没有增加、删除、重排或修改章节键的控件。Profile 继续拥有首页的 `navAboutLabel`。后台 Sidebar 与 Header 继续由后台界面语言控制。

站点栏目标题映射为教育 `educationLabel`、工作 `experienceLabel`、项目 `projectHeading`、技能 `skillsLabel`、奖项 `honorsLabel`。已有条目的标题、项目链接地址与排序仍归对应模块。旧字段 `kaggleLabel` 的实际用途是有效项目链接的显示文字。

页脚署名和版权仍由 Profile 写入。网站文字的 `updatedAtLabel` 只设置前缀。预览明确显示暂无已确认更新时间，等待正式发布快照提供日期。PDF 仅编辑 `portfolioLabel`，预览保持未开放提示。
