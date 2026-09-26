import type { EditorSections } from "./model";

export const fixtureMeta = {
  name: "Example CV",
  publication: "Published",
  languages: "Chinese + English",
  lastUpdated: "Demo date · 24 September 2026",
} as const;

export const fixtureSections: EditorSections = {
  profile: {
    shared: { graduationValue: "2024", avatarInitials: "DU", photoUrl: null, footerName: "Demo User", copyright: "© 2026 Demo User" },
    translations: {
      zh: { name: "示例用户", navAboutLabel: "关于我", emailActionLabel: "发送邮件", graduationLabel: "示例时间", avatarLabel: "示例头像占位符", contactFocusHeading: "当前关注", contactStatusHeading: "当前状态" },
      en: { name: "Demo User", navAboutLabel: "About", emailActionLabel: "Email", graduationLabel: "Sample timeline", avatarLabel: "Sample avatar placeholder", contactFocusHeading: "CURRENT FOCUS", contactStatusHeading: "CURRENT STATUS" },
    },
  },
  introduction: [
    { id: "intro-1", position: 0, translations: { zh: { text: "这是一个双语个人网站模板。" }, en: { text: "This is a bilingual portfolio template." } } },
    { id: "intro-2", position: 1, translations: { zh: { text: "所有内容均为本地演示。" }, en: { text: "All content here is a local demo." } } },
  ],
  education: [
    { id: "edu-1", sourceKey: "education-undergraduate", position: 0, entryType: "standard", translations: {
      zh: { title: "本科教育", program: "学位项目", period: "20XX — 20XX", grade: "GPA: 示例", courseTitle: "", courseDescription: "" },
      en: { title: "Undergraduate Education", program: "Degree Program", period: "20XX — 20XX", grade: "GPA: Example", courseTitle: "", courseDescription: "" },
    } },
    { id: "edu-2", sourceKey: "education-summer-school", position: 1, entryType: "summerSchool", translations: {
      zh: { title: "学术项目", program: "课程名称", period: "20XX", grade: "示例成绩", courseTitle: "课程说明", courseDescription: "当前公开页面对此字段使用固定短语排版。" },
      en: { title: "Academic Program", program: "Course Title", period: "20XX", grade: "Sample grade", courseTitle: "Course Description", courseDescription: "A general course description for a demo entry." },
    } },
  ],
  experience: [
    { id: "experience-1", sourceKey: "experience-example-company", position: 0, translations: {
      zh: { organization: "示例科技公司", title: "数据分析实习生", period: "2024.06 — 2024.08", description: "整理示例数据。\n制作分析报告。", location: "" },
      en: { organization: "Example Technology Company", title: "Data Analytics Intern", period: "Jun 2024 — Aug 2024", description: "Organised sample data.\nPrepared analysis reports.", location: "" },
    } },
  ],
  projects: [
    { id: "project-1", sourceKey: "project-example-analysis", position: 0, translations: {
      zh: { title: "示例分析项目", subtitle: "数据分析 · 项目实践", period: "2024.05 — 2024.06", description: "整理示例数据。\n汇总主要发现。", href: "" },
      en: { title: "Example Analysis Project", subtitle: "Data Analysis · Project Practice", period: "May 2024 — Jun 2024", description: "Prepared sample data.\nSummarised key findings.", href: "" },
    }, methods: {
      zh: [{ id: "method-zh-1", position: 0, value: "数据整理" }, { id: "method-zh-2", position: 1, value: "指标分析" }],
      en: [{ id: "method-en-1", position: 0, value: "Data Preparation" }, { id: "method-en-2", position: 1, value: "Metric Analysis" }],
    } },
  ],
  skills: [
    { id: "skill-1", sourceKey: "skills-programming", position: 0, translations: { zh: { title: "编程", items: "Python · SQL · TypeScript" }, en: { title: "Programming", items: "Python · SQL · TypeScript" } } },
    { id: "skill-2", sourceKey: "skills-analysis", position: 1, translations: { zh: { title: "分析", items: "数据清洗 · 可视化" }, en: { title: "Analytics", items: "Data Cleaning · Visualisation" } } },
  ],
  awards: [
    { id: "award-1", sourceKey: "award-example-project", position: 0, translations: { zh: { name: "示例项目成果", year: "2024" }, en: { name: "Example Project Outcome", year: "2024" } } },
    { id: "award-2", sourceKey: "award-example-academic", position: 1, translations: { zh: { name: "示例学术荣誉", year: "2023" }, en: { name: "Example Academic Honour", year: "2023" } } },
  ],
  contact: {
    translations: { zh: { contactLabel: "联系", availability: "欢迎就项目实践、专业学习与职业发展进行交流。" }, en: { contactLabel: "Contact", availability: "Open to discussions on projects, learning, and professional development." } },
    focus: [
      { id: "focus-1", position: 0, translations: { zh: { title: "数据与分析", detail: "" }, en: { title: "Data & Analysis", detail: "" } } },
      { id: "focus-2", position: 1, translations: { zh: { title: "项目与实践", detail: "" }, en: { title: "Projects & Practice", detail: "" } } },
    ],
    status: [
      { id: "status-1", position: 0, statusType: "study", translations: { zh: { title: "示例模板", detail: "请替换为公开信息" }, en: { title: "Example Template", detail: "Replace with public information" } } },
      { id: "status-2", position: 1, statusType: "open", translations: { zh: { title: "开放交流", detail: "项目交流 · 学习讨论" }, en: { title: "Open to Discussions", detail: "Projects · Learning" } } },
    ],
  },
  links: {
    shared: { email: "demo.user@example.com", github: "https://github.com/", githubLabel: "GitHub", linkedInDisplayName: "Demo profile", emailLabel: "Email", linkedInLabel: "LinkedIn" },
    translations: {
      zh: { educationLabel: "教育背景", experienceLabel: "实习经历", projectHeading: "项目经历", skillsLabel: "技能", honorsLabel: "荣誉奖项", portfolioLabel: "中文简历", portfolioHref: "/resume_zh.pdf", kaggleLabel: "查看示例", updatedAtLabel: "示例更新日期", linkedInLabel: "LinkedIn", linkedInHref: "https://www.linkedin.com/" },
      en: { educationLabel: "Education", experienceLabel: "Internship Experience", projectHeading: "Academic Projects", skillsLabel: "Skills", honorsLabel: "Honours & Awards", portfolioLabel: "English Resume", portfolioHref: "/resume_en.pdf", kaggleLabel: "View example", updatedAtLabel: "Sample update date", linkedInLabel: "LinkedIn", linkedInHref: "https://www.linkedin.com/" },
    },
    navigation: [
      { id: "nav-experience", position: 0, sectionId: "experience", translations: { zh: { label: "经历" }, en: { label: "Experience" } } },
      { id: "nav-projects", position: 1, sectionId: "projects", translations: { zh: { label: "项目" }, en: { label: "Projects" } } },
      { id: "nav-skills", position: 2, sectionId: "skills", translations: { zh: { label: "技能" }, en: { label: "Skills" } } },
      { id: "nav-awards", position: 3, sectionId: "awards", translations: { zh: { label: "奖项" }, en: { label: "Awards" } } },
      { id: "nav-contact", position: 4, sectionId: "contact", translations: { zh: { label: "联系" }, en: { label: "Contact" } } },
    ],
  },
};
