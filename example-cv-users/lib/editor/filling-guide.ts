import {collectEditorFields} from './bilingual-review.ts';
import {editorModules, type ContentLocale, type EditorModule, type LocalDraft} from './draft.ts';
import {educationCategory, skillCategory, type DraftTranslations} from './records.ts';

// Product copy for the read-only filling guide. Only the editor's real draft is editable.
export const fillingGuide: LocalDraft = {
  profile: {
    shared: {
      graduationValue: '2026', avatarInitials: 'CZ', footerName: 'Chen Zhou',
      copyright: '© 2026 Chen Zhou',
    },
    translations: {
      zh: {name: '周晨', navAboutLabel: '周晨', graduationLabel: '毕业时间', emailActionLabel: '联系我',
        avatarLabel: '周晨的头像', contactFocusHeading: '合作方向', contactStatusHeading: '当前状态'},
      en: {name: 'Chen Zhou', navAboutLabel: 'Chen Zhou', graduationLabel: 'Graduation', emailActionLabel: 'Get in touch',
        avatarLabel: 'Portrait of Chen Zhou', contactFocusHeading: 'Collaboration interests', contactStatusHeading: 'Current status'},
    },
  },
  introduction: {
    zh: '我是一名公共服务数据分析师，有信息科学和服务设计背景。我用 SQL 整理服务记录，和一线团队确认指标定义，并把结果做成易读、可检索的报表。\n\n目前关注公共信息的无障碍体验，希望参与从问题定义到效果验证的完整项目。',
    en: 'I am a public-service data analyst with a background in information science and service design. I use SQL to organize service records, validate metrics with frontline teams, and turn the results into readable, searchable reports.\n\nI focus on making public information accessible and enjoy taking projects from problem definition through evaluation.',
  },
  education: [{
    clientId: 'guide-degree', position: 0, category: 'graduate', entryType: 'standard', persistedCategory: null,
    translations: {
      zh: {title: '海汀信息学院', program: '信息科学 · 理学硕士', period: '2024.09 – 2026.06', grade: 'GPA 3.8 / 4.0'},
      en: {title: 'Tidehaven School of Information', program: 'MSc in Information Science', period: 'Sep 2024 – Jun 2026', grade: 'GPA 3.8 / 4.0'},
    },
  }, {
    clientId: 'guide-course', position: 1, category: 'summerSchool', entryType: 'summerSchool', persistedCategory: null,
    translations: {
      zh: {title: '北港公共设计学校', program: '公共信息设计', period: '2023.07 – 2023.08', grade: '优秀',
        courseTitle: '无障碍数据可视化', courseDescription: '用键盘和屏幕阅读器检查图表的阅读顺序，补充文本标签和摘要。'},
      en: {title: 'Northport School of Public Design', program: 'Public Information Design', period: 'Jul–Aug 2023', grade: 'Distinction',
        courseTitle: 'Accessible Data Visualization', courseDescription: 'Tested chart reading order with a keyboard and screen reader, then added text labels and summaries.'},
    },
  }],
  experience: [{
    clientId: 'guide-experience', position: 0,
    translations: {
      zh: {organization: '潮汐公共信息实验室', title: '数据分析师', location: '上海 · 混合办公', period: '2025.07 – 2026.06',
        description: '用 SQL 汇总三个服务团队的月报，统一 12 项指标的口径。与运营团队改版报表，两轮测试后，查找关键指标的中位时间从 90 秒缩短至 55 秒。'},
      en: {organization: 'Tidelight Public Information Lab', title: 'Data Analyst', location: 'Shanghai · Hybrid', period: 'Jul 2025 – Jun 2026',
        description: 'Consolidated monthly reports from three service teams in SQL and defined 12 shared metrics. Redesigned the report with operations, reducing the median time to find a key metric from 90 to 55 seconds across two rounds of testing.'},
    },
  }],
  projects: [{
    clientId: 'guide-project', position: 0,
    translations: {
      zh: {title: '社区图书馆服务检索原型', subtitle: '信息架构与可用性研究', period: '2025.03 – 2025.06',
        description: '梳理检索和预约流程，设计可用键盘操作的筛选界面。根据 8 次任务测试调整标签和筛选顺序，减少重复操作。', href: 'https://example.org/library-project'},
      en: {title: 'Community Library Service Finder', subtitle: 'Information architecture and usability research', period: 'Mar–Jun 2025',
        description: 'Mapped search and booking tasks, then designed keyboard-accessible filters. Revised the labels and filter order after eight task tests to reduce repeated steps.', href: 'https://example.org/library-project'},
    },
    methods: {
      zh: [{clientId: 'guide-method-zh', position: 0, value: '任务分析、键盘测试、可用性访谈'}],
      en: [{clientId: 'guide-method-en', position: 0, value: 'Task analysis, keyboard testing, usability interviews'}],
    },
  }],
  skills: [{
    clientId: 'guide-skills', position: 0, category: 'custom',
    translations: {
      zh: {title: '数据分析与服务研究', items: 'SQL：数据校验与指标定义\nPython：数据清理与分析\n可用性测试：任务设计及结果分析'},
      en: {title: 'Data analysis and service research', items: 'SQL: data validation and metric definitions\nPython: data cleaning and analysis\nUsability testing: task design and evaluation'},
    },
  }],
  awards: [{
    clientId: 'guide-award', position: 0,
    translations: {zh: {name: '学院优秀毕业设计奖', year: '2026'}, en: {name: 'School Award for Outstanding Capstone', year: '2026'}},
  }],
  contact: {
    translations: {
      zh: {contactLabel: '联系', availability: '欢迎交流公共服务数据分析和无障碍信息设计。'},
      en: {contactLabel: 'Contact', availability: 'Open to conversations about public-service analytics and accessible information design.'},
    },
    focus: [{
      clientId: 'guide-collaboration', position: 0,
      translations: {
        zh: {title: '服务指标与报表', detail: '与服务团队共同定义可衡量的目标和简明报表。'},
        en: {title: 'Service metrics and reporting', detail: 'Define measurable goals and clear reports with service teams.'},
      },
    }],
    status: [{
      clientId: 'guide-status', position: 0, statusType: 'open',
      translations: {
        zh: {title: '开放合作', detail: '可参与短期公共信息可用性研究。'},
        en: {title: 'Open to collaboration', detail: 'Available for short usability studies on public information.'},
      },
    }],
  },
  links: {
    shared: {
      email: 'chen@example.org', emailLabel: 'Email', github: 'https://github.com/', githubLabel: 'GitHub',
      linkedInDisplayName: 'Chen Zhou', linkedInLabel: 'LinkedIn',
    },
    translations: {
      zh: {linkedInLabel: 'LinkedIn 平台示例', linkedInHref: 'https://www.linkedin.com/'},
      en: {linkedInLabel: 'LinkedIn platform example', linkedInHref: 'https://www.linkedin.com/'},
    },
  },
  'site-text': {
    navigation: {
      zh: {experience: '经历', projects: '项目', skills: '技能', awards: '荣誉', contact: '联系'},
      en: {experience: 'Experience', projects: 'Projects', skills: 'Skills', awards: 'Awards', contact: 'Contact'},
    },
    translations: {
      zh: {educationLabel: '教育经历', experienceLabel: '工作经历', projectHeading: '精选项目', skillsLabel: '专业技能',
        honorsLabel: '荣誉', kaggleLabel: '数据作品', portfolioLabel: '作品集', updatedAtLabel: '最后更新'},
      en: {educationLabel: 'Education', experienceLabel: 'Work experience', projectHeading: 'Selected projects', skillsLabel: 'Skills',
        honorsLabel: 'Honors', kaggleLabel: 'Data projects', portfolioLabel: 'Portfolio', updatedAtLabel: 'Last updated'},
    },
  },
};

const modules = Object.keys(editorModules) as EditorModule[];
const exampleFields = new Map(modules.map(module => [module, [...collectEditorFields(fillingGuide, module).values()]]));

type RecordExample = DraftTranslations<Record<string, string | null>>;

const skillExamples = {
  programming: {zh: 'Python：清理数据并编写自动化脚本', en: 'Python: clean data and automate routine tasks'},
  dataSystems: {zh: 'SQL：查询、校验与维护数据集', en: 'SQL: query, validate, and maintain datasets'},
  analytics: {zh: '指标分析：定义关键指标并比较变化', en: 'Analytics: define key metrics and compare trends'},
  tools: {zh: 'Git：协作、版本记录与代码审查', en: 'Git: collaborate, track changes, and review code'},
  languages: {zh: '英语：专业工作沟通与报告写作', en: 'English: professional communication and report writing'},
};

export function guideRecord(module: EditorModule, draft: LocalDraft, item: string): RecordExample | undefined {
  switch (module) {
    case 'education': {
      const row = draft.education.find(row => row.clientId === item);
      if (!row) return;
      const category = educationCategory(row);
      if (category === 'summerSchool') return fillingGuide.education.find(row => educationCategory(row) === category)?.translations;
      const program = category === 'undergraduate' ? ['信息科学 · 本科', 'BSc in Information Science']
        : category === 'graduate' ? ['信息科学 · 理学硕士', 'MSc in Information Science']
        : category === 'doctoral' ? ['信息科学 · 博士', 'PhD in Information Science']
        : ['信息科学与服务设计', 'Information Science and Service Design'];
      const [degree] = fillingGuide.education;
      const zh = {...degree.translations.zh, program: program[0], ...(category === 'custom' && {customCategoryLabel: '继续教育'})};
      const en = {...degree.translations.en, program: program[1], ...(category === 'custom' && {customCategoryLabel: 'Continuing education'})};
      return {zh, en};
    }
    case 'experience': return fillingGuide.experience[0]?.translations;
    case 'projects': return fillingGuide.projects[0]?.translations;
    case 'awards': return fillingGuide.awards[0]?.translations;
    case 'skills': {
      const row = draft.skills.find(row => row.clientId === item);
      if (!row) return;
      const category = skillCategory(row);
      if (category === 'custom') return fillingGuide.skills[0]?.translations;
      const items = skillExamples[category];
      return {zh: {items: items.zh}, en: {items: items.en}};
    }
    case 'contact': {
      if (item.startsWith('focus:')) return fillingGuide.contact.focus[0]?.translations;
      const status = draft.contact.status.find(row => 'status:' + row.clientId === item)?.statusType;
      if (status === 'study') return {
        zh: {title: '在读', detail: '正在完成信息科学课程和研究项目。'},
        en: {title: 'Currently studying', detail: 'Completing coursework and research in information science.'},
      };
      if (status === 'graduation') return {
        zh: {title: '即将毕业', detail: '毕业后可参与公共信息与数据分析项目。'},
        en: {title: 'Graduating soon', detail: 'Available for public information and analytics projects after graduation.'},
      };
      return fillingGuide.contact.status[0]?.translations;
    }
  }
}

export function guideMethod(locale: ContentLocale) {
  return fillingGuide.projects[0]?.methods[locale][0]?.value;
}

export function guidePlaceholder(module: EditorModule, field: string, locale: ContentLocale | 'shared', item?: string, draft?: LocalDraft) {
  if (item && draft && locale !== 'shared') {
    if (module === 'projects' && field.startsWith('method:' + locale + ':')) return guideMethod(locale);
    return guideRecord(module, draft, item)?.[locale]?.[field] ?? undefined;
  }
  const key = locale === 'shared' ? 'shared:' + field : field;
  const group = module === 'contact' ? item?.split(':')[0] : undefined;
  const example = exampleFields.get(module)?.find(entry => (
    (entry.field === key || (key.startsWith('method:') && entry.field.startsWith('method:' + locale + ':'))) &&
    (!group || entry.item?.startsWith(group + ':')) && (entry.editValues ?? entry.values)[locale]?.trim()
  ));
  return example && (example.editValues ?? example.values)[locale];
}
