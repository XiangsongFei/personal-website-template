export type ResumeLocale = "zh" | "en";

export type ResumeEducationEntry = {
  id: string;
  entryType: "standard" | "summerSchool";
  title: string;
  program: string;
  period: string;
  grade: string;
  courseTitle?: string;
  courseDescription?: string;
};

export type ResumeExperienceEntry = {
  id: string;
  organization: string;
  title: string;
  period: string;
  description: string;
  location?: string;
};

export type ResumeProjectEntry = {
  id: string;
  title: string;
  subtitle: string;
  period: string;
  methods: string[];
  description: string;
  href: string;
};

export type ResumeSkillGroup = { id: string; title: string; items: string };
export type ResumeAward = { id: string; name: string; year: string };
export type ResumeContactFocus = [title: string, detail: string];
export type ResumeContactStatus = { type: string; title: string; detail: string };

export type ResumeLocaleContent = {
  intro: string[];
  nav: string[];
  education: string;
  experience: string;
  projectHeading: string;
  skills: string;
  honors: string;
  edu: ResumeEducationEntry[];
  jobs: ResumeExperienceEntry[];
  projects: ResumeProjectEntry[];
  skillGroups: ResumeSkillGroup[];
  honorsList: ResumeAward[];
  contact: string;
  availability: string;
  portfolioLabel: string;
  portfolioHref: string;
  kaggleLabel: string;
  updatedAt: string;
  linkedInLabel: string;
  linkedInHref: string;
  contactFocusItems: ResumeContactFocus[];
  contactStatusItems: ResumeContactStatus[];
};

export type ResumeContent = {
  profile: {
    name: Record<ResumeLocale, string>;
    navAboutLabel: Record<ResumeLocale, string>;
    emailActionLabel: Record<ResumeLocale, string>;
    graduationLabel: Record<ResumeLocale, string>;
    graduationValue: string;
    avatarLabel: Record<ResumeLocale, string>;
    avatarInitials: string;
    photoUrl: string | null;
    contactFocusHeading: Record<ResumeLocale, string>;
    contactStatusHeading: Record<ResumeLocale, string>;
    footerName: string;
    copyright: string;
  };
  publicLinks: { email: string; github: string; githubLabel: string; linkedInDisplayName: string; emailLabel: string; linkedInLabel: string };
  locales: Record<ResumeLocale, ResumeLocaleContent>;
};

export const resumeContent: ResumeContent = {
  profile: {
    name: { zh: "示例用户", en: "Demo User" },
    navAboutLabel: { zh: "关于我", en: "About" },
    emailActionLabel: { zh: "发送邮件", en: "Email" },
    graduationLabel: { zh: "示例时间", en: "Sample timeline" },
    graduationValue: "2024",
    avatarLabel: { zh: "示例头像占位符", en: "Sample avatar placeholder" },
    avatarInitials: "DU",
    photoUrl: null,
    contactFocusHeading: { zh: "当前关注", en: "CURRENT FOCUS" },
    contactStatusHeading: { zh: "当前状态", en: "CURRENT STATUS" },
    footerName: "Demo User",
    copyright: "© 2026 Demo User",
  },
  publicLinks: {
    email: "demo.user@example.com",
    github: "https://github.com/",
    githubLabel: "GitHub",
    linkedInDisplayName: "Demo profile",
    emailLabel: "Email",
    linkedInLabel: "LinkedIn",
  },
  locales: {
    zh: {
      intro: ["这是一个可公开发布的双语个人网站模板。请将示例内容替换为你自己的、已确认可公开的信息。", "模板展示数据分析、信息系统和产品项目的常见呈现方式；所有姓名、机构和链接均为示例。"],
      nav: ["经历", "项目", "技能", "奖项", "联系"],
      education: "教育背景", experience: "实习经历", projectHeading: "项目经历", skills: "技能", honors: "荣誉奖项",
      edu: [
        { id: "education-undergraduate", entryType: "standard", title: "本科教育", program: "学位项目", period: "20XX — 20XX", grade: "GPA: 示例" },
        { id: "education-graduate", entryType: "standard", title: "研究生教育", program: "学位项目", period: "20XX — 20XX", grade: "GPA: 示例" },
        { id: "education-summer-school", entryType: "summerSchool", title: "学术项目", program: "课程名称", courseTitle: "课程说明", period: "20XX", grade: "示例成绩", courseDescription: "这是用于展示教育经历的通用课程内容。" },
      ],
      jobs: [
        { id: "experience-example-company", organization: "示例科技公司", title: "数据分析实习生", period: "2024.06 — 2024.08", description: "整理示例运营数据并制作可复用的分析报告。\n使用公开指标比较渠道表现，为团队讨论提供参考。" },
        { id: "experience-example-lab", organization: "Example Lab", title: "课程助教", period: "2024.03 — 2024.06", description: "协助组织编程练习并提供基础答疑。\n将常见问题整理为匿名化的学习资料。" },
      ],
      projects: [
        { id: "project-example-analysis", title: "示例分析项目", subtitle: "数据分析 · 项目实践", period: "2024.05 — 2024.06", methods: ["数据整理", "指标分析", "结果汇总"], description: "使用示例数据完成基础整理、分析与结果汇总。\n对不同方案进行比较，并记录主要发现。\n将分析结果整理为简洁的项目说明。", href: "" },
        { id: "project-example-process", title: "示例流程设计项目", subtitle: "流程设计 · 项目管理", period: "2024.03 — 2024.04", methods: ["流程梳理", "资源规划", "方案优化"], description: "设计从需求到交付的示例流程。\n识别关键环节并提出可执行的优化建议。\n将流程与改进思路整理为结构化文档。", href: "" },
      ],
      skillGroups: [
        { id: "skills-programming", title: "编程", items: "Python · SQL · TypeScript" }, { id: "skills-data-systems", title: "数据与系统", items: "关系数据库 · API · 数据建模" }, { id: "skills-analysis", title: "分析", items: "数据清洗 · 可视化 · 业务分析" }, { id: "skills-tools", title: "工具", items: "Git · Excel · 文档协作" }, { id: "skills-languages", title: "语言", items: "中文 · English" },
      ],
      honorsList: [{ id: "award-example-project", name: "示例项目成果", year: "2024" }, { id: "award-example-academic", name: "示例学术荣誉", year: "2023" }],
      contact: "联系", availability: "欢迎就项目实践、专业学习与职业发展进行交流。", portfolioLabel: "中文简历", portfolioHref: "/resume_zh.pdf", kaggleLabel: "查看示例", updatedAt: "示例更新日期", linkedInLabel: "LinkedIn", linkedInHref: "https://www.linkedin.com/",
      contactFocusItems: [["数据与分析", ""], ["商业与管理", ""], ["技术与系统", ""], ["项目与实践", ""]],
      contactStatusItems: [{ type: "study", title: "示例模板", detail: "请替换为公开信息" }, { type: "graduation", title: "示例日期", detail: "使用年份或月份即可" }, { type: "open", title: "开放交流", detail: "项目交流 · 学习讨论 · 合作机会" }],
    },
    en: {
      intro: ["This is a public bilingual portfolio template. Replace the sample text with information you have confirmed is safe to publish.", "It demonstrates common sections for data analytics, information systems, and product work. All names, organisations, and links are examples."],
      nav: ["Experience", "Projects", "Skills", "Awards", "Contact"],
      education: "Education", experience: "Internship Experience", projectHeading: "Academic Projects", skills: "Skills", honors: "Honours & Awards",
      edu: [
        { id: "education-undergraduate", entryType: "standard", title: "Undergraduate Education", program: "Degree Program", period: "20XX — 20XX", grade: "GPA: Example" },
        { id: "education-graduate", entryType: "standard", title: "Graduate Education", program: "Degree Program", period: "20XX — 20XX", grade: "GPA: Example" },
        { id: "education-summer-school", entryType: "summerSchool", title: "Academic Program", program: "Course Title", courseTitle: "Course Description", period: "20XX", grade: "Sample grade", courseDescription: "This is a general course description for an education entry." },
      ],
      jobs: [
        { id: "experience-example-company", organization: "Example Technology Company", title: "Data Analytics Intern", period: "Jun 2024 — Aug 2024", description: "Organised sample operational data and prepared reusable analysis reports.\nCompared public metrics to support team discussions." },
        { id: "experience-example-lab", organization: "Example Lab", title: "Teaching Assistant", period: "Mar 2024 — Jun 2024", description: "Helped organise programming exercises and answer introductory questions.\nTurned recurring questions into anonymised learning materials." },
      ],
      projects: [
        { id: "project-example-analysis", title: "Example Analysis Project", subtitle: "Data Analysis · Project Practice", period: "May 2024 — Jun 2024", methods: ["Data Preparation", "Metric Analysis", "Result Summary"], description: "Used sample data to complete basic preparation, analysis, and result summarization.\nCompared alternative approaches and documented key observations.\nPresented the findings in a concise project summary.", href: "" },
        { id: "project-example-process", title: "Example Process Design Project", subtitle: "Process Design · Project Management", period: "Mar 2024 — Apr 2024", methods: ["Process Mapping", "Resource Planning", "Solution Improvement"], description: "Designed a sample workflow from requirements to delivery.\nIdentified key stages and proposed practical improvements.\nDocumented the workflow and improvement ideas in a structured format.", href: "" },
      ],
      skillGroups: [
        { id: "skills-programming", title: "Programming", items: "Python · SQL · TypeScript" }, { id: "skills-data-systems", title: "Data & Systems", items: "Relational Databases · APIs · Data Modelling" }, { id: "skills-analysis", title: "Analytics", items: "Data Cleaning · Visualisation · Business Analysis" }, { id: "skills-tools", title: "Tools", items: "Git · Excel · Documentation" }, { id: "skills-languages", title: "Languages", items: "Chinese · English" },
      ],
      honorsList: [{ id: "award-example-project", name: "Example Project Outcome", year: "2024" }, { id: "award-example-academic", name: "Example Academic Honour", year: "2023" }],
      contact: "Contact", availability: "Open to discussions on projects, learning, and professional development.", portfolioLabel: "English Resume", portfolioHref: "/resume_en.pdf", kaggleLabel: "View example", updatedAt: "Sample update date", linkedInLabel: "LinkedIn", linkedInHref: "https://www.linkedin.com/",
      contactFocusItems: [["Data & Analysis", ""], ["Business & Management", ""], ["Technology & Systems", ""], ["Projects & Practice", ""]],
      contactStatusItems: [{ type: "study", title: "Example Template", detail: "Replace with public information" }, { type: "graduation", title: "Example Date", detail: "Use a year or month" }, { type: "open", title: "Open to Discussions", detail: "Projects · Learning · Collaboration" }],
    },
  },
};
