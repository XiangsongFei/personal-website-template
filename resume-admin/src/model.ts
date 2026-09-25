export type Locale = "zh" | "en";
export type Bilingual<T> = Record<Locale, T>;
export type OrderedItem = { id: string; position: number; sourceKey?: string | null; updatedAt?: string };

export type ProfileTranslation = {
  name: string;
  navAboutLabel: string;
  emailActionLabel: string;
  graduationLabel: string;
  avatarLabel: string;
  contactFocusHeading: string;
  contactStatusHeading: string;
};
export type ProfileSection = {
  shared: { graduationValue: string; avatarInitials: string; footerName: string; copyright: string };
  translations: Bilingual<ProfileTranslation>;
};

export type IntroItem = OrderedItem & { translations: Bilingual<{ text: string }> };
export type EducationItem = OrderedItem & {
  sourceKey: string | null;
  entryType: "standard" | "summerSchool";
  translations: Bilingual<{
    title: string; program: string; period: string; grade: string;
    courseTitle: string | null; courseDescription: string | null;
  }>;
};
export type ExperienceItem = OrderedItem & {
  sourceKey: string | null;
  translations: Bilingual<{ organization: string; title: string; period: string; description: string; location: string | null }>;
};
export type ProjectMethod = OrderedItem & { value: string };
export type ProjectItem = OrderedItem & {
  sourceKey: string | null;
  translations: Bilingual<{ title: string; subtitle: string; period: string; description: string; href: string }>;
  methods: Bilingual<ProjectMethod[]>;
};
export type SkillItem = OrderedItem & { sourceKey: string | null; translations: Bilingual<{ title: string; items: string }> };
export type AwardItem = OrderedItem & { sourceKey: string | null; translations: Bilingual<{ name: string; year: string }> };
export type FocusItem = OrderedItem & { translations: Bilingual<{ title: string; detail: string }> };
export type StatusItem = OrderedItem & {
  statusType: "study" | "graduation" | "open";
  translations: Bilingual<{ title: string; detail: string }>;
};
export type ContactSection = {
  translations: Bilingual<{ contactLabel: string; availability: string }>;
  focus: FocusItem[];
  status: StatusItem[];
};
export type NavigationItem = OrderedItem & {
  sectionId: "experience" | "projects" | "skills" | "awards" | "contact";
  translations: Bilingual<{ label: string }>;
};
export type SiteTextTranslation = {
  educationLabel: string; experienceLabel: string; projectHeading: string;
  skillsLabel: string; honorsLabel: string;
  portfolioLabel: string; portfolioHref: string;
  kaggleLabel: string; updatedAtLabel: string;
  linkedInLabel: string; linkedInHref: string;
};
export type LinksSection = {
  shared: { email: string; github: string; githubLabel: string; linkedInDisplayName: string; emailLabel: string; linkedInLabel: string };
  translations: Bilingual<SiteTextTranslation>;
  navigation: NavigationItem[];
};

export type EditorSections = {
  profile: ProfileSection;
  introduction: IntroItem[];
  education: EducationItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  skills: SkillItem[];
  awards: AwardItem[];
  contact: ContactSection;
  links: LinksSection;
};
export type SectionKey = keyof EditorSections;
